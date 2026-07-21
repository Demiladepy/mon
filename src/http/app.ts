import fs from "node:fs";
import path from "node:path";
import fastifyStatic from "@fastify/static";
import Fastify, { type FastifyInstance, type FastifyRequest } from "fastify";
import rawBody from "fastify-raw-body";
import { agentRegistry, type AgentPrincipal } from "../agent/registry.js";
import {
  authenticateAgent,
  authenticateApprover,
  extractBearer,
  type CredentialStore,
} from "../auth/credentials.js";
import type { Config } from "../config.js";
import { appendAudit } from "../ledger/audit.js";
import { Ledger } from "../ledger/db.js";
import { MonnifyClient } from "../monnify/client.js";
import { defaultPolicy } from "../policy/rules.js";
import { ReinService } from "../rein.js";
import {
  parseCollectionWebhook,
  verifyMonnifySignature,
} from "../webhooks/monnify.js";

export type AppDeps = {
  config: Config;
  ledger: Ledger;
  monnify: MonnifyClient;
  credentials: CredentialStore;
};

function serviceFor(deps: AppDeps, principal: AgentPrincipal): ReinService {
  return new ReinService(deps.ledger, deps.monnify, defaultPolicy, principal);
}

function agentTokenFrom(request: FastifyRequest): string | undefined {
  return extractBearer(
    request.headers.authorization,
    request.headers["x-rein-agent-token"],
  );
}

function approverTokenFrom(request: FastifyRequest): string | undefined {
  return extractBearer(
    request.headers.authorization,
    request.headers["x-rein-approver-token"],
  );
}

export async function buildApp(deps: AppDeps): Promise<FastifyInstance> {
  const { config, ledger, credentials } = deps;
  // Read-model service bound to the configured ops agent (identity display only).
  const displayPrincipal = agentRegistry.require(config.AGENT_ID);
  const display = new ReinService(
    ledger,
    deps.monnify,
    defaultPolicy,
    displayPrincipal,
  );

  const app = Fastify({ logger: false });

  await app.register(rawBody, {
    field: "rawBody",
    global: false,
    encoding: false,
    runFirst: true,
  });

  app.get("/api/dashboard", async () => display.dashboard());
  app.get("/api/collections", async () => display.collections());
  app.get("/api/accounts", async () => display.reservedAccounts());
  app.get("/api/payouts", async () => display.payouts());
  app.get("/api/approvals", async () => display.pendingApprovals());
  app.get("/api/activity", async () => display.auditTrail(100));
  app.get("/api/policy", async () => display.policySnapshot());
  app.get("/api/agent", async () => display.identity());
  app.get("/api/agents", async () =>
    agentRegistry.list().map(({ agentId, label, description, capabilities, grant }) => ({
      agentId,
      label,
      description,
      capabilities,
      grant,
    })),
  );

  app.post("/api/payouts", async (request, reply) => {
    const auth = authenticateAgent(credentials, agentTokenFrom(request));
    if (!auth.ok) {
      appendAudit(ledger, "AUTH_DENIED", {
        route: "POST /api/payouts",
        reason: auth.reason,
      });
      return reply.code(auth.status).send({ error: auth.error });
    }
    const result = await serviceFor(deps, auth.principal).payout(request.body);
    return reply.code(result.ok ? 200 : 400).send(result);
  });

  app.post("/api/accounts", async (request, reply) => {
    const auth = authenticateAgent(credentials, agentTokenFrom(request));
    if (!auth.ok) {
      appendAudit(ledger, "AUTH_DENIED", {
        route: "POST /api/accounts",
        reason: auth.reason,
      });
      return reply.code(auth.status).send({ error: auth.error });
    }
    const result = await serviceFor(
      deps,
      auth.principal,
    ).createReservedAccount(request.body);
    return reply.code(result.ok ? 200 : 400).send(result);
  });

  app.post<{ Params: { idempotencyKey: string } }>(
    "/api/approvals/:idempotencyKey/approve",
    async (request, reply) => {
      const auth = authenticateApprover(credentials, approverTokenFrom(request));
      if (!auth.ok) {
        appendAudit(ledger, "AUTH_DENIED", {
          route: "POST /api/approvals/approve",
          reason: auth.reason,
          idempotencyKey: request.params.idempotencyKey,
        });
        return reply.code(auth.status).send({ error: auth.error });
      }
      try {
        return await display.approvePayout(request.params.idempotencyKey);
      } catch (error) {
        return reply.code(409).send({ error: (error as Error).message });
      }
    },
  );

  app.post<{ Params: { idempotencyKey: string } }>(
    "/api/approvals/:idempotencyKey/deny",
    async (request, reply) => {
      const auth = authenticateApprover(credentials, approverTokenFrom(request));
      if (!auth.ok) {
        appendAudit(ledger, "AUTH_DENIED", {
          route: "POST /api/approvals/deny",
          reason: auth.reason,
          idempotencyKey: request.params.idempotencyKey,
        });
        return reply.code(auth.status).send({ error: auth.error });
      }
      try {
        return display.denyPayout(request.params.idempotencyKey);
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
        const inserted = display.recordCollection(collection, request.body);
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
    auth: {
      agentHeader: "Authorization: Bearer <agent-token> or X-Rein-Agent-Token",
      approverHeader:
        "Authorization: Bearer <approver-token> or X-Rein-Approver-Token",
    },
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

  return app;
}
