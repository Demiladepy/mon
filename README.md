# Rein

**Rein is an AI money assistant that runs a small business’s cash operations on Monnify—and cannot be tricked into losing its money.**

Rein gives a Nigerian business one operating view for customer collections, supplier payouts, and exceptions that need a person. Reserved accounts reconcile incoming cash, Monnify name inquiry verifies every beneficiary, and signed webhooks close the loop. Underneath, a real MCP server lets any compatible agent request work—but model prose never decides whether money moves.

## What works

- End-to-end cash path: reserved account → signed collection webhook → typed agent intent → name inquiry → deterministic policy → transfer → audit
- Polished responsive operations dashboard with collections, cash flow, approvals, activity, and live actions
- Deterministic `DRY_RUN=true` adapter, including matching and mismatching account names
- Per-transaction and daily caps, beneficiary allowlist, mandatory name match, velocity limit, approval threshold
- SQLite ledger-backed spend calculations and idempotent replay
- Strict Zod boundary that rejects and audits attempted policy override fields
- MCP tools: `collect.create_virtual_account`, `payout.initiate`, `verify.customer`, `wallet.balance`, and `policy.explain`
- Human approval execution that repeats name inquiry before releasing a held payout
- Raw-body HMAC-SHA256 verification for Monnify collection webhooks
- Scripted offline demo and optional Anthropic-powered agent loop

## Architecture

```text
Customer ─► Monnify reserved account ─► signed webhook ─► cash ledger
                                                           │
Agent / MCP client ──typed intent──► Rein policy engine     │
                                          │                 │
                                 name inquiry + allow        │
                                          ▼                 ▼
                                  Monnify payout ─────► operations UI
```

Every Monnify request is isolated in `src/monnify/client.ts`. Current live paths were checked against Monnify's July 2026 documentation:

- `POST /api/v1/auth/login`
- `POST /api/v2/bank-transfer/reserved-accounts`
- `GET /api/v2/disbursements/account/validate`
- `POST /api/v2/disbursements/single`
- `GET /api/v2/disbursements/wallet-balance`

## Run it

Requirements: Node.js 20+.

```bash
npm install
copy .env.example .env
npm run web
```

Open <http://localhost:3000>. On WSL/Linux, use `cp .env.example .env`.

The web app starts with an empty ledger and never inserts presentation data automatically. Create collection accounts and payouts through their dedicated pages; each view renders only persisted API records. `DRY_RUN_WALLET_BALANCE_KOBO` can optionally provide an explicit simulated wallet balance for offline demos.

For the narrated terminal demo:

```bash
npm run demo
```

`DRY_RUN` defaults to `true`; no credentials or network are needed. The demo runs:

1. A dedicated Monnify collection account is created.
2. A ₦127,500 customer payment is reconciled from a webhook fixture.
3. An allowlisted ₦8,500 supplier payout succeeds after name inquiry.
4. A prompt-injected override is rejected, and its typed payout is denied.
5. Legitimate work still succeeds in the same session.
6. A larger valid payout waits for a person, then executes after approval and a fresh name inquiry.

Re-running the demo returns the original stored outcomes rather than sending duplicates.

### Use a live Anthropic agent

Set `ANTHROPIC_API_KEY`, then:

```bash
DEMO_USE_LLM=true npm run demo
```

PowerShell:

```powershell
$env:DEMO_USE_LLM="true"; npm run demo
```

### Run as an MCP server

```bash
npm run mcp
```

Example MCP client configuration:

```json
{
  "mcpServers": {
    "rein": {
      "command": "npm",
      "args": ["run", "mcp"],
      "cwd": "/absolute/path/to/rein"
    }
  }
}
```

### Use Monnify sandbox

Set `DRY_RUN=false` and fill in:

- `MONNIFY_API_KEY`
- `MONNIFY_SECRET_KEY`
- `MONNIFY_SOURCE_ACCOUNT`
- optionally, sender information

Use sandbox credentials only. Rein converts integer kobo to Monnify's naira request field only at the adapter boundary. No token or secret is logged.

## Security model

- Tool arguments are untrusted. Strict Zod schemas reject unknown fields such as `adminOverride` or `maxPerTxnKobo`.
- Policy is server-side and cannot be changed by a tool call.
- `reason` is audit-only. It has no effect on policy.
- Policy evaluation is a pure function. There is no LLM, network call, clock read, or database query inside it.
- Spend and velocity inputs come from the ledger, never from the model.
- A Monnify name inquiry is mandatory before payout; a fuzzy name mismatch is a hard deny.
- Every state-changing action requires a unique idempotency key. Replays return the first decision and result.
- Audit events are append-only; SQLite triggers reject update and delete operations.
- Provider failures are fail-closed and never expose credentials.
- Collection webhooks are accepted only after constant-time HMAC verification over the raw body.
- Customer BVN/NIN values are sent only to the Monnify adapter and are never written to audit.

The policy precedence is `DENY` over `REQUIRE_APPROVAL` over `ALLOW`. This means a non-allowlisted beneficiary can normally be held for review, while a simultaneous hard failure such as an over-cap amount or name mismatch still denies the payment.

## Verify

```bash
npm test
npm run check
npm run build
```

Tests cover allow, deny, approval, name matching, daily aggregation, injection, tamper rejection, dry-run execution, and idempotent replay.

## Demo framing

The assistant is the hero: it receives money, reconciles the customer, and pays the right supplier. Rein’s controls are the trust proof inside that useful flow. The injection scene demonstrates that an untrusted instruction cannot change server-side policy, while the successful payment immediately afterward proves normal operations continue.

Bills vending remains the next Monnify surface after the collection-to-disbursement loop.
