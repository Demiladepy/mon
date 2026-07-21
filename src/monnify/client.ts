import type { Config } from "../config.js";
import {
  mockNameInquiry,
  mockReservedAccount,
  mockTransfer,
  mockWalletBalance,
  type ReservedAccountRequest,
  type TransferRequest,
} from "./mock.js";

type MonnifyEnvelope<T> = {
  requestSuccessful: boolean;
  responseMessage: string;
  responseCode: string;
  responseBody: T;
};

type TokenResponse = MonnifyEnvelope<{
  accessToken: string;
  expiresIn?: number;
}>;

export class MonnifyClient {
  private accessToken?: string;
  private tokenExpiresAt = 0;

  constructor(private readonly settings: Config) {}

  isDryRun(): boolean {
    return this.settings.DRY_RUN;
  }

  private async authenticate(): Promise<string> {
    if (this.accessToken && Date.now() < this.tokenExpiresAt) {
      return this.accessToken;
    }

    const credentials = Buffer.from(
      `${this.settings.MONNIFY_API_KEY}:${this.settings.MONNIFY_SECRET_KEY}`,
    ).toString("base64");
    const response = await fetch(
      `${this.settings.MONNIFY_BASE_URL}/api/v1/auth/login`,
      {
        method: "POST",
        headers: { Authorization: `Basic ${credentials}` },
      },
    );
    if (!response.ok) {
      throw new Error(`Monnify authentication failed (${response.status})`);
    }
    const body = (await response.json()) as TokenResponse;
    this.accessToken = body.responseBody.accessToken;
    const ttlSeconds = Math.max(60, body.responseBody.expiresIn ?? 3_600);
    this.tokenExpiresAt = Date.now() + (ttlSeconds - 30) * 1_000;
    return this.accessToken;
  }

  private async request<T>(
    path: string,
    init: RequestInit = {},
    retryAfterUnauthorized = true,
  ): Promise<T> {
    const token = await this.authenticate();
    const response = await fetch(`${this.settings.MONNIFY_BASE_URL}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        ...init.headers,
      },
    });

    if (response.status === 401 && retryAfterUnauthorized) {
      this.accessToken = undefined;
      this.tokenExpiresAt = 0;
      return this.request<T>(path, init, false);
    }
    if (!response.ok) {
      throw new Error(`Monnify request failed (${response.status})`);
    }
    return (await response.json()) as T;
  }

  async nameInquiry(
    accountNumber: string,
    bankCode: string,
  ): Promise<{
    accountNumber: string;
    accountName: string;
    bankCode: string;
  }> {
    if (this.settings.DRY_RUN) {
      return mockNameInquiry(accountNumber, bankCode);
    }
    const query = new URLSearchParams({ accountNumber, bankCode });
    const response = await this.request<
      MonnifyEnvelope<{
        accountNumber: string;
        accountName: string;
        bankCode: string;
      }>
    >(`/api/v2/disbursements/account/validate?${query}`);
    return response.responseBody;
  }

  async transfer(request: TransferRequest) {
    if (this.settings.DRY_RUN) return mockTransfer(request);

    const senderInfo =
      this.settings.MONNIFY_SENDER_BANK_CODE &&
      this.settings.MONNIFY_SOURCE_ACCOUNT
        ? {
            sourceAccountName: this.settings.MONNIFY_SENDER_NAME,
            sourceAccountNumber: this.settings.MONNIFY_SOURCE_ACCOUNT,
            senderBankCode: this.settings.MONNIFY_SENDER_BANK_CODE,
          }
        : undefined;

    return this.request<MonnifyEnvelope<Record<string, unknown>>>(
      "/api/v2/disbursements/single",
      {
        method: "POST",
        body: JSON.stringify({
          amount: request.amountKobo / 100,
          reference: request.reference,
          narration: request.narration,
          destinationBankCode: request.destinationBankCode,
          destinationAccountNumber: request.destinationAccountNumber,
          destinationAccountName: request.destinationAccountName,
          currency: "NGN",
          sourceAccountNumber: this.settings.MONNIFY_SOURCE_ACCOUNT,
          ...(senderInfo ? { senderInfo } : {}),
        }),
      },
    );
  }

  async walletBalance() {
    if (this.settings.DRY_RUN) {
      return mockWalletBalance(
        this.settings.MONNIFY_SOURCE_ACCOUNT,
        this.settings.DRY_RUN_WALLET_BALANCE_KOBO,
      );
    }
    const query = new URLSearchParams({
      accountNumber: this.settings.MONNIFY_SOURCE_ACCOUNT,
    });
    return this.request<MonnifyEnvelope<Record<string, unknown>>>(
      `/api/v2/disbursements/wallet-balance?${query}`,
    );
  }

  async createReservedAccount(
    request: ReservedAccountRequest & { bvn?: string; nin?: string },
  ) {
    if (this.settings.DRY_RUN) return mockReservedAccount(request);

    return this.request<MonnifyEnvelope<Record<string, unknown>>>(
      "/api/v2/bank-transfer/reserved-accounts",
      {
        method: "POST",
        body: JSON.stringify({
          accountReference: request.accountReference,
          accountName: request.accountName,
          currencyCode: "NGN",
          contractCode: this.settings.MONNIFY_CONTRACT_CODE,
          customerEmail: request.customerEmail,
          customerName: request.customerName,
          getAllAvailableBanks: true,
          ...(request.bvn ? { bvn: request.bvn } : {}),
          ...(request.nin ? { nin: request.nin } : {}),
        }),
      },
    );
  }
}
