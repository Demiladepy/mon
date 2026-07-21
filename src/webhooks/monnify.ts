import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import type { CollectionRecord } from "../ledger/db.js";

const envelopeSchema = z
  .object({
    eventType: z.string().min(1),
    eventData: z.record(z.string(), z.unknown()),
  })
  .passthrough();

function valueAt(
  object: Record<string, unknown>,
  ...paths: string[][]
): unknown {
  for (const path of paths) {
    let value: unknown = object;
    for (const key of path) {
      if (!value || typeof value !== "object" || !(key in value)) {
        value = undefined;
        break;
      }
      value = (value as Record<string, unknown>)[key];
    }
    if (value !== undefined && value !== null) return value;
  }
  return undefined;
}

export function nairaToKobo(value: unknown): number {
  const text = typeof value === "number" ? value.toFixed(2) : String(value);
  const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(text);
  if (!match) throw new Error("Invalid webhook amount");
  const whole = Number.parseInt(match[1]!, 10);
  const fraction = (match[2] ?? "").padEnd(2, "0");
  const kobo = whole * 100 + Number.parseInt(fraction || "0", 10);
  if (!Number.isSafeInteger(kobo) || kobo <= 0) {
    throw new Error("Webhook amount is outside the safe range");
  }
  return kobo;
}

export function verifyMonnifySignature(
  rawBody: Buffer,
  signature: string | undefined,
  secret: string,
): boolean {
  if (!signature || !secret) return false;
  // Monnify signs the raw request body with HMAC-SHA512 keyed on the client
  // secret and sends it hex-encoded (128 chars) in the `monnify-signature` header.
  const expected = createHmac("sha512", secret).update(rawBody).digest("hex");
  const supplied = signature.trim().toLowerCase();
  if (!/^[a-f0-9]{128}$/.test(supplied)) return false;
  return timingSafeEqual(Buffer.from(expected, "hex"), Buffer.from(supplied, "hex"));
}

export function parseCollectionWebhook(payload: unknown): CollectionRecord {
  const envelope = envelopeSchema.parse(payload);
  if (
    !["SUCCESSFUL_TRANSACTION", "SUCCESSFUL_COLLECTION"].includes(
      envelope.eventType,
    )
  ) {
    throw new Error(`Unsupported collection event: ${envelope.eventType}`);
  }
  const data = envelope.eventData;
  const transactionReference = valueAt(
    data,
    ["transactionReference"],
    ["paymentReference"],
  );
  const amount = valueAt(data, ["amountPaid"], ["amount"]);
  const accountReference = valueAt(
    data,
    ["accountReference"],
    ["product", "reference"],
    ["destinationAccountInformation", "accountReference"],
  );
  const customerName = valueAt(data, ["customer", "name"], ["customerName"]);
  const paidAt = valueAt(data, ["paidOn"], ["paymentDate"]);

  if (
    typeof transactionReference !== "string" ||
    typeof accountReference !== "string"
  ) {
    throw new Error("Webhook is missing collection references");
  }

  return {
    transactionReference,
    accountReference,
    amountKobo: nairaToKobo(amount),
    customerName:
      typeof customerName === "string" ? customerName : undefined,
    paidAt: typeof paidAt === "string" ? paidAt : undefined,
    status: "SUCCESS",
  };
}
