# Billie

Human-backed agent invoice API (Stage 1).

## Stack

- Next.js (App Router) + TypeScript
- pnpm
- World AgentKit (human-backed agent verification)
- viem (Ethereum Sepolia **ENSv2** ownership checks)

## Chains (target)

| Asset | Network | CAIP-2 |
|-------|---------|--------|
| Root ENS domain | Ethereum Sepolia (ENSv2) | `eip155:11155111` |
| Invoice subdomain | Ethereum Sepolia (ENSv2) | `eip155:11155111` |
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
| `POST` | `/api/domains` | AgentKit | claim/link an already-owned Sepolia ENSv2 name |
| `POST` | `/api/invoices` | AgentKit | prepare invoice subdomain tx + stub attestation |
| `POST` | `/api/invoices/submit` | AgentKit | verify signed tx, broadcast to Sepolia, wait briefly |

`/api/invoices` requires a previously linked domain for the agent.
Protected routes return `402` with an AgentKit challenge when the `agentkit` header is missing. Agents must use `createAgentkitClient(...).fetch` (or the smoke scripts below).

### Domain claim / link

Register the `.eth` name yourself on **Ethereum Sepolia ENSv2** (`app.ens.dev`) with the **same** wallet you use as the AgentKit agent, then link it:

1. `POST /api/domains` with `{ "name": "billie.eth" }` (`.eth` optional) + AgentKit.
2. API verifies human-backed identity (AgentBook on World Chain).
3. If the name is already linked, or this agent already has a domain → `409`.
4. API reads ENSv2 `ETHRegistry.getState(labelhash)` on Sepolia and requires `owner == agentAddress`.
5. On success, stores `humanId → agentAddress → domain` (plus indexes by name / agent) and returns the mapping.

| Status | Meaning |
|--------|---------|
| `402` / `401` / `403` (AgentKit) | not human-backed / bad signature |
| `409` | domain already linked, or agent already has a linked domain |
| `404` | name not registered on Sepolia ENSv2 |
| `403` | ENSv2 owner ≠ agent address |
| `502` | Sepolia RPC / lookup failure |
| `200` | linked; response includes `mapping` |

Note: names registered only in classic ENSv1 will not resolve here. Owner must be the agent wallet.

### Invoice prepare + submit (minimal)

1. Agent has a linked root domain.
2. `POST /api/invoices` with `{ "label": "inv-01", "amount": "100", "currency": "USDC" }` → stub attestation + `register` calldata (no text records).
3. Agent signs the returned tx on Sepolia.
4. `POST /api/invoices/submit` with `{ "invoiceId", "signedTx" }` → Billie verifies match, broadcasts, waits ~45s for 1 confirmation (or returns `submitted` + hash on timeout).

If the root name has no ENSv2 subregistry, calldata is still prepared (`stubCalldata: true`) and may revert on-chain — enough to test the API scheme.

```bash
pnpm agent:invoice -- inv-01 100 USDC
BILLIE_SUBMIT_INVOICE=1 pnpm agent:invoice -- inv-02 50 USDC
```

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

1. On Ethereum Sepolia ENSv2 (`app.ens.dev`), register `myagent.eth` to the **agent** address.
2. Link it:

```bash
pnpm agent:domain -- myagent
# → 200 + mapping { humanId, agentAddress, domain }

pnpm agent:domain -- myagent
# → 409 domain already linked (or agent already has a domain)
```

### Pass criteria

- [ ] `/api/health` → 200
- [ ] `/api/me` and `/api/domains` without AgentKit → 402
- [ ] Registered agent → `/api/me` 200 + `humanId`
- [ ] Agent-owned Sepolia ENSv2 name → `/api/domains` 200 + mapping
- [ ] Same name twice → 409
- [ ] Second domain for same agent → 409
- [ ] Wrong owner / missing ENS → 403 / 404

See [PLAN.md](./PLAN.md) for scope and follow-ups.
