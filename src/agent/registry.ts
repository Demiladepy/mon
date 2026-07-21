import agentsDefault from "./agents.default.json" with { type: "json" };

/**
 * Capabilities are the *actions* a principal is allowed to attempt at all.
 * They are enforced at the trust boundary BEFORE any money-path policy runs,
 * so an agent that lacks `payout.initiate` can never reach the payout logic —
 * regardless of what a prompt injection convinces the model to try.
 */
export const CAPABILITIES = [
  "payout.initiate",
  "collect.create_virtual_account",
  "verify.customer",
  "wallet.balance",
  "policy.explain",
] as const;

export type Capability = (typeof CAPABILITIES)[number];

/**
 * A grant narrows the global policy for a specific principal. It can only ever
 * make the ceiling *lower* (tighter), never higher — the engine takes the
 * minimum of the global policy and the grant. Undefined fields mean "defer to
 * the global policy".
 */
export type AgentGrant = {
  maxPerTxnKobo?: number;
  maxPerDayKobo?: number;
  approvalThresholdKobo?: number;
  allowedCategories?: string[];
};

export type AgentPrincipal = {
  agentId: string;
  label: string;
  description?: string;
  capabilities: Capability[];
  grant: AgentGrant;
};

function isCapability(value: string): value is Capability {
  return (CAPABILITIES as readonly string[]).includes(value);
}

/**
 * Build a permissive principal for an ad-hoc agent id (full capabilities, no
 * extra grant). Used as a safe default in tests and when an id is not in the
 * registry but the caller has explicitly trusted it.
 */
export function fullAccessPrincipal(agentId: string): AgentPrincipal {
  return {
    agentId,
    label: agentId,
    capabilities: [...CAPABILITIES],
    grant: {},
  };
}

type RawAgent = {
  agentId: string;
  label: string;
  description?: string;
  capabilities: string[];
  grant?: AgentGrant;
};

export class AgentRegistry {
  private readonly principals = new Map<string, AgentPrincipal>();

  constructor(agents: RawAgent[] = (agentsDefault as { agents: RawAgent[] }).agents) {
    for (const agent of agents) {
      const capabilities = agent.capabilities.filter(isCapability);
      this.principals.set(agent.agentId, {
        agentId: agent.agentId,
        label: agent.label,
        description: agent.description,
        capabilities,
        grant: agent.grant ?? {},
      });
    }
  }

  get(agentId: string): AgentPrincipal | undefined {
    return this.principals.get(agentId);
  }

  /**
   * Resolve a principal by id. Unknown ids are rejected rather than silently
   * granted access — an unregistered agent has no standing in the system.
   */
  require(agentId: string): AgentPrincipal {
    const principal = this.principals.get(agentId);
    if (!principal) {
      throw new Error(`Unknown agent principal: ${agentId}`);
    }
    return principal;
  }

  list(): AgentPrincipal[] {
    return [...this.principals.values()];
  }
}

export const agentRegistry = new AgentRegistry();
