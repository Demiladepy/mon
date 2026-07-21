import { z } from "zod";

const accountNumber = z.string().regex(/^\d{10}$/, "Must be a 10-digit NUBAN");
const bankCode = z.string().regex(/^\d{3,6}$/, "Invalid bank code");
const idempotencyKey = z.string().min(8).max(128);

export const paymentIntentSchema = z
  .object({
    action: z.enum(["PAYOUT", "BILL", "CREATE_ACCOUNT", "VERIFY", "READ"]),
    amountKobo: z.number().int().positive().optional(),
    beneficiaryAccount: accountNumber.optional(),
    beneficiaryBankCode: bankCode.optional(),
    expectedBeneficiaryName: z.string().trim().min(2).max(120).optional(),
    category: z.string().trim().min(1).max(50).optional(),
    idempotencyKey,
    reason: z.string().max(500).optional(),
  })
  .strict()
  .superRefine((intent, context) => {
    if (
      intent.action === "PAYOUT" &&
      (!intent.amountKobo ||
        !intent.beneficiaryAccount ||
        !intent.beneficiaryBankCode ||
        !intent.expectedBeneficiaryName)
    ) {
      context.addIssue({
        code: "custom",
        message:
          "PAYOUT requires amountKobo, beneficiaryAccount, beneficiaryBankCode, and expectedBeneficiaryName",
      });
    }
  });

export type PaymentIntent = z.infer<typeof paymentIntentSchema>;

export const payoutToolInput = {
  amountKobo: z.number().int().positive().describe("Amount in integer kobo"),
  beneficiaryAccount: accountNumber,
  beneficiaryBankCode: bankCode,
  expectedBeneficiaryName: z.string().trim().min(2).max(120),
  category: z.string().trim().min(1).max(50).default("supplier"),
  idempotencyKey,
  reason: z.string().max(500).optional(),
};

export const walletBalanceToolInput = {
  idempotencyKey,
};

export const policyExplainToolInput = payoutToolInput;

export const verifyAccountToolInput = {
  beneficiaryAccount: accountNumber,
  beneficiaryBankCode: bankCode,
  expectedBeneficiaryName: z.string().trim().min(2).max(120),
  idempotencyKey,
};

export const reservedAccountSchema = z
  .object({
    accountReference: z.string().min(8).max(100),
    accountName: z.string().trim().min(2).max(100),
    customerName: z.string().trim().min(2).max(100),
    customerEmail: z.email(),
    bvn: z.string().regex(/^\d{11}$/).optional(),
    nin: z.string().regex(/^\d{11}$/).optional(),
    idempotencyKey,
  })
  .strict()
  .refine((value) => value.bvn || value.nin, {
    message: "A valid BVN or NIN is required",
  });

export const reservedAccountToolInput = {
  accountReference: z.string().min(8).max(100),
  accountName: z.string().trim().min(2).max(100),
  customerName: z.string().trim().min(2).max(100),
  customerEmail: z.email(),
  bvn: z.string().regex(/^\d{11}$/).optional(),
  nin: z.string().regex(/^\d{11}$/).optional(),
  idempotencyKey,
};

export type ReservedAccountInput = z.infer<typeof reservedAccountSchema>;

export const knownToolFields = new Set([
  "amountKobo",
  "beneficiaryAccount",
  "beneficiaryBankCode",
  "expectedBeneficiaryName",
  "category",
  "idempotencyKey",
  "reason",
]);

export function hasPolicyTamperFields(input: unknown): boolean {
  if (!input || typeof input !== "object" || Array.isArray(input)) return false;
  return Object.keys(input).some((key) => !knownToolFields.has(key));
}
