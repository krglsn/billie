# Billie Stage 1: Human-Backed Agent API

## Goal for this stage

Run an API locally, manually register an agent with World AgentKit (`npx @worldcoin/agentkit-cli register <address>`), and confirm that agent can successfully call protected endpoints. The API must reject non–human-backed callers and accept registered agents.

## Target architecture (full product)

Deferred pieces stay in the picture; only the API slice ships now.

- **API** — agent auth (AgentKit + AgentBook), domain + invoice creation.
- **Web app** (deferred) — dashboard + public invoice validation form.
- **Contracts** (deferred):
  - **Root ENS domains** on **Ethereum Sepolia** (availability checked there later).
  - **Invoice subdomains** on **Base Sepolia**.
  - Agents own the root domain and pay gas.

## Decisions for Stage 1

- **Stack:** Next.js (App Router) TypeScript — API routes only for now (no UI pages beyond a minimal health check if useful).
- **Auth:** World AgentKit (`@worldcoin/agentkit`) — CAIP-122 challenge + AgentBook lookup on World Chain. Prefer `free` (or high `free-trial`) mode so local testing does not require x402 payment.
- **On-chain:** root domains → **Ethereum Sepolia** (agent registers offline, Billie **claims/links** after ENS ownership check); invoice subdomains → **Base Sepolia**. Domain link store is in-memory for Stage 1.
- **Client for smoke test:** `pnpm agent:me` / `pnpm agent:domain` using `createAgentkitClient` + `agentkit.fetch` against `http://127.0.0.1:3000`.

## Stage 1 scope

### 1. Scaffold + AgentKit gate

- Next.js app with env for World Chain RPC / AgentKit as needed.
- Wire AgentKit resource-server hooks (same helpers as the Hono reference; usable from Next.js route handlers) so protected routes require a human-backed agent.
- Resolve and expose anonymous `humanId` + agent address on successful verify.

### 2. Two protected endpoints (stubs)

| Endpoint | Purpose | Stage 1 behavior |
|----------|---------|------------------|
| `POST /api/domains` | Claim root ENS on Ethereum Sepolia | AgentKit; reject if already linked on Billie; verify on-chain owner == agent; store `humanId → agentAddress → domain` |
| `POST /api/invoices` | Invoice subdomain on Base Sepolia | Validate AgentKit; require linked domain; return stub Base Sepolia params / record |

Both return clear JSON success/error. Unauthenticated or non–human-backed requests get the AgentKit/x402 challenge (402) and fail verify without a registered AgentBook wallet.

### 3. Local smoke test (Stage 1 checkpoint)

Full checklist: [README.md](./README.md#stage-1-verification-checklist).

1. Start API: `pnpm dev --hostname 127.0.0.1 --port 3000`
2. Register agent: `npx @worldcoin/agentkit-cli register <address>`
3. `pnpm agent:me` and `pnpm agent:domain -- <name>`
4. Confirm: unauthenticated → 402; registered agent → `/api/me` + `/api/domains` succeed; duplicate domain → 409

`/api/invoices` is deferred past this checkpoint.

## Todos

1. ~~Scaffold local API (Next.js API routes) with AgentKit human-backed verification~~
2. ~~Add `POST /api/domains` stub behind AgentKit auth~~ (`/api/invoices` still pending)
3. ~~Document + verify local flow — register agent via AgentKit CLI, call `/api/me` and `/api/domains`~~
4. Add `POST /api/invoices` stub behind AgentKit auth (Base Sepolia)

## Out of scope (this stage)

- Web dashboard / validation UI
- Real ENS root registration on Ethereum Sepolia / invoice subdomains on Base Sepolia
- On-chain availability checks (stub uses in-memory reservation)
- Payment / Paid status lifecycle
- Persistent production DB (in-memory or local file is enough)

## Follow-ups (later stages)

1. Root ENS on Ethereum Sepolia + invoice subdomains on Base Sepolia; replace stubs with real calldata / availability reads.
2. Web app: dashboard + public validate form.
3. Service signature on invoices + stronger persistence/indexer.
