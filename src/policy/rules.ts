import defaults from "./rules.default.json" with { type: "json" };

export type Beneficiary = {
  accountNumber: string;
  bankCode: string;
  name: string;
};

export type Policy = {
  maxPerTxnKobo: number;
  maxPerDayKobo: number;
  approvalThresholdKobo: number;
  velocity: {
    maxPayouts: number;
    windowMinutes: number;
  };
  beneficiaryAllowlist: Beneficiary[];
};

export const defaultPolicy: Policy = defaults;
