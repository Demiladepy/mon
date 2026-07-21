import type { PaymentIntent } from "../mcp/tools.js";
import type { Policy } from "./rules.js";

export type DecisionEffect = "ALLOW" | "DENY" | "REQUIRE_APPROVAL";

export type Decision = {
  effect: DecisionEffect;
  reasons: string[];
  matchedRules: string[];
};

export type AgentContext = {
  agentId: string;
  resolvedBeneficiaryName?: string;
  executedTodayKobo: number;
  payoutsInVelocityWindow: number;
};

function normalizedNameTokens(name: string): Set<string> {
  return new Set(
    name
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .toUpperCase()
      .replace(/[^A-Z0-9 ]/g, " ")
      .split(/\s+/)
      .filter((token) => token.length > 1),
  );
}

export function namesMatch(expected: string, resolved: string): boolean {
  const expectedTokens = normalizedNameTokens(expected);
  const resolvedTokens = normalizedNameTokens(resolved);
  if (expectedTokens.size === 0 || resolvedTokens.size === 0) return false;

  const overlap = [...expectedTokens].filter((token) =>
    resolvedTokens.has(token),
  ).length;
  return overlap / Math.max(expectedTokens.size, resolvedTokens.size) >= 0.67;
}

export function evaluate(
  intent: PaymentIntent,
  context: AgentContext,
  policy: Policy,
): Decision {
  const reasons: string[] = [];
  const matchedRules: string[] = [];
  let effect: DecisionEffect = "ALLOW";

  const deny = (rule: string, reason: string) => {
    matchedRules.push(rule);
    reasons.push(reason);
    effect = "DENY";
  };
  const approve = (rule: string, reason: string) => {
    matchedRules.push(rule);
    reasons.push(reason);
    if (effect !== "DENY") effect = "REQUIRE_APPROVAL";
  };

  if (intent.action !== "PAYOUT") {
    return {
      effect,
      reasons: ["No payout policy rule blocks this validated action."],
      matchedRules,
    };
  }

  const amountKobo = intent.amountKobo!;
  if (amountKobo > policy.maxPerTxnKobo) {
    deny(
      "PER_TRANSACTION_CAP",
      `Amount ${amountKobo} kobo exceeds per-transaction cap ${policy.maxPerTxnKobo} kobo.`,
    );
  }

  if (context.executedTodayKobo + amountKobo > policy.maxPerDayKobo) {
    deny(
      "DAILY_AGGREGATE_CAP",
      `Daily spend would exceed ${policy.maxPerDayKobo} kobo.`,
    );
  }

  const allowlisted = policy.beneficiaryAllowlist.some(
    (beneficiary) =>
      beneficiary.accountNumber === intent.beneficiaryAccount &&
      beneficiary.bankCode === intent.beneficiaryBankCode,
  );
  if (!allowlisted) {
    approve(
      "BENEFICIARY_ALLOWLIST",
      "Beneficiary is not allowlisted and requires human approval.",
    );
  }

  if (
    !context.resolvedBeneficiaryName ||
    !namesMatch(
      intent.expectedBeneficiaryName!,
      context.resolvedBeneficiaryName,
    )
  ) {
    deny(
      "NAME_INQUIRY_MATCH",
      `Expected beneficiary name does not match resolved name "${context.resolvedBeneficiaryName ?? "unavailable"}".`,
    );
  }

  if (context.payoutsInVelocityWindow >= policy.velocity.maxPayouts) {
    deny(
      "VELOCITY_LIMIT",
      `Payout velocity limit of ${policy.velocity.maxPayouts} was reached.`,
    );
  }

  if (amountKobo >= policy.approvalThresholdKobo) {
    approve(
      "APPROVAL_THRESHOLD",
      `Amount meets the ${policy.approvalThresholdKobo} kobo approval threshold.`,
    );
  }

  if (reasons.length === 0) {
    reasons.push("All deterministic payout rules passed.");
  }

  return { effect, reasons, matchedRules };
}
