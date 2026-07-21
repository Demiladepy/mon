import { timingSafeEqual } from "node:crypto";
import type { AgentPrincipal } from "../agent/registry.js";
import { agentRegistry } from "../agent/registry.js";

/**
 * Timing-safe equality for UTF-8 secrets. Length mismatch short-circuits with
 * a constant false — never return early on the first differing byte of equal-
 * length buffers only; Buffer.compare is not timing-safe.
 */
export function secretsEqual(supplied: string, expected: string): boolean {
  const a = Buffer.from(supplied);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export type CredentialStore = {
  /** agentId → shared secret */
  agentTokens: Map<string, string>;
  approverToken: string;
};

/**
 * Parse `agentId:token,agentId:token` (or JSON object). Empty tokens are
 * rejected — an agent without a credential cannot authenticate.
 */
export function parseAgentTokens(raw: string): Map<string, string> {
  const trimmed = raw.trim();
  if (!trimmed) return new Map();

  if (trimmed.startsWith("{")) {
    const parsed = JSON.parse(trimmed) as Record<string, unknown>;
    const map = new Map<string, string>();
    for (const [agentId, token] of Object.entries(parsed)) {
      if (typeof token === "string" && token.length >= 8) {
        map.set(agentId, token);
      }
    }
    return map;
  }

  const map = new Map<string, string>();
  for (const part of trimmed.split(",")) {
    const colon = part.indexOf(":");
    if (colon <= 0) continue;
    const agentId = part.slice(0, colon).trim();
    const token = part.slice(colon + 1).trim();
    if (agentId && token.length >= 8) map.set(agentId, token);
  }
  return map;
}

export function createCredentialStore(input: {
  agentTokensRaw: string;
  approverToken: string;
}): CredentialStore {
  const agentTokens = parseAgentTokens(input.agentTokensRaw);
  if (!input.approverToken || input.approverToken.length < 8) {
    throw new Error("APPROVER_TOKEN must be at least 8 characters");
  }
  return { agentTokens, approverToken: input.approverToken };
}

export type AuthFailure = {
  ok: false;
  status: 401 | 403;
  error: string;
  reason: "MISSING_TOKEN" | "INVALID_TOKEN" | "UNKNOWN_AGENT" | "TOKEN_AGENT_MISMATCH";
};

export type AgentAuthSuccess = {
  ok: true;
  principal: AgentPrincipal;
};

/**
 * Authenticate an agent by shared secret alone. The token maps to exactly one
 * registered principal — clients cannot assert an agentId independently of the
 * credential, which blocks impersonation.
 */
export function authenticateAgent(
  store: CredentialStore,
  bearerToken: string | undefined,
): AgentAuthSuccess | AuthFailure {
  if (!bearerToken) {
    return {
      ok: false,
      status: 401,
      error: "Missing agent bearer token.",
      reason: "MISSING_TOKEN",
    };
  }

  for (const [agentId, token] of store.agentTokens) {
    if (!secretsEqual(bearerToken, token)) continue;
    const principal = agentRegistry.get(agentId);
    if (!principal) {
      return {
        ok: false,
        status: 403,
        error: "Token maps to an unregistered agent.",
        reason: "UNKNOWN_AGENT",
      };
    }
    return { ok: true, principal };
  }

  return {
    ok: false,
    status: 401,
    error: "Invalid agent credentials.",
    reason: "INVALID_TOKEN",
  };
}

/**
 * Authenticate the process-bound MCP agent: AGENT_ID must be registered and
 * AGENT_TOKEN must match that principal's credential. No silent full-access
 * fallback for unknown ids.
 */
export function authenticateConfiguredAgent(
  store: CredentialStore,
  agentId: string,
  agentToken: string,
): AgentAuthSuccess | AuthFailure {
  let principal: AgentPrincipal;
  try {
    principal = agentRegistry.require(agentId);
  } catch {
    return {
      ok: false,
      status: 403,
      error: `Unknown agent principal: ${agentId}`,
      reason: "UNKNOWN_AGENT",
    };
  }

  const expected = store.agentTokens.get(agentId);
  if (!expected) {
    return {
      ok: false,
      status: 403,
      error: `No credential configured for agent ${agentId}.`,
      reason: "UNKNOWN_AGENT",
    };
  }
  if (!agentToken || !secretsEqual(agentToken, expected)) {
    return {
      ok: false,
      status: 401,
      error: "Invalid agent credentials for configured AGENT_ID.",
      reason: "INVALID_TOKEN",
    };
  }
  return { ok: true, principal };
}

export function authenticateApprover(
  store: CredentialStore,
  bearerToken: string | undefined,
): { ok: true } | AuthFailure {
  if (!bearerToken) {
    return {
      ok: false,
      status: 401,
      error: "Missing approver bearer token.",
      reason: "MISSING_TOKEN",
    };
  }
  if (!secretsEqual(bearerToken, store.approverToken)) {
    return {
      ok: false,
      status: 401,
      error: "Invalid approver credentials.",
      reason: "INVALID_TOKEN",
    };
  }
  return { ok: true };
}

/** Extract Bearer token from Authorization or a dedicated header. */
export function extractBearer(
  authorization: string | string[] | undefined,
  fallbackHeader?: string | string[] | undefined,
): string | undefined {
  const header = Array.isArray(authorization)
    ? authorization[0]
    : authorization;
  if (header) {
    const match = /^Bearer\s+(.+)$/i.exec(header.trim());
    if (match?.[1]) return match[1].trim();
  }
  const fallback = Array.isArray(fallbackHeader)
    ? fallbackHeader[0]
    : fallbackHeader;
  return fallback?.trim() || undefined;
}
