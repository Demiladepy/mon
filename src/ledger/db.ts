import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import type { PaymentIntent } from "../mcp/tools.js";
import type { Decision } from "../policy/engine.js";

export type StoredOutcome = {
  intent: PaymentIntent;
  decision?: Decision;
  result?: unknown;
  status: string;
};

export type CollectionRecord = {
  transactionReference: string;
  amountKobo: number;
  accountReference: string;
  customerName?: string;
  status: string;
  paidAt?: string;
};

export class Ledger {
  private readonly db: Database.Database;

  constructor(databasePath: string) {
    if (databasePath !== ":memory:") {
      fs.mkdirSync(path.dirname(databasePath), { recursive: true });
    }
    this.db = new Database(databasePath);
    this.db.pragma("journal_mode = WAL");
    this.migrate();
  }

  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS intents (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        agent_id TEXT NOT NULL,
        idempotency_key TEXT NOT NULL UNIQUE,
        action TEXT NOT NULL,
        amount_kobo INTEGER,
        payload_json TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS decisions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        idempotency_key TEXT NOT NULL,
        effect TEXT NOT NULL,
        reasons_json TEXT NOT NULL,
        matched_rules_json TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS executions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        idempotency_key TEXT NOT NULL UNIQUE,
        status TEXT NOT NULL,
        provider_reference TEXT,
        result_json TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS idempotency (
        idempotency_key TEXT PRIMARY KEY,
        status TEXT NOT NULL,
        outcome_json TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        completed_at TEXT
      );

      CREATE TABLE IF NOT EXISTS audit_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        event_type TEXT NOT NULL,
        agent_id TEXT,
        idempotency_key TEXT,
        details_json TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS reserved_accounts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        account_reference TEXT NOT NULL UNIQUE,
        account_name TEXT NOT NULL,
        customer_name TEXT NOT NULL,
        customer_email TEXT NOT NULL,
        account_number TEXT,
        bank_name TEXT,
        provider_result_json TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS collections (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        transaction_reference TEXT NOT NULL UNIQUE,
        amount_kobo INTEGER NOT NULL,
        account_reference TEXT NOT NULL,
        customer_name TEXT,
        status TEXT NOT NULL,
        paid_at TEXT,
        payload_json TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TRIGGER IF NOT EXISTS audit_no_update
      BEFORE UPDATE ON audit_events BEGIN
        SELECT RAISE(ABORT, 'audit events are append-only');
      END;

      CREATE TRIGGER IF NOT EXISTS audit_no_delete
      BEFORE DELETE ON audit_events BEGIN
        SELECT RAISE(ABORT, 'audit events are append-only');
      END;
    `);
  }

  claimIntent(agentId: string, intent: PaymentIntent): boolean {
    const transaction = this.db.transaction(() => {
      const claimed = this.db
        .prepare(
          `INSERT OR IGNORE INTO idempotency (idempotency_key, status)
           VALUES (?, 'PROCESSING')`,
        )
        .run(intent.idempotencyKey);
      if (claimed.changes === 0) return false;

      this.db
        .prepare(
          `INSERT INTO intents
           (agent_id, idempotency_key, action, amount_kobo, payload_json)
           VALUES (?, ?, ?, ?, ?)`,
        )
        .run(
          agentId,
          intent.idempotencyKey,
          intent.action,
          intent.amountKobo ?? null,
          JSON.stringify(intent),
        );
      return true;
    });
    return transaction();
  }

  complete(
    intent: PaymentIntent,
    decision: Decision,
    status: string,
    result?: unknown,
    providerReference?: string,
  ): void {
    const outcome: StoredOutcome = { intent, decision, result, status };
    const transaction = this.db.transaction(() => {
      this.db
        .prepare(
          `INSERT INTO decisions
           (idempotency_key, effect, reasons_json, matched_rules_json)
           VALUES (?, ?, ?, ?)`,
        )
        .run(
          intent.idempotencyKey,
          decision.effect,
          JSON.stringify(decision.reasons),
          JSON.stringify(decision.matchedRules),
        );
      this.db
        .prepare(
          `INSERT OR IGNORE INTO executions
           (idempotency_key, status, provider_reference, result_json)
           VALUES (?, ?, ?, ?)`,
        )
        .run(
          intent.idempotencyKey,
          status,
          providerReference ?? null,
          result === undefined ? null : JSON.stringify(result),
        );
      this.db
        .prepare(
          `UPDATE idempotency
           SET status = ?, outcome_json = ?, completed_at = datetime('now')
           WHERE idempotency_key = ?`,
        )
        .run(status, JSON.stringify(outcome), intent.idempotencyKey);
    });
    transaction();
  }

  getOutcome(idempotencyKey: string): StoredOutcome | undefined {
    const row = this.db
      .prepare(
        "SELECT status, outcome_json FROM idempotency WHERE idempotency_key = ?",
      )
      .get(idempotencyKey) as
      | { status: string; outcome_json: string | null }
      | undefined;
    if (!row) return undefined;
    if (!row.outcome_json) {
      return {
        intent: {
          action: "READ",
          idempotencyKey,
        },
        status: row.status,
      };
    }
    return JSON.parse(row.outcome_json) as StoredOutcome;
  }

  executedTodayKobo(agentId: string): number {
    const row = this.db
      .prepare(
        `SELECT COALESCE(SUM(i.amount_kobo), 0) AS total
         FROM intents i
         JOIN executions e ON e.idempotency_key = i.idempotency_key
         WHERE i.agent_id = ?
           AND e.status = 'SUCCESS'
           AND date(e.created_at) = date('now')`,
      )
      .get(agentId) as { total: number };
    return row.total;
  }

  payoutCountSince(agentId: string, sinceIso: string): number {
    const row = this.db
      .prepare(
        `SELECT COUNT(*) AS total
         FROM intents i
         JOIN executions e ON e.idempotency_key = i.idempotency_key
         WHERE i.agent_id = ?
           AND i.action = 'PAYOUT'
           AND e.status = 'SUCCESS'
           AND e.created_at >= datetime(?)`,
      )
      .get(agentId, sinceIso) as { total: number };
    return row.total;
  }

  audit(
    eventType: string,
    details: unknown,
    agentId?: string,
    idempotencyKey?: string,
  ): void {
    this.db
      .prepare(
        `INSERT INTO audit_events
         (event_type, agent_id, idempotency_key, details_json)
         VALUES (?, ?, ?, ?)`,
      )
      .run(
        eventType,
        agentId ?? null,
        idempotencyKey ?? null,
        JSON.stringify(details),
      );
  }

  listAudit(limit = 50): unknown[] {
    return this.db
      .prepare(
        `SELECT id, event_type, agent_id, idempotency_key, details_json, created_at
         FROM audit_events ORDER BY id DESC LIMIT ?`,
      )
      .all(limit)
      .map((row) => {
        const typed = row as Record<string, unknown> & { details_json: string };
        return { ...typed, details: JSON.parse(typed.details_json) };
      });
  }

  saveReservedAccount(input: {
    accountReference: string;
    accountName: string;
    customerName: string;
    customerEmail: string;
    accountNumber?: string;
    bankName?: string;
    result: unknown;
  }): void {
    this.db
      .prepare(
        `INSERT OR IGNORE INTO reserved_accounts
         (account_reference, account_name, customer_name, customer_email,
          account_number, bank_name, provider_result_json)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        input.accountReference,
        input.accountName,
        input.customerName,
        input.customerEmail,
        input.accountNumber ?? null,
        input.bankName ?? null,
        JSON.stringify(input.result),
      );
  }

  listReservedAccounts(limit = 20): unknown[] {
    return this.db
      .prepare(
        `SELECT account_reference, account_name, customer_name, customer_email,
                account_number, bank_name, created_at
         FROM reserved_accounts ORDER BY id DESC LIMIT ?`,
      )
      .all(limit);
  }

  recordCollection(
    collection: CollectionRecord,
    payload: unknown,
  ): boolean {
    const result = this.db
      .prepare(
        `INSERT OR IGNORE INTO collections
         (transaction_reference, amount_kobo, account_reference, customer_name,
          status, paid_at, payload_json)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        collection.transactionReference,
        collection.amountKobo,
        collection.accountReference,
        collection.customerName ?? null,
        collection.status,
        collection.paidAt ?? null,
        JSON.stringify(payload),
      );
    return result.changes > 0;
  }

  listCollections(limit = 20): unknown[] {
    return this.db
      .prepare(
        `SELECT transaction_reference, amount_kobo, account_reference,
                customer_name, status, paid_at, created_at
         FROM collections ORDER BY id DESC LIMIT ?`,
      )
      .all(limit);
  }

  collectedTodayKobo(): number {
    const row = this.db
      .prepare(
        `SELECT COALESCE(SUM(amount_kobo), 0) AS total
         FROM collections
         WHERE status IN ('PAID', 'SUCCESS', 'SUCCESSFUL')
           AND date(COALESCE(paid_at, created_at)) = date('now')`,
      )
      .get() as { total: number };
    return row.total;
  }

  listPendingApprovals(limit = 20): unknown[] {
    return this.db
      .prepare(
        `SELECT i.idempotency_key, i.amount_kobo, i.payload_json,
                d.reasons_json, d.matched_rules_json, e.created_at
         FROM intents i
         JOIN decisions d ON d.idempotency_key = i.idempotency_key
         JOIN executions e ON e.idempotency_key = i.idempotency_key
         WHERE e.status = 'PENDING_APPROVAL'
         ORDER BY e.id DESC LIMIT ?`,
      )
      .all(limit)
      .map((row) => {
        const typed = row as {
          payload_json: string;
          reasons_json: string;
          matched_rules_json: string;
          [key: string]: unknown;
        };
        return {
          ...typed,
          intent: JSON.parse(typed.payload_json),
          reasons: JSON.parse(typed.reasons_json),
          matchedRules: JSON.parse(typed.matched_rules_json),
        };
      });
  }

  updateApprovalOutcome(
    idempotencyKey: string,
    status: "SUCCESS" | "DENIED" | "PROVIDER_ERROR",
    result?: unknown,
    providerReference?: string,
  ): StoredOutcome {
    const existing = this.getOutcome(idempotencyKey);
    if (!existing?.decision || existing.status !== "PENDING_APPROVAL") {
      throw new Error("Approval is not pending");
    }
    const outcome: StoredOutcome = { ...existing, status, result };
    const transaction = this.db.transaction(() => {
      this.db
        .prepare(
          `UPDATE executions
           SET status = ?, provider_reference = ?, result_json = ?
           WHERE idempotency_key = ?`,
        )
        .run(
          status,
          providerReference ?? null,
          result === undefined ? null : JSON.stringify(result),
          idempotencyKey,
        );
      this.db
        .prepare(
          `UPDATE idempotency
           SET status = ?, outcome_json = ?, completed_at = datetime('now')
           WHERE idempotency_key = ?`,
        )
        .run(status, JSON.stringify(outcome), idempotencyKey);
    });
    transaction();
    return outcome;
  }

  close(): void {
    this.db.close();
  }
}
