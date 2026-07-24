# Billie

Human-backed agent invoice API (Stage 1).

## Stack

- Next.js (App Router) + TypeScript
- pnpm
- World AgentKit (human-backed agent verification)

## Chains (target)

| Asset | Network | CAIP-2 |
|-------|---------|--------|
| Root ENS domain | Ethereum Sepolia | `eip155:11155111` |
| Invoice subdomain | Base Sepolia | `eip155:84532` |
| AgentBook lookup | World Chain | `eip155:480` |

## Setup

```bash
pnpm install
pnpm dev --hostname 127.0.0.1 --port 3000
```

**Always use `127.0.0.1`, not `localhost`.** The dev server binds IPv4 only; on macOS `localhost` often resolves to `::1` and requests hang.

Optional env vars: [`.env.example`](./.env.example). AgentBook / signature RPCs default to public endpoints if unset.

## Endpoints (Stage 1)

| Method | Path | Auth | Notes |
|--------|------|------|-------|
| `GET` | `/api/health` | public | liveness |
| `GET` | `/api/me` | AgentKit | returns `agentAddress` + `humanId` |
| `POST` | `/api/domains` | AgentKit | body `{ "name": "billie" }` → stub Sepolia tx params; `409` if taken |

`/api/invoices` is **not** in Stage 1 yet (planned for Base Sepolia).

Protected routes return `402` with an AgentKit challenge when the `agentkit` header is missing. Agents must use `createAgentkitClient(...).fetch` (or the smoke scripts below).

### Domain create (stub)

1. `POST /api/domains` with `{ "name": "billie.eth" }` (`.eth` optional).
2. API verifies human-backed AgentKit identity (AgentBook on World Chain).
3. If the name is free (**in-memory** for now), returns hardcoded Ethereum Sepolia params (`chainId`, `to`, `data`, `value`) and reserves the name.
4. Agent would register on-chain itself later — Stage 1 does **not** submit or index txs.

---

## Stage 1 verification checklist

Use two terminals. Keep the API running while you run agent scripts.

### 1. Start API

```bash
pnpm dev --hostname 127.0.0.1 --port 3000
```

### 2. Public health

```bash
curl -s http://127.0.0.1:3000/api/health
# → {"ok":true,"service":"billie","stage":1}
```

### 3. Unauthenticated protected routes → 402

```bash
curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:3000/api/me
# → 402

curl -s -o /dev/null -w "%{http_code}\n" \
  -X POST http://127.0.0.1:3000/api/domains \
  -H 'content-type: application/json' \
  -d '{"name":"demo"}'
# → 402
```

### 4. Create + register an agent wallet (once)

```bash
# Prints a throwaway address + private key (save both)
pnpm agent:me

npx @worldcoin/agentkit-cli register 0xYourAddress
# scan QR in World App

npx @worldcoin/agentkit-cli status 0xYourAddress
# → Status: registered
```

### 5. Authorized identity probe

```bash
AGENT_PRIVATE_KEY=0x... pnpm agent:me
```

Expect:

- logs `agentkit_detected` / `agentkit_signed`
- `Status: 200`
- JSON with `agentAddress` and `humanId`
- final line `OK — agent authorized as human-backed.`

### 6. Domain stub (success then taken)

```bash
AGENT_PRIVATE_KEY=0x... pnpm agent:domain -- myagent
# → 200, name "myagent.eth", chainId "eip155:11155111", stub to/data/value

AGENT_PRIVATE_KEY=0x... pnpm agent:domain -- myagent
# → 409 Domain is already taken
```

### Pass criteria

- [ ] `/api/health` → 200
- [ ] `/api/me` and `/api/domains` without AgentKit → 402
- [ ] Registered agent → `/api/me` 200 + `humanId`
- [ ] Registered agent → `/api/domains` 200 with Sepolia stub params
- [ ] Same name twice → 409

See [PLAN.md](./PLAN.md) for scope and follow-ups.
