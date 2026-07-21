import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { config } from "../config.js";
import { Ledger } from "../ledger/db.js";
import { MonnifyClient } from "../monnify/client.js";
import { defaultPolicy } from "../policy/rules.js";
import { ReinService } from "../rein.js";
import {
  payoutToolInput,
  reservedAccountToolInput,
  verifyAccountToolInput,
  walletBalanceToolInput,
} from "./tools.js";

const ledger = new Ledger(config.DATABASE_PATH);
const service = new ReinService(
  ledger,
  new MonnifyClient(config),
  defaultPolicy,
  config.AGENT_ID,
);

function toolResult(value: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }],
  };
}

const server = new McpServer({
  name: "rein",
  version: "0.1.0",
});

server.registerTool(
  "payout.initiate",
  {
    description:
      "Initiate a Monnify payout through deterministic caps, allowlist, name-match, velocity, approval, and idempotency controls.",
    inputSchema: payoutToolInput,
  },
  async (input) => toolResult(await service.payout(input)),
);

server.registerTool(
  "verify.customer",
  {
    description:
      "Resolve a bank account holder through Monnify name inquiry and compare it to an expected name.",
    inputSchema: verifyAccountToolInput,
  },
  async (input) => toolResult(await service.verifyAccount(input)),
);

server.registerTool(
  "collect.create_virtual_account",
  {
    description:
      "Create a dedicated Monnify reserved account for customer collections. Requires validated BVN or NIN and an idempotency key.",
    inputSchema: reservedAccountToolInput,
  },
  async (input) => toolResult(await service.createReservedAccount(input)),
);

server.registerTool(
  "wallet.balance",
  {
    description: "Read the configured Monnify disbursement wallet balance.",
    inputSchema: walletBalanceToolInput,
  },
  async () => toolResult(await service.walletBalance()),
);

server.registerTool(
  "policy.explain",
  {
    description:
      "Evaluate a payout under the current server-side policy without moving money.",
    inputSchema: payoutToolInput,
  },
  async (input) => toolResult(await service.explain(input)),
);

async function main(): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(`Rein MCP server ready (DRY_RUN=${config.DRY_RUN})`);
}

main().catch((error) => {
  console.error("Rein MCP server failed:", (error as Error).message);
  ledger.close();
  process.exit(1);
});
