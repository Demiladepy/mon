import type { AgentGrant } from "../agent/registry.js";
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

function minDefined(a: number, b: number | undefined): number {
  return b === undefined ? a : Math.min(a, b);
}

export function evaluate(
  intent: PaymentIntent,
  context: AgentContext,
  policy: Policy,
  grant: AgentGrant = {},
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

  // The effective ceiling is the tighter of the global policy and this agent's
  // scoped grant. A grant can only ever narrow authority, never widen it.
  const maxPerTxnKobo = minDefined(policy.maxPerTxnKobo, grant.maxPerTxnKobo);
  const maxPerDayKobo = minDefined(policy.maxPerDayKobo, grant.maxPerDayKobo);
  const approvalThresholdKobo = minDefined(
    policy.approvalThresholdKobo,
    grant.approvalThresholdKobo,
  );

  const amountKobo = intent.amountKobo!;
  if (amountKobo > maxPerTxnKobo) {
    deny(
      "PER_TRANSACTION_CAP",
      `Amount ${amountKobo} kobo exceeds per-transaction cap ${maxPerTxnKobo} kobo.`,
    );
  }

  if (context.executedTodayKobo + amountKobo > maxPerDayKobo) {
    deny(
      "DAILY_AGGREGATE_CAP",
      `Daily spend would exceed ${maxPerDayKobo} kobo.`,
    );
  }

  if (
    grant.allowedCategories &&
    grant.allowedCategories.length > 0 &&
    (!intent.category || !grant.allowedCategories.includes(intent.category))
  ) {
    deny(
      "AGENT_CATEGORY_SCOPE",
      `Category "${intent.category ?? "unspecified"}" is outside this agent's allowed categories.`,
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

  if (amountKobo >= approvalThresholdKobo) {
    approve(
      "APPROVAL_THRESHOLD",
      `Amount meets the ${approvalThresholdKobo} kobo approval threshold.`,
    );
  }

  if (reasons.length === 0) {
    reasons.push("All deterministic payout rules passed.");
  }

  return { effect, reasons, matchedRules };
}
