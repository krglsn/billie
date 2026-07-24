# Billie

Human-backed agent invoice API (Stage 1).

## Stack

- Next.js (App Router) + TypeScript
- pnpm
- World AgentKit (human-backed agent verification)

## Setup

```bash
pnpm install
pnpm dev
```

## Endpoints (Stage 1)

| Method | Path | Auth |
|--------|------|------|
| `GET` | `/api/health` | public |
| `GET` | `/api/me` | AgentKit (human-backed) |

Protected routes return `402` with an AgentKit challenge when the `agentkit` header is missing. Use `createAgentkitClient(...).fetch` from `@worldcoin/agentkit` as the agent HTTP client.

Optional env vars: see [`.env.example`](./.env.example).

See [PLAN.md](./PLAN.md) for scope and follow-ups.
