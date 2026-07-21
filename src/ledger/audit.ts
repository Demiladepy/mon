import type { Ledger } from "./db.js";

export type AuditEvent =
  | "INTENT_RECEIVED"
  | "POLICY_ALLOWED"
  | "POLICY_DENIED"
  | "APPROVAL_REQUIRED"
  | "PAYOUT_EXECUTED"
  | "IDEMPOTENT_REPLAY"
  | "POLICY_TAMPER_ATTEMPT"
  | "PROVIDER_ERROR"
  | "RESERVED_ACCOUNT_CREATED"
  | "COLLECTION_RECEIVED"
  | "APPROVAL_APPROVED"
  | "APPROVAL_DENIED"
  | "WEBHOOK_REJECTED";

export function appendAudit(
  ledger: Ledger,
  event: AuditEvent,
  details: unknown,
  agentId?: string,
  idempotencyKey?: string,
): void {
  ledger.audit(event, details, agentId, idempotencyKey);
}
