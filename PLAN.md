# Billie Stage 1: Human-Backed Agent API

## Goal for this stage

Run an API locally, manually register an agent with World AgentKit (`npx @worldcoin/agentkit-cli register <address>`), and confirm that agent can successfully call protected endpoints. The API must reject non–human-backed callers and accept registered agents.

## Target architecture (full product)

Deferred pieces stay in the picture; only the API slice ships now.

- **API** — agent auth (AgentKit + AgentBook), domain + invoice creation.
- **Web app** (deferred) — dashboard + public invoice validation form.
- **Contracts** (deferred): root ENS domains **and** invoice subdomains on **Ethereum Sepolia (ENSv2)**. Agents own the root domain and pay gas.

## Decisions for Stage 1

- **Stack:** Next.js (App Router) TypeScript — API routes only for now (no UI pages beyond a minimal health check if useful).
- **Auth:** World AgentKit (`@worldcoin/agentkit`) — CAIP-122 challenge + AgentBook lookup on World Chain. Prefer `free` (or high `free-trial`) mode so local testing does not require x402 payment.
- **On-chain:** everything Billie (root domains + invoice subdomains) on **Ethereum Sepolia ENSv2**. Agent registers offline; Billie **claims/links** after ownership check. Domain link store is in-memory for Stage 1.
- **Store model:** `humanId → agentAddress → domain` (one linked root domain per agent; domain names globally unique). Lookups by agent and by human are supported for `/api/invoices`.
- **Client for smoke test:** `pnpm agent:me` / `pnpm agent:domain` using `createAgentkitClient` + `agentkit.fetch` against `http://127.0.0.1:3000`.

## Stage 1 scope

### 1. Scaffold + AgentKit gate

- Next.js app with env for World Chain RPC / AgentKit as needed.
- Wire AgentKit resource-server hooks (same helpers as the Hono reference; usable from Next.js route handlers) so protected routes require a human-backed agent.
- Resolve and expose anonymous `humanId` + agent address on successful verify.

### 2. Two protected endpoints (stubs)

| Endpoint | Purpose | Stage 1 behavior |
|----------|---------|------------------|
| `POST /api/domains` | Claim root ENS on Ethereum Sepolia ENSv2 | AgentKit; reject if name or agent already linked; verify on-chain owner == agent; store `humanId → agentAddress → domain` |
| `POST /api/invoices` | Prepare invoice subdomain under linked root (Sepolia ENSv2) | AgentKit; require linked domain; Billie EIP-712 attestation (off-chain; later ENS text `billie.attestation`) + register calldata (no text records yet) |
| `POST /api/invoices/submit` | Broadcast signed invoice tx | Verify signed tx matches prepare; `sendRawTransaction`; wait briefly for confirmation |

Both return clear JSON success/error. Unauthenticated or non–human-backed requests get the AgentKit/x402 challenge (402) and fail verify without a registered AgentBook wallet.

### 3. Local smoke test (Stage 1 checkpoint)

Full checklist: [README.md](./README.md#stage-1-verification-checklist).

1. Start API: `pnpm dev --hostname 127.0.0.1 --port 3000`
2. Register agent: `npx @worldcoin/agentkit-cli register <address>`
3. `pnpm agent:me` and `pnpm agent:domain -- <name>`
4. Confirm: unauthenticated → 402; registered agent → `/api/me` + `/api/domains` succeed; duplicate domain / second domain for same agent → 409

`/api/invoices` is deferred past this checkpoint.

## Todos

1. ~~Scaffold local API (Next.js API routes) with AgentKit human-backed verification~~
2. ~~Add `POST /api/domains` claim/link behind AgentKit auth~~ (`/api/invoices` still pending)
3. ~~Document + verify local flow — register agent via AgentKit CLI, call `/api/me` and `/api/domains`~~
4. ~~Add `POST /api/invoices` prepare + submit behind AgentKit auth (Ethereum Sepolia ENSv2)~~

## Out of scope (this stage)

- Web dashboard / validation UI
- Real on-chain invoice subdomain minting / text records
- Payment / Paid status lifecycle
- Persistent production DB (in-memory or local file is enough)

## Follow-ups (later stages)

1. **Parent namespace model:** Billie owns parent + UserRegistry; agents claim `alice.parent.eth` with their own UserRegistry; invoices `inv.alice.parent.eth` via agent-signed `register`.
2. Write ENS text records including `billie.attestation` on invoice subdomains.
3. Web app: dashboard + public validate form.
4. Stronger persistence/indexer.
