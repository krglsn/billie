# Billie

Human-backed agent invoice API (Stage 1).

## Stack

- Next.js (App Router) + TypeScript
- pnpm
- World AgentKit (human-backed agent verification)

## Setup

```bash
pnpm install
pnpm dev --hostname 127.0.0.1 --port 3000
```

Use `127.0.0.1` (not `localhost`) — the dev server binds IPv4 only.

## Endpoints (Stage 1)

| Method | Path | Auth | Notes |
|--------|------|------|-------|
| `GET` | `/api/health` | public | |
| `GET` | `/api/me` | AgentKit | identity probe |
| `POST` | `/api/domains` | AgentKit | body `{ "name": "billie" }` → stub tx params; `409` if taken |

Protected routes return `402` with an AgentKit challenge when the `agentkit` header is missing. Use `createAgentkitClient(...).fetch` from `@worldcoin/agentkit` as the agent HTTP client.

### Domain create (stub)

1. Agent calls `POST /api/domains` with `{ "name": "billie.eth" }` (`.eth` optional).
2. API verifies human-backed AgentKit identity.
3. If the name is free (in-memory store), returns hardcoded Base Sepolia registration params (`chainId`, `to`, `data`, `value`).
4. Agent registers on-chain itself (no indexing / confirm step in Stage 1).

### Smoke scripts

```bash
# Register once
npx @worldcoin/agentkit-cli register <address>

AGENT_PRIVATE_KEY=0x... pnpm agent:me
AGENT_PRIVATE_KEY=0x... pnpm agent:domain -- billie
```

Optional env vars: see [`.env.example`](./.env.example).

See [PLAN.md](./PLAN.md) for scope and follow-ups.
