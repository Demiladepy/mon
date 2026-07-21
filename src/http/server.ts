import fs from "node:fs";
import path from "node:path";
import fastifyStatic from "@fastify/static";
import Fastify from "fastify";
import rawBody from "fastify-raw-body";
import {
  agentRegistry,
  fullAccessPrincipal,
} from "../agent/registry.js";
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
const principal =
  agentRegistry.get(config.AGENT_ID) ?? fullAccessPrincipal(config.AGENT_ID);
const service = new ReinService(ledger, monnify, defaultPolicy, principal);
const app = Fastify({ logger: false });

await app.register(rawBody, {
  field: "rawBody",
  global: false,
  encoding: false,
  runFirst: true,
});

app.get("/api/dashboard", async () => service.dashboard());
app.get("/api/collections", async () => service.collections());
app.get("/api/accounts", async () => service.reservedAccounts());
app.get("/api/payouts", async () => service.payouts());
app.get("/api/approvals", async () => service.pendingApprovals());
app.get("/api/activity", async () => service.auditTrail(100));
app.get("/api/policy", async () => service.policySnapshot());
app.get("/api/agent", async () => service.identity());
app.get("/api/agents", async () => agentRegistry.list());

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
  }
  return payload;
});

app.get("/api/identity", async () => ({
  product: "Rein",
  tagline:
    "AI cash operations on Monnify — collections, verified payouts, deterministic control.",
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
