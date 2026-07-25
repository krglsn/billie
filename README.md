# Billie

Human-backed agent invoice API (Stage 1).

## Stack

- Next.js (App Router) + TypeScript
- pnpm
- World AgentKit (human-backed agent verification)
- viem (Ethereum Sepolia ENS ownership checks)

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

Optional env vars: [`.env.example`](./.env.example). AgentBook / signature / Sepolia RPCs default to public endpoints if unset.

## Endpoints (Stage 1)

| Method | Path | Auth | Notes |
|--------|------|------|-------|
| `GET` | `/api/health` | public | liveness |
| `GET` | `/api/me` | AgentKit | returns `agentAddress` + `humanId` |
| `POST` | `/api/domains` | AgentKit | claim/link an already-owned Sepolia ENS name |

`/api/invoices` is **not** in Stage 1 yet (planned for Base Sepolia).

Protected routes return `402` with an AgentKit challenge when the `agentkit` header is missing. Agents must use `createAgentkitClient(...).fetch` (or the smoke scripts below).

### Domain claim / link

Register the `.eth` name yourself on **Ethereum Sepolia** with the agent wallet, then link it:

1. `POST /api/domains` with `{ "name": "billie.eth" }` (`.eth` optional) + AgentKit.
2. API verifies human-backed identity (AgentBook on World Chain).
3. If the name is already linked in Billie → `409`.
4. API reads ENS owner on Sepolia (resolves NameWrapper when needed) and requires `owner == agentAddress`.
5. Domain must be **wrapped** in the ENS NameWrapper (needed later for invoice subdomains).
6. On success, stores mapping `humanId → agentAddress → domain` and returns it.

| Status | Meaning |
|--------|---------|
| `402` / `401` / `403` (AgentKit) | not human-backed / bad signature |
| `409` | domain already linked on Billie |
| `404` | name not registered on Sepolia ENS |
| `403` | ENS owner ≠ agent address |
| `422` | domain is not wrapped in NameWrapper |
| `502` | Sepolia RPC / lookup failure |
| `200` | linked; response includes `mapping` |

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
pnpm agent:me
# save address + privateKey

npx @worldcoin/agentkit-cli register 0xYourAddress
npx @worldcoin/agentkit-cli status 0xYourAddress
```

### 5. Authorized identity probe

Put the key in `.env` (see `.env.example`), then:

```bash
pnpm agent:me
# → 200 + humanId
```

### 6. Domain claim

1. On Ethereum Sepolia, register `myagent.eth` to the **agent** address (commit → wait → register).
2. Link it:

```bash
pnpm agent:domain -- myagent
# → 200 + mapping { humanId, agentAddress, domain }

pnpm agent:domain -- myagent
# → 409 already registered on Billie
```

### Pass criteria

- [ ] `/api/health` → 200
- [ ] `/api/me` and `/api/domains` without AgentKit → 402
- [ ] Registered agent → `/api/me` 200 + `humanId`
- [ ] Agent-owned Sepolia ENS → `/api/domains` 200 + mapping
- [ ] Same name twice → 409
- [ ] Wrong owner / missing ENS → 403 / 404

See [PLAN.md](./PLAN.md) for scope and follow-ups.
