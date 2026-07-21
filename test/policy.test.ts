import { describe, expect, it } from "vitest";
import type { PaymentIntent } from "../src/mcp/tools.js";
import {
  evaluate,
  namesMatch,
  type AgentContext,
} from "../src/policy/engine.js";
import { defaultPolicy } from "../src/policy/rules.js";

const intent: PaymentIntent = {
  action: "PAYOUT",
  amountKobo: 850_000,
  beneficiaryAccount: "0123456789",
  beneficiaryBankCode: "058",
  expectedBeneficiaryName: "Musa Ibrahim",
  category: "supplier",
  idempotencyKey: "test-legit-001",
  reason: "Flour delivery",
};

const context: AgentContext = {
  agentId: "test-agent",
  resolvedBeneficiaryName: "MUSA IBRAHIM",
  executedTodayKobo: 0,
  payoutsInVelocityWindow: 0,
};

describe("deterministic policy engine", () => {
  it("allows a legitimate allowlisted payout", () => {
    expect(evaluate(intent, context, defaultPolicy)).toEqual({
      effect: "ALLOW",
      reasons: ["All deterministic payout rules passed."],
      matchedRules: [],
    });
  });

  it("requires approval for a non-allowlisted beneficiary", () => {
    const decision = evaluate(
      { ...intent, beneficiaryAccount: "1234567890" },
      context,
      defaultPolicy,
    );
    expect(decision.effect).toBe("REQUIRE_APPROVAL");
    expect(decision.matchedRules).toContain("BENEFICIARY_ALLOWLIST");
  });

  it("denies an injected large payout for every hard failure", () => {
    const decision = evaluate(
      {
        ...intent,
        amountKobo: 50_000_000,
        beneficiaryAccount: "9911223344",
        beneficiaryBankCode: "044",
        expectedBeneficiaryName: "Admin Approved Supplier",
      },
      {
        ...context,
        resolvedBeneficiaryName: "ADAEZE OKAFOR",
      },
      defaultPolicy,
    );
    expect(decision.effect).toBe("DENY");
    expect(decision.matchedRules).toEqual(
      expect.arrayContaining([
        "PER_TRANSACTION_CAP",
        "DAILY_AGGREGATE_CAP",
        "BENEFICIARY_ALLOWLIST",
        "NAME_INQUIRY_MATCH",
        "APPROVAL_THRESHOLD",
      ]),
    );
  });

  it("denies when daily spend would cross the aggregate cap", () => {
    const decision = evaluate(
      intent,
      {
        ...context,
        executedTodayKobo:
          defaultPolicy.maxPerDayKobo - intent.amountKobo! + 1,
      },
      defaultPolicy,
    );
    expect(decision.effect).toBe("DENY");
    expect(decision.matchedRules).toContain("DAILY_AGGREGATE_CAP");
  });

  it("requires approval at the configured threshold", () => {
    const decision = evaluate(
      { ...intent, amountKobo: defaultPolicy.approvalThresholdKobo },
      context,
      defaultPolicy,
    );
    expect(decision.effect).toBe("REQUIRE_APPROVAL");
    expect(decision.matchedRules).toContain("APPROVAL_THRESHOLD");
  });

  it("matches reordered names but rejects different people", () => {
    expect(namesMatch("Ibrahim, Musa", "MUSA IBRAHIM")).toBe(true);
    expect(namesMatch("Musa Ibrahim", "Adaeze Okafor")).toBe(false);
  });
});
