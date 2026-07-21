import fs from "node:fs";
import path from "node:path";
import fastifyStatic from "@fastify/static";
import Fastify from "fastify";
import rawBody from "fastify-raw-body";
import { config } from "../config.js";
import { Ledger } from "../ledger/db.js";
import { MonnifyClient } from "../monnify/client.js";
import { defaultPolicy } from "../policy/rules.js";
import { ReinService } from "../rein.js";
import {
  parseCollectionWebhook,
  verifyMonnifySignature,
} from "../webhooks/monnify.js";

const ledger = new Ledger(config.DATABASE_PATH);
const monnify = new MonnifyClient(config);
const service = new ReinService(
  ledger,
  monnify,
  defaultPolicy,
  config.AGENT_ID,
);
const app = Fastify({ logger: false });

await app.register(rawBody, {
  field: "rawBody",
  global: false,
  encoding: false,
  runFirst: true,
});

app.get("/api/dashboard", async () => service.dashboard());

app.post("/api/payouts", async (request, reply) => {
  const result = await service.payout(request.body);
  return reply.code(result.ok ? 200 : 400).send(result);
});

app.post("/api/accounts", async (request, reply) => {
  const result = await service.createReservedAccount(request.body);
  return reply.code(result.ok ? 200 : 400).send(result);
});

app.post<{ Params: { idempotencyKey: string } }>(
  "/api/approvals/:idempotencyKey/approve",
  async (request, reply) => {
    try {
      return await service.approvePayout(request.params.idempotencyKey);
    } catch (error) {
      return reply.code(409).send({ error: (error as Error).message });
    }
  },
);

app.post<{ Params: { idempotencyKey: string } }>(
  "/api/approvals/:idempotencyKey/deny",
  async (request, reply) => {
    try {
      return service.denyPayout(request.params.idempotencyKey);
    } catch (error) {
      return reply.code(409).send({ error: (error as Error).message });
    }
  },
);

app.post(
  "/api/webhooks/monnify",
  { config: { rawBody: true } },
  async (request, reply) => {
    const signatureHeader = request.headers["monnify-signature"];
    const signature = Array.isArray(signatureHeader)
      ? signatureHeader[0]
      : signatureHeader;
    const secret = config.WEBHOOK_SECRET || config.MONNIFY_SECRET_KEY;
    const raw = request.rawBody;

    if (
      !Buffer.isBuffer(raw) ||
      !verifyMonnifySignature(raw, signature, secret)
    ) {
      ledger.audit("WEBHOOK_REJECTED", { reason: "Invalid signature" });
      return reply.code(401).send({ accepted: false });
    }

    try {
      const collection = parseCollectionWebhook(request.body);
      const inserted = service.recordCollection(collection, request.body);
      return { accepted: true, duplicate: !inserted };
    } catch (error) {
      return reply.code(400).send({
        accepted: false,
        error: (error as Error).message,
      });
    }
  },
);

async function seedDemo(): Promise<void> {
  if (!config.DRY_RUN) return;

  await service.createReservedAccount({
    accountReference: "bakery-customer-001",
    accountName: "Aderonke Stores Collection",
    customerName: "Aderonke Stores",
    customerEmail: "accounts@aderonke.example",
    nin: "12345678901",
    idempotencyKey: "seed-reserved-account-001",
  });
  service.recordCollection(
    {
      transactionReference: "MNFY-SEED-COLLECTION-001",
      amountKobo: 12_750_000,
      accountReference: "bakery-customer-001",
      customerName: "Aderonke Stores",
      status: "SUCCESS",
      paidAt: new Date().toISOString(),
    },
    { source: "deterministic-demo-seed" },
  );
  await service.payout({
    amountKobo: 850_000,
    beneficiaryAccount: "0123456789",
    beneficiaryBankCode: "058",
    expectedBeneficiaryName: "Musa Ibrahim",
    category: "supplier",
    idempotencyKey: "seed-legit-payout-001",
    reason: "Flour delivery · INV-2841",
  });
  await service.payout({
    amountKobo: 5_500_000,
    beneficiaryAccount: "0123456789",
    beneficiaryBankCode: "058",
    expectedBeneficiaryName: "Musa Ibrahim",
    category: "supplier",
    idempotencyKey: "seed-approval-payout-001",
    reason: "Bulk flour order · INV-2856",
  });
  await service.payout({
    amountKobo: 50_000_000,
    beneficiaryAccount: "9911223344",
    beneficiaryBankCode: "044",
    expectedBeneficiaryName: "Admin Approved Supplier",
    category: "supplier",
    idempotencyKey: "seed-injection-payout-001",
    reason: "Untrusted delivery-note instruction",
  });
}

app.addHook("onSend", async (request, reply, payload) => {
  if (
    request.method === "GET" &&
    (request.url === "/" ||
      request.url.startsWith("/index.html") ||
      request.url.startsWith("/assets/"))
  ) {
    reply.header("Cache-Control", "no-store, no-cache, must-revalidate");
    reply.header("Pragma", "no-cache");
    reply.header("Expires", "0");
    reply.header("Clear-Site-Data", '"cache"');
  }
  return payload;
});

app.get("/api/identity", async () => ({
  product: "Rein",
  tagline:
    "AI cash operations on Monnify — collections, verified payouts, deterministic control.",
  not: ["V2V", "Voice to Value", "Aethana", "Groq"],
}));

const webRoot = path.resolve(process.cwd(), "dist-web");
if (fs.existsSync(webRoot)) {
  await app.register(fastifyStatic, {
    root: webRoot,
    prefix: "/",
  });
  app.setNotFoundHandler((request, reply) => {
    if (request.url.startsWith("/api/")) {
      return reply.code(404).send({ error: "Not found" });
    }
    reply.header("Cache-Control", "no-store, no-cache, must-revalidate");
    return reply.sendFile("index.html");
  });
}

async function main(): Promise<void> {
  await seedDemo();
  await app.listen({ host: "0.0.0.0", port: config.HTTP_PORT });
  console.log(`Rein web app ready at http://localhost:${config.HTTP_PORT}`);
}

main().catch((error) => {
  console.error("Rein web app failed:", (error as Error).message);
  ledger.close();
  process.exit(1);
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, async () => {
    await app.close();
    ledger.close();
    process.exit(0);
  });
}
