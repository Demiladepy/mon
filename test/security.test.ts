import { afterEach, describe, expect, it } from "vitest";
import { agentRegistry, fullAccessPrincipal } from "../src/agent/registry.js";
import {
  authenticateAgent,
  authenticateApprover,
  authenticateConfiguredAgent,
  createCredentialStore,
  secretsEqual,
} from "../src/auth/credentials.js";
import { config } from "../src/config.js";
import { buildApp } from "../src/http/app.js";
import { Ledger } from "../src/ledger/db.js";
import { MonnifyClient } from "../src/monnify/client.js";
import { defaultPolicy } from "../src/policy/rules.js";
import { ReinService } from "../src/rein.js";

const ledgers: Ledger[] = [];

const store = createCredentialStore({
  agentTokensRaw:
    "demo-ops-agent:rein-demo-ops-token,demo-readonly-agent:rein-demo-readonly-token",
  approverToken: "rein-demo-approver-token",
});

const payout = {
  amountKobo: 850_000,
  beneficiaryAccount: "0123456789",
  beneficiaryBankCode: "058",
  expectedBeneficiaryName: "Musa Ibrahim",
  category: "supplier",
  reason: "Adversarial harness",
};

afterEach(() => {
  ledgers.splice(0).forEach((ledger) => ledger.close());
});

async function makeApp() {
  const ledger = new Ledger(":memory:");
  ledgers.push(ledger);
  const app = await buildApp({
    config: { ...config, AGENT_ID: "demo-ops-agent", DRY_RUN: true },
    ledger,
    monnify: new MonnifyClient({ ...config, DRY_RUN: true }),
    credentials: store,
  });
  return { app, ledger };
}

describe("identity authentication", () => {
  it("rejects unknown AGENT_ID fail-closed (no full-access fallback)", () => {
    const result = authenticateConfiguredAgent(
      store,
      "totally-unknown-agent",
      "rein-demo-ops-token",
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("UNKNOWN_AGENT");
  });

  it("rejects a valid token presented for the wrong AGENT_ID", () => {
    const result = authenticateConfiguredAgent(
      store,
      "demo-ops-agent",
      "rein-demo-readonly-token",
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("INVALID_TOKEN");
  });

  it("authenticates the registered ops agent by matching token", () => {
    const result = authenticateConfiguredAgent(
      store,
      "demo-ops-agent",
      "rein-demo-ops-token",
    );
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.principal.agentId).toBe("demo-ops-agent");
  });

  it("does not allow inventing an agentId via bearer alone when token is wrong", () => {
    const result = authenticateAgent(store, "forged-token-xxxxxx");
    expect(result.ok).toBe(false);
  });

  it("maps bearer token to the correct principal (blocks impersonation)", () => {
    const asReadonly = authenticateAgent(store, "rein-demo-readonly-token");
    expect(asReadonly.ok).toBe(true);
    if (asReadonly.ok) {
      expect(asReadonly.principal.agentId).toBe("demo-readonly-agent");
      expect(asReadonly.principal.capabilities).not.toContain("payout.initiate");
    }
  });

  it("uses timing-safe equality that rejects length mismatches", () => {
    expect(secretsEqual("short", "rein-demo-ops-token")).toBe(false);
    expect(secretsEqual("rein-demo-ops-token", "rein-demo-ops-token")).toBe(
      true,
    );
  });
});

describe("HTTP authorization boundaries", () => {
  it("rejects unauthenticated payout attempts", async () => {
    const { app } = await makeApp();
    const response = await app.inject({
      method: "POST",
      url: "/api/payouts",
      payload: { ...payout, idempotencyKey: "adv-unauth-payout-001" },
    });
    expect(response.statusCode).toBe(401);
    await app.close();
  });

  it("blocks capability escalation: readonly token cannot pay", async () => {
    const { app, ledger } = await makeApp();
    const response = await app.inject({
      method: "POST",
      url: "/api/payouts",
      headers: { authorization: "Bearer rein-demo-readonly-token" },
      payload: { ...payout, idempotencyKey: "adv-escalation-001" },
    });
    expect(response.statusCode).toBe(200);
    const body = response.json() as {
      status: string;
      decision: { matchedRules: string[] };
    };
    expect(body.status).toBe("DENIED");
    expect(body.decision.matchedRules).toContain("CAPABILITY");
    expect(
      ledger
        .listAudit(20)
        .some(
          (row) =>
            (row as { event_type?: string }).event_type === "CAPABILITY_DENIED",
        ),
    ).toBe(true);
    await app.close();
  });

  it("allows an authenticated ops agent to pay within grant", async () => {
    const { app } = await makeApp();
    const response = await app.inject({
      method: "POST",
      url: "/api/payouts",
      headers: { "x-rein-agent-token": "rein-demo-ops-token" },
      payload: { ...payout, idempotencyKey: "adv-ops-ok-001" },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ status: "SUCCESS" });
    await app.close();
  });

  it("rejects approve/deny without an approver token", async () => {
    const { app } = await makeApp();
    const missing = await app.inject({
      method: "POST",
      url: "/api/approvals/missing-key/approve",
    });
    expect(missing.statusCode).toBe(401);

    const forged = await app.inject({
      method: "POST",
      url: "/api/approvals/missing-key/deny",
      headers: { authorization: "Bearer rein-demo-ops-token" },
    });
    expect(forged.statusCode).toBe(401);
    expect(authenticateApprover(store, "rein-demo-ops-token").ok).toBe(false);
    await app.close();
  });

  it("requires a valid approver token before releasing a held payout", async () => {
    const { app } = await makeApp();
    const held = await app.inject({
      method: "POST",
      url: "/api/payouts",
      headers: { authorization: "Bearer rein-demo-ops-token" },
      payload: {
        ...payout,
        amountKobo: defaultPolicy.approvalThresholdKobo,
        idempotencyKey: "adv-approval-auth-001",
      },
    });
    expect(held.json()).toMatchObject({ status: "PENDING_APPROVAL" });

    const denied = await app.inject({
      method: "POST",
      url: "/api/approvals/adv-approval-auth-001/approve",
      headers: { authorization: "Bearer wrong-approver-token" },
    });
    expect(denied.statusCode).toBe(401);

    const approved = await app.inject({
      method: "POST",
      url: "/api/approvals/adv-approval-auth-001/approve",
      headers: { "x-rein-approver-token": "rein-demo-approver-token" },
    });
    expect(approved.statusCode).toBe(200);
    expect(approved.json()).toMatchObject({ status: "SUCCESS" });
    await app.close();
  });
});

describe("idempotent replay and approval races", () => {
  it("replays the first payout outcome and never double-executes", async () => {
    const ledger = new Ledger(":memory:");
    ledgers.push(ledger);
    const service = new ReinService(
      ledger,
      new MonnifyClient({ ...config, DRY_RUN: true }),
      defaultPolicy,
      agentRegistry.require("demo-ops-agent"),
    );
    const key = "adv-replay-001";
    const first = await service.payout({ ...payout, idempotencyKey: key });
    const second = await service.payout({ ...payout, idempotencyKey: key });
    expect(first).toMatchObject({ ok: true, status: "SUCCESS", replayed: false });
    expect(second).toMatchObject({ ok: true, status: "SUCCESS", replayed: true });
    const executions = service
      .auditTrail()
      .filter(
        (row) =>
          (row as { event_type?: string }).event_type === "PAYOUT_EXECUTED",
      );
    expect(executions).toHaveLength(1);
  });

  it("lets only one concurrent approver win an approval race", async () => {
    const ledger = new Ledger(":memory:");
    ledgers.push(ledger);
    const service = new ReinService(
      ledger,
      new MonnifyClient({ ...config, DRY_RUN: true }),
      defaultPolicy,
      fullAccessPrincipal("race-agent"),
    );
    const key = "adv-race-001";
    const pending = await service.payout({
      ...payout,
      amountKobo: defaultPolicy.approvalThresholdKobo,
      idempotencyKey: key,
    });
    expect(pending).toMatchObject({ status: "PENDING_APPROVAL" });

    const [a, b] = await Promise.allSettled([
      service.approvePayout(key),
      service.approvePayout(key),
    ]);

    const successes = [a, b].filter((result) => result.status === "fulfilled");
    const failures = [a, b].filter((result) => result.status === "rejected");
    expect(successes).toHaveLength(1);
    expect(failures).toHaveLength(1);
    if (successes[0]?.status === "fulfilled") {
      expect(successes[0].value.status).toBe("SUCCESS");
    }
  });
});
