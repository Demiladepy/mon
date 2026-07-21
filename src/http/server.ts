import {
  authenticateConfiguredAgent,
  createCredentialStore,
} from "../auth/credentials.js";
import { config } from "../config.js";
import { Ledger } from "../ledger/db.js";
import { MonnifyClient } from "../monnify/client.js";
import { buildApp } from "./app.js";

const ledger = new Ledger(config.DATABASE_PATH);
const monnify = new MonnifyClient(config);
const credentials = createCredentialStore({
  agentTokensRaw: config.AGENT_TOKENS,
  approverToken: config.APPROVER_TOKEN,
});

const boot = authenticateConfiguredAgent(
  credentials,
  config.AGENT_ID,
  config.AGENT_TOKEN,
);
if (!boot.ok) {
  console.error(`Rein HTTP refused to start: ${boot.error}`);
  ledger.close();
  process.exit(1);
}
const boundPrincipal = boot.principal;

const app = await buildApp({ config, ledger, monnify, credentials });

async function main(): Promise<void> {
  await app.listen({ host: "0.0.0.0", port: config.HTTP_PORT });
  console.log(
    `Rein web app ready at http://localhost:${config.HTTP_PORT} (agent=${boundPrincipal.agentId})`,
  );
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
