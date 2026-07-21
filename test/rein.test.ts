import { afterEach, describe, expect, it } from "vitest";
import { config } from "../src/config.js";
import { Ledger } from "../src/ledger/db.js";
import { MonnifyClient } from "../src/monnify/client.js";
import { defaultPolicy } from "../src/policy/rules.js";
import { ReinService } from "../src/rein.js";

const ledgers: Ledger[] = [];

function makeService(): ReinService {
  const ledger = new Ledger(":memory:");
  ledgers.push(ledger);
  return new ReinService(
    ledger,
    new MonnifyClient({ ...config, DRY_RUN: true }),
    defaultPolicy,
    "test-agent",
  );
}

const payout = {
  amountKobo: 850_000,
  beneficiaryAccount: "0123456789",
  beneficiaryBankCode: "058",
  expectedBeneficiaryName: "Musa Ibrahim",
  category: "supplier",
  idempotencyKey: "idempotency-test-001",
  reason: "Flour delivery",
};

afterEach(() => {
  ledgers.splice(0).forEach((ledger) => ledger.close());
});

describe("Rein payout service", () => {
  it("executes a permitted dry-run payout end to end", async () => {
    const result = await makeService().payout(payout);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.status).toBe("SUCCESS");
      expect(result.decision.effect).toBe("ALLOW");
    }
  });

  it("returns the original result for an idempotent replay", async () => {
    const service = makeService();
    const first = await service.payout(payout);
    const second = await service.payout(payout);
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    if (second.ok) expect(second.replayed).toBe(true);

    const executionEvents = service
      .auditTrail()
      .filter(
        (row) =>
          (row as { event_type?: string }).event_type === "PAYOUT_EXECUTED",
      );
    expect(executionEvents).toHaveLength(1);
  });

  it("rejects and audits policy override fields", async () => {
    const service = makeService();
    const result = await service.payout({
      ...payout,
      idempotencyKey: "tamper-attempt-001",
      adminOverride: true,
      maxPerTxnKobo: 99_999_999_999,
    });
    expect(result).toMatchObject({
      ok: false,
      status: "INVALID_INTENT",
    });
    expect(
      service
        .auditTrail()
        .some(
          (row) =>
            (row as { event_type?: string }).event_type ===
            "POLICY_TAMPER_ATTEMPT",
        ),
    ).toBe(true);
  });

  it("creates an idempotent reserved account without auditing KYC", async () => {
    const service = makeService();
    const request = {
      accountReference: "customer-account-001",
      accountName: "Aderonke Stores Collection",
      customerName: "Aderonke Stores",
      customerEmail: "accounts@aderonke.example",
      nin: "12345678901",
      idempotencyKey: "reserved-account-test-001",
    };
    const first = await service.createReservedAccount(request);
    const replay = await service.createReservedAccount(request);
    expect(first).toMatchObject({ ok: true, status: "SUCCESS" });
    expect(replay).toMatchObject({ ok: true, replayed: true });
    expect(JSON.stringify(service.auditTrail())).not.toContain(request.nin);
  });

  it("executes a held payout only after human approval", async () => {
    const service = makeService();
    const pending = await service.payout({
      ...payout,
      amountKobo: defaultPolicy.approvalThresholdKobo,
      idempotencyKey: "approval-test-001",
    });
    expect(pending).toMatchObject({
      ok: true,
      status: "PENDING_APPROVAL",
    });

    const approved = await service.approvePayout("approval-test-001");
    expect(approved.status).toBe("SUCCESS");
    const dashboard = (await service.dashboard()) as {
      approvals: unknown[];
    };
    expect(dashboard.approvals).toHaveLength(0);
  });
});
