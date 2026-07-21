import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  nairaToKobo,
  parseCollectionWebhook,
  verifyMonnifySignature,
} from "../src/webhooks/monnify.js";

describe("Monnify webhook boundary", () => {
  it("verifies the raw body with HMAC-SHA256", () => {
    const body = Buffer.from('{"eventType":"SUCCESSFUL_TRANSACTION"}');
    const secret = "webhook-test-secret";
    const signature = createHmac("sha256", secret)
      .update(body)
      .digest("hex");
    expect(verifyMonnifySignature(body, signature, secret)).toBe(true);
    expect(verifyMonnifySignature(body, "0".repeat(64), secret)).toBe(false);
  });

  it("converts decimal naira to integer kobo", () => {
    expect(nairaToKobo("127500.25")).toBe(12_750_025);
    expect(() => nairaToKobo("10.001")).toThrow("Invalid webhook amount");
  });

  it("parses a successful collection event", () => {
    expect(
      parseCollectionWebhook({
        eventType: "SUCCESSFUL_TRANSACTION",
        eventData: {
          transactionReference: "MNFY-001",
          amountPaid: "127500.00",
          product: { reference: "bakery-customer-001" },
          customer: { name: "Aderonke Stores" },
          paidOn: "2026-07-21T05:00:00Z",
        },
      }),
    ).toEqual({
      transactionReference: "MNFY-001",
      amountKobo: 12_750_000,
      accountReference: "bakery-customer-001",
      customerName: "Aderonke Stores",
      status: "SUCCESS",
      paidAt: "2026-07-21T05:00:00Z",
    });
  });
});
