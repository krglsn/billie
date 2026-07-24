# Billie Stage 1: Human-Backed Agent API

## Goal for this stage

Run an API locally, manually register an agent with World AgentKit (`npx @worldcoin/agentkit-cli register <address>`), and confirm that agent can successfully call protected endpoints. The API must reject non–human-backed callers and accept registered agents.

## Target architecture (full product)

Deferred pieces stay in the picture; only the API slice ships now.

- **API** — agent auth (AgentKit + AgentBook), domain + invoice creation.
- **Web app** (deferred) — dashboard + public invoice validation form.
- **Contracts** (deferred) — ENS / invoice creation on **Base Sepolia**; agents will own the root domain and pay gas later.

## Decisions for Stage 1

- **Stack:** Next.js (App Router) TypeScript — API routes only for now (no UI pages beyond a minimal health check if useful).
- **Auth:** World AgentKit (`@worldcoin/agentkit`) — CAIP-122 challenge + AgentBook lookup on World Chain. Prefer `free` (or high `free-trial`) mode so local testing does not require x402 payment.
- **On-chain:** Base Sepolia is the future home for domains/invoices; **no contract design or deployment in this stage**. Endpoints return stub / in-memory records.
- **Client for smoke test:** small script using `createAgentkitClient` + `agentkit.fetch` against `localhost`.

## Stage 1 scope

### 1. Scaffold + AgentKit gate

- Next.js app with env for World Chain RPC / AgentKit as needed.
- Wire AgentKit resource-server hooks (same helpers as the Hono reference; usable from Next.js route handlers) so protected routes require a human-backed agent.
- Resolve and expose anonymous `humanId` + agent address on successful verify.

### 2. Two protected endpoints (stubs)

| Endpoint | Purpose | Stage 1 behavior |
|----------|---------|------------------|
| `POST /api/domains` | Create root domain (e.g. `billie.eth`) for the calling agent | Validate AgentKit; persist stub domain record `{ name, agentAddress, humanId, createdAt }` in memory/file; **no ENS tx** |
| `POST /api/invoices` | Create invoice under the agent's domain | Validate AgentKit; require existing stub domain for agent; persist stub invoice `{ id, domain, amount, currency, status: "open", ... }` |

Both return clear JSON success/error. Unauthenticated or non–human-backed requests get the AgentKit/x402 challenge (402) and fail verify without a registered AgentBook wallet.

### 3. Local smoke test

1. Start API (`npm run dev`).
2. Register agent wallet: `npx @worldcoin/agentkit-cli register <agent-address>` (World App verification).
3. Run a small client script with `agentkit.fetch` against both endpoints.
4. Confirm: unregistered wallet fails; registered human-backed agent succeeds on domain create then invoice create.

Document this flow in README (env vars, register, curl/script examples).

## Todos

1. Scaffold local API (Next.js API routes) with AgentKit human-backed verification
2. Add `POST /api/domains` and `POST /api/invoices` stubs behind AgentKit auth
3. Document + verify local flow — register agent via AgentKit CLI, call both endpoints

## Out of scope (this stage)

- Web dashboard / validation UI
- ENS or invoice smart contracts on Base Sepolia
- Real domain registration / subdomain minting
- Payment / Paid status lifecycle
- Persistent production DB (in-memory or local file is enough)

## Follow-ups (later stages)

1. ENS + invoice contracts on Base Sepolia; replace stubs with on-chain writes (agent-signed txs).
2. Web app: dashboard + public validate form.
3. Service signature on invoices + stronger persistence/indexer.
