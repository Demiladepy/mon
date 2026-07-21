export type Intent = {
  action?: string;
  amountKobo?: number;
  beneficiaryAccount?: string;
  beneficiaryBankCode?: string;
  expectedBeneficiaryName?: string;
  category?: string;
  idempotencyKey?: string;
  reason?: string;
};

export type Approval = {
  idempotency_key: string;
  amount_kobo: number;
  intent: Intent;
  reasons: string[];
  matchedRules: string[];
  created_at: string;
};

export type Collection = {
  transaction_reference: string;
  amount_kobo: number;
  account_reference: string;
  customer_name?: string;
  status: string;
  paid_at?: string;
  created_at: string;
};

export type Activity = {
  id: number;
  event_type: string;
  agent_id?: string;
  idempotency_key?: string;
  created_at: string;
  details: Record<string, unknown>;
};

export type ReservedAccount = {
  account_reference: string;
  account_name: string;
  customer_name: string;
  customer_email: string;
  account_number?: string;
  bank_name?: string;
  created_at: string;
};

export type Payout = {
  idempotencyKey: string;
  amountKobo: number;
  effect: "ALLOW" | "DENY" | "REQUIRE_APPROVAL";
  status: string;
  providerReference?: string;
  createdAt: string;
  intent: Intent;
  reasons: string[];
  matchedRules: string[];
  result?: unknown;
};

export type Policy = {
  maxPerTxnKobo: number;
  maxPerDayKobo: number;
  approvalThresholdKobo: number;
  velocity: {
    maxPayouts: number;
    windowMinutes: number;
  };
  beneficiaryAllowlist: Array<{
    accountNumber: string;
    bankCode: string;
    name: string;
  }>;
};

export type DashboardData = {
  dryRun: boolean;
  generatedAt: string;
  wallet: {
    responseBody?: {
      availableBalanceKobo?: number;
      availableBalance?: number;
      accountNumber?: string;
      currency?: string;
    };
  };
  metrics: {
    collectedTodayKobo: number;
    paidTodayKobo: number;
  };
  collections: Collection[];
  approvals: Approval[];
  accounts: ReservedAccount[];
  payouts: Payout[];
  activity: Activity[];
};
