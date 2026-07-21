import { ZodError } from "zod";
import {
  fullAccessPrincipal,
  type AgentPrincipal,
  type Capability,
} from "./agent/registry.js";
import { appendAudit } from "./ledger/audit.js";
import {
  Ledger,
  type CollectionRecord,
  type StoredOutcome,
} from "./ledger/db.js";
import {
  hasPolicyTamperFields,
  knownToolFields,
  paymentIntentSchema,
  reservedAccountSchema,
  type PaymentIntent,
  type ReservedAccountInput,
} from "./mcp/tools.js";
import { MonnifyClient } from "./monnify/client.js";
import {
  evaluate,
  namesMatch,
  type AgentContext,
  type Decision,
} from "./policy/engine.js";
import type { Policy } from "./policy/rules.js";

export type ReinResponse =
  | {
      ok: true;
      replayed: boolean;
      decision: Decision;
      status: string;
      result?: unknown;
    }
  | {
      ok: false;
      status: "INVALID_INTENT";
      errors: string[];
    };

function formatStoredOutcome(outcome: StoredOutcome): ReinResponse {
  if (!outcome.decision) {
    return {
      ok: false,
      status: "INVALID_INTENT",
      errors: ["An identical request is already processing."],
    };
  }
  return {
    ok: true,
    replayed: true,
    decision: outcome.decision,
    status: outcome.status,
    result: outcome.result,
  };
}

export class ReinService {
  private readonly principal: AgentPrincipal;
  private readonly agentId: string;

  constructor(
    private readonly ledger: Ledger,
    private readonly monnify: MonnifyClient,
    private readonly policy: Policy,
    principal: string | AgentPrincipal,
  ) {
    this.principal =
      typeof principal === "string"
        ? fullAccessPrincipal(principal)
        : principal;
    this.agentId = this.principal.agentId;
  }

  /**
   * Trust-boundary check: does this principal even have standing to attempt the
   * action? Runs before any money-path logic, so a missing capability short-
   * circuits regardless of what the model was tricked into requesting.
   */
  private denyCapability(
    capability: Capability,
    idempotencyKey?: string,
  ): ReinResponse | null {
    if (this.principal.capabilities.includes(capability)) return null;
    appendAudit(
      this.ledger,
      "CAPABILITY_DENIED",
      { capability, agentId: this.agentId },
      this.agentId,
      idempotencyKey,
    );
    return {
      ok: true,
      replayed: false,
      decision: {
        effect: "DENY",
        reasons: [
          `Agent "${this.principal.label}" lacks the "${capability}" capability.`,
        ],
        matchedRules: ["CAPABILITY"],
      },
      status: "DENIED",
    };
  }

  private assertCapability(capability: Capability): void {
    if (this.principal.capabilities.includes(capability)) return;
    appendAudit(
      this.ledger,
      "CAPABILITY_DENIED",
      { capability, agentId: this.agentId },
      this.agentId,
    );
    throw new Error(
      `Agent "${this.principal.label}" lacks the "${capability}" capability.`,
    );
  }

  identity(): {
    agentId: string;
    label: string;
    description?: string;
    capabilities: Capability[];
    grant: AgentPrincipal["grant"];
  } {
    return {
      agentId: this.principal.agentId,
      label: this.principal.label,
      description: this.principal.description,
      capabilities: [...this.principal.capabilities],
      grant: structuredClone(this.principal.grant),
    };
  }

  async payout(rawInput: unknown): Promise<ReinResponse> {
    const idempotencyKeyForCap =
      rawInput &&
      typeof rawInput === "object" &&
      "idempotencyKey" in rawInput &&
      typeof rawInput.idempotencyKey === "string"
        ? rawInput.idempotencyKey
        : undefined;
    const capabilityDenied = this.denyCapability(
      "payout.initiate",
      idempotencyKeyForCap,
    );
    if (capabilityDenied) return capabilityDenied;

    if (hasPolicyTamperFields(rawInput)) {
      const idempotencyKey =
        rawInput &&
        typeof rawInput === "object" &&
        "idempotencyKey" in rawInput &&
        typeof rawInput.idempotencyKey === "string"
          ? rawInput.idempotencyKey
          : undefined;
      appendAudit(
        this.ledger,
        "POLICY_TAMPER_ATTEMPT",
        {
          rejectedFields: Object.keys(rawInput as object).filter(
            (field) => !knownToolFields.has(field),
          ),
        },
        this.agentId,
        idempotencyKey,
      );
    }

    let intent: PaymentIntent;
    try {
      intent = paymentIntentSchema.parse({
        ...(rawInput as object),
        action: "PAYOUT",
      });
    } catch (error) {
      const messages =
        error instanceof ZodError
          ? error.issues.map((issue) => issue.message)
          : ["Invalid payout intent"];
      return { ok: false, status: "INVALID_INTENT", errors: messages };
    }

    const existing = this.ledger.getOutcome(intent.idempotencyKey);
    if (existing) {
      appendAudit(
        this.ledger,
        "IDEMPOTENT_REPLAY",
        { status: existing.status },
        this.agentId,
        intent.idempotencyKey,
      );
      return formatStoredOutcome(existing);
    }

    if (!this.ledger.claimIntent(this.agentId, intent)) {
      return formatStoredOutcome(this.ledger.getOutcome(intent.idempotencyKey)!);
    }
    appendAudit(
      this.ledger,
      "INTENT_RECEIVED",
      { intent },
      this.agentId,
      intent.idempotencyKey,
    );

    let resolvedBeneficiaryName: string | undefined;
    try {
      const inquiry = await this.monnify.nameInquiry(
        intent.beneficiaryAccount!,
        intent.beneficiaryBankCode!,
      );
      resolvedBeneficiaryName = inquiry.accountName;
    } catch (error) {
      appendAudit(
        this.ledger,
        "PROVIDER_ERROR",
        { operation: "NAME_INQUIRY", message: (error as Error).message },
        this.agentId,
        intent.idempotencyKey,
      );
    }

    const windowStart = new Date(
      Date.now() - this.policy.velocity.windowMinutes * 60_000,
    ).toISOString();
    const context: AgentContext = {
      agentId: this.agentId,
      resolvedBeneficiaryName,
      executedTodayKobo: this.ledger.executedTodayKobo(this.agentId),
      payoutsInVelocityWindow: this.ledger.payoutCountSince(
        this.agentId,
        windowStart,
      ),
    };
    const decision = evaluate(intent, context, this.policy, this.principal.grant);

    if (decision.effect === "DENY") {
      this.ledger.complete(intent, decision, "DENIED");
      appendAudit(
        this.ledger,
        "POLICY_DENIED",
        { decision, context },
        this.agentId,
        intent.idempotencyKey,
      );
      return { ok: true, replayed: false, decision, status: "DENIED" };
    }

    if (decision.effect === "REQUIRE_APPROVAL") {
      this.ledger.complete(intent, decision, "PENDING_APPROVAL");
      appendAudit(
        this.ledger,
        "APPROVAL_REQUIRED",
        { decision, context },
        this.agentId,
        intent.idempotencyKey,
      );
      return {
        ok: true,
        replayed: false,
        decision,
        status: "PENDING_APPROVAL",
      };
    }

    appendAudit(
      this.ledger,
      "POLICY_ALLOWED",
      { decision, context },
      this.agentId,
      intent.idempotencyKey,
    );
    try {
      const result = await this.monnify.transfer({
        amountKobo: intent.amountKobo!,
        reference: intent.idempotencyKey,
        narration: intent.reason ?? "Agent-authorized payout",
        destinationBankCode: intent.beneficiaryBankCode!,
        destinationAccountNumber: intent.beneficiaryAccount!,
        destinationAccountName: resolvedBeneficiaryName!,
      });
      const providerReference =
        "responseBody" in result &&
        result.responseBody &&
        typeof result.responseBody === "object" &&
        "reference" in result.responseBody
          ? String(result.responseBody.reference)
          : intent.idempotencyKey;
      this.ledger.complete(
        intent,
        decision,
        "SUCCESS",
        result,
        providerReference,
      );
      appendAudit(
        this.ledger,
        "PAYOUT_EXECUTED",
        { providerReference },
        this.agentId,
        intent.idempotencyKey,
      );
      return {
        ok: true,
        replayed: false,
        decision,
        status: "SUCCESS",
        result,
      };
    } catch (error) {
      const safeError = { message: (error as Error).message };
      this.ledger.complete(intent, decision, "PROVIDER_ERROR", safeError);
      appendAudit(
        this.ledger,
        "PROVIDER_ERROR",
        safeError,
        this.agentId,
        intent.idempotencyKey,
      );
      return {
        ok: true,
        replayed: false,
        decision,
        status: "PROVIDER_ERROR",
        result: safeError,
      };
    }
  }

  async walletBalance(): Promise<unknown> {
    this.assertCapability("wallet.balance");
    return this.monnify.walletBalance();
  }

  async createReservedAccount(rawInput: unknown): Promise<ReinResponse> {
    const idempotencyKeyForCap =
      rawInput &&
      typeof rawInput === "object" &&
      "idempotencyKey" in rawInput &&
      typeof rawInput.idempotencyKey === "string"
        ? rawInput.idempotencyKey
        : undefined;
    const capabilityDenied = this.denyCapability(
      "collect.create_virtual_account",
      idempotencyKeyForCap,
    );
    if (capabilityDenied) return capabilityDenied;

    let input: ReservedAccountInput;
    try {
      input = reservedAccountSchema.parse(rawInput);
    } catch (error) {
      return {
        ok: false,
        status: "INVALID_INTENT",
        errors:
          error instanceof ZodError
            ? error.issues.map((issue) => issue.message)
            : ["Invalid reserved account request"],
      };
    }

    const existing = this.ledger.getOutcome(input.idempotencyKey);
    if (existing) return formatStoredOutcome(existing);

    const intent: PaymentIntent = {
      action: "CREATE_ACCOUNT",
      idempotencyKey: input.idempotencyKey,
      reason: `Reserved collection account for ${input.customerName}`,
    };
    if (!this.ledger.claimIntent(this.agentId, intent)) {
      return formatStoredOutcome(this.ledger.getOutcome(input.idempotencyKey)!);
    }
    const decision: Decision = {
      effect: "ALLOW",
      reasons: ["Validated collection account request."],
      matchedRules: [],
    };

    try {
      const result = await this.monnify.createReservedAccount(input);
      const body =
        "responseBody" in result && typeof result.responseBody === "object"
          ? (result.responseBody as {
              accounts?: Array<{
                accountNumber?: string;
                bankName?: string;
              }>;
            })
          : undefined;
      const account = body?.accounts?.[0];
      this.ledger.saveReservedAccount({
        accountReference: input.accountReference,
        accountName: input.accountName,
        customerName: input.customerName,
        customerEmail: input.customerEmail,
        accountNumber: account?.accountNumber,
        bankName: account?.bankName,
        result,
      });
      this.ledger.complete(
        intent,
        decision,
        "SUCCESS",
        result,
        input.accountReference,
      );
      appendAudit(
        this.ledger,
        "RESERVED_ACCOUNT_CREATED",
        {
          accountReference: input.accountReference,
          customerName: input.customerName,
        },
        this.agentId,
        input.idempotencyKey,
      );
      return {
        ok: true,
        replayed: false,
        decision,
        status: "SUCCESS",
        result,
      };
    } catch (error) {
      const safeError = { message: (error as Error).message };
      this.ledger.complete(intent, decision, "PROVIDER_ERROR", safeError);
      return {
        ok: true,
        replayed: false,
        decision,
        status: "PROVIDER_ERROR",
        result: safeError,
      };
    }
  }

  async verifyAccount(input: {
    beneficiaryAccount: string;
    beneficiaryBankCode: string;
    expectedBeneficiaryName: string;
  }): Promise<unknown> {
    this.assertCapability("verify.customer");
    const inquiry = await this.monnify.nameInquiry(
      input.beneficiaryAccount,
      input.beneficiaryBankCode,
    );
    return {
      ...inquiry,
      matchesExpectedName: namesMatch(
        input.expectedBeneficiaryName,
        inquiry.accountName,
      ),
    };
  }

  async explain(rawInput: unknown): Promise<Decision> {
    this.assertCapability("policy.explain");
    const intent = paymentIntentSchema.parse({
      ...(rawInput as object),
      action: "PAYOUT",
    });
    const inquiry = await this.monnify.nameInquiry(
      intent.beneficiaryAccount!,
      intent.beneficiaryBankCode!,
    );
    const windowStart = new Date(
      Date.now() - this.policy.velocity.windowMinutes * 60_000,
    ).toISOString();
    return evaluate(
      intent,
      {
        agentId: this.agentId,
        resolvedBeneficiaryName: inquiry.accountName,
        executedTodayKobo: this.ledger.executedTodayKobo(this.agentId),
        payoutsInVelocityWindow: this.ledger.payoutCountSince(
          this.agentId,
          windowStart,
        ),
      },
      this.policy,
      this.principal.grant,
    );
  }

  recordCollection(collection: CollectionRecord, payload: unknown): boolean {
    const inserted = this.ledger.recordCollection(collection, payload);
    if (inserted) {
      appendAudit(
        this.ledger,
        "COLLECTION_RECEIVED",
        {
          transactionReference: collection.transactionReference,
          amountKobo: collection.amountKobo,
          accountReference: collection.accountReference,
        },
        this.agentId,
      );
    }
    return inserted;
  }

  async approvePayout(idempotencyKey: string): Promise<StoredOutcome> {
    const pending = this.ledger.getOutcome(idempotencyKey);
    if (
      !pending?.decision ||
      pending.status !== "PENDING_APPROVAL" ||
      pending.intent.action !== "PAYOUT"
    ) {
      throw new Error("Payout approval is not pending");
    }
    const intent = pending.intent;
    const inquiry = await this.monnify.nameInquiry(
      intent.beneficiaryAccount!,
      intent.beneficiaryBankCode!,
    );
    if (!namesMatch(intent.expectedBeneficiaryName!, inquiry.accountName)) {
      const outcome = this.ledger.updateApprovalOutcome(
        idempotencyKey,
        "DENIED",
        { message: "Beneficiary name changed before approval." },
      );
      appendAudit(
        this.ledger,
        "APPROVAL_DENIED",
        { reason: "Name inquiry mismatch on approval re-check." },
        this.agentId,
        idempotencyKey,
      );
      return outcome;
    }

    try {
      const result = await this.monnify.transfer({
        amountKobo: intent.amountKobo!,
        reference: intent.idempotencyKey,
        narration: intent.reason ?? "Human-approved payout",
        destinationBankCode: intent.beneficiaryBankCode!,
        destinationAccountNumber: intent.beneficiaryAccount!,
        destinationAccountName: inquiry.accountName,
      });
      const outcome = this.ledger.updateApprovalOutcome(
        idempotencyKey,
        "SUCCESS",
        result,
        idempotencyKey,
      );
      appendAudit(
        this.ledger,
        "APPROVAL_APPROVED",
        { providerReference: idempotencyKey },
        this.agentId,
        idempotencyKey,
      );
      return outcome;
    } catch (error) {
      return this.ledger.updateApprovalOutcome(
        idempotencyKey,
        "PROVIDER_ERROR",
        { message: (error as Error).message },
      );
    }
  }

  denyPayout(idempotencyKey: string): StoredOutcome {
    const outcome = this.ledger.updateApprovalOutcome(
      idempotencyKey,
      "DENIED",
      { message: "Denied by human approver." },
    );
    appendAudit(
      this.ledger,
      "APPROVAL_DENIED",
      { reason: "Denied by human approver." },
      this.agentId,
      idempotencyKey,
    );
    return outcome;
  }

  async dashboard(): Promise<unknown> {
    return {
      generatedAt: new Date().toISOString(),
      dryRun: this.monnify.isDryRun(),
      wallet: await this.walletBalance(),
      metrics: {
        collectedTodayKobo: this.ledger.collectedTodayKobo(),
        paidTodayKobo: this.ledger.executedTodayKobo(this.agentId),
      },
      collections: this.ledger.listCollections(12),
      approvals: this.ledger.listPendingApprovals(12),
      accounts: this.ledger.listReservedAccounts(12),
      payouts: this.ledger.listPayouts(12),
      activity: this.ledger.listAudit(30),
    };
  }

  collections(limit = 50): unknown[] {
    return this.ledger.listCollections(limit);
  }

  reservedAccounts(limit = 50): unknown[] {
    return this.ledger.listReservedAccounts(limit);
  }

  payouts(limit = 50): unknown[] {
    return this.ledger.listPayouts(limit);
  }

  pendingApprovals(limit = 50): unknown[] {
    return this.ledger.listPendingApprovals(limit);
  }

  policySnapshot(): Policy {
    return structuredClone(this.policy);
  }

  auditTrail(limit = 50): unknown[] {
    return this.ledger.listAudit(limit);
  }
}
