import { createHash } from "node:crypto";

export type NameInquiryResult = {
  accountNumber: string;
  accountName: string;
  bankCode: string;
};

export type TransferRequest = {
  amountKobo: number;
  reference: string;
  narration: string;
  destinationBankCode: string;
  destinationAccountNumber: string;
  destinationAccountName: string;
};

export type ReservedAccountRequest = {
  accountReference: string;
  accountName: string;
  customerEmail: string;
  customerName: string;
};

const knownNames: Record<string, string> = {
  "058:0123456789": "MUSA IBRAHIM",
  "057:2085096393": "MARVELOUS BENJI",
  "044:9911223344": "ADAEZE OKAFOR",
};

function deterministicId(prefix: string, value: string): string {
  return `${prefix}_${createHash("sha256").update(value).digest("hex").slice(0, 20)}`;
}

export function mockNameInquiry(
  accountNumber: string,
  bankCode: string,
): NameInquiryResult {
  return {
    accountNumber,
    bankCode,
    accountName:
      knownNames[`${bankCode}:${accountNumber}`] ?? "UNRECOGNIZED DEMO ACCOUNT",
  };
}

export function mockTransfer(request: TransferRequest) {
  return {
    requestSuccessful: true,
    responseMessage: "success",
    responseCode: "0",
    responseBody: {
      amountKobo: request.amountKobo,
      reference: request.reference,
      status: "SUCCESS",
      dateCreated: "2026-07-21T04:30:00.000Z",
      totalFeeKobo: 1_000,
      sessionId: deterministicId("session", request.reference),
      destinationAccountName: request.destinationAccountName,
      destinationBankName: "DRY RUN BANK",
      destinationAccountNumber: request.destinationAccountNumber,
      destinationBankCode: request.destinationBankCode,
    },
  } as const;
}

export function mockWalletBalance(accountNumber: string) {
  return {
    requestSuccessful: true,
    responseMessage: "success",
    responseCode: "0",
    responseBody: {
      availableBalanceKobo: 24_500_000,
      ledgerBalanceKobo: 25_000_000,
      accountNumber: accountNumber || "9999999999",
      currency: "NGN",
    },
  } as const;
}

export function mockReservedAccount(request: ReservedAccountRequest) {
  const suffix = createHash("sha256")
    .update(request.accountReference)
    .digest("hex")
    .replace(/\D/g, "")
    .padEnd(10, "7")
    .slice(0, 10);

  return {
    requestSuccessful: true,
    responseMessage: "success",
    responseCode: "0",
    responseBody: {
      contractCode: "DRY_RUN_CONTRACT",
      accountReference: request.accountReference,
      accountName: request.accountName,
      currencyCode: "NGN",
      customerEmail: request.customerEmail,
      customerName: request.customerName,
      accounts: [
        {
          bankCode: "50515",
          bankName: "Moniepoint Microfinance Bank",
          accountNumber: suffix,
          accountName: request.accountName,
        },
      ],
      collectionChannel: "RESERVED_ACCOUNT",
      reservationReference: deterministicId(
        "reserve",
        request.accountReference,
      ),
      reservedAccountType: "GENERAL",
      status: "ACTIVE",
    },
  } as const;
}
