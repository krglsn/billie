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
| Parent ENS (`BILLIE_PARENT_NAME`) | Ethereum Sepolia (ENSv2) | `eip155:11155111` |
| Agent namespace + invoice subdomains | Ethereum Sepolia (ENSv2) | `eip155:11155111` |
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
| `GET` | `/api/health` | public | liveness + Billie parent ENSv2 readiness |
| `GET` | `/api/me` | AgentKit | returns `agentAddress` + `humanId` |
| `POST` | `/api/domains` | AgentKit | provision agent namespace under parent + link |
| `POST` | `/api/invoices` | AgentKit | prepare invoice subdomain tx + Billie EIP-712 attestation |
| `POST` | `/api/invoices/submit` | AgentKit | verify signed tx, broadcast to Sepolia, wait briefly |

### Parent domain readiness (`GET /api/health`)

Billie is pivoting to a single parent name (`BILLIE_PARENT_NAME`, e.g. `billie.eth`) owned by `BILLIE_PRIVATE_KEY`. Health checks on-chain:

1. Parent name registered on Sepolia ENSv2
2. Owner matches `BILLIE_PRIVATE_KEY`
3. A UserRegistry is attached (`getSubregistry`)
4. Billie has `ROLE_REGISTRAR` on that registry (can provision agent namespaces)

HTTP **200** when ready, **503** when any required check fails. Response includes `parent.checks[]`.

```bash
# .env: BILLIE_PRIVATE_KEY + BILLIE_PARENT_NAME=yourname.eth
# Register yourname.eth on app.ens.dev to that same address first.

curl -s http://127.0.0.1:3000/api/health | jq .
# registered, no UserRegistry yet → ok:false, subregistry_attached fails

pnpm ops:parent-registry
# deploys UserRegistry, setParent, setSubregistry

curl -s http://127.0.0.1:3000/api/health | jq .
# → ok:true, canProvisionAgents:true
```

`/api/invoices` requires a previously linked domain for the agent.
Protected routes return `402` with an AgentKit challenge when the `agentkit` header is missing. Agents must use `createAgentkitClient(...).fetch` (or the smoke scripts below).

### Domain claim / namespace provision

Billie owns `BILLIE_PARENT_NAME` (e.g. `agentinvoice.eth`) and its UserRegistry.
Agents claim a **namespace** under that parent — Billie deploys their UserRegistry
and registers `{label}.{parent}.eth` on-chain (Billie pays gas).

1. Ensure `/api/health` is `ok: true` (`pnpm ops:parent-registry` if needed).
2. `POST /api/domains` with `{ "name": "alice" }` (or `alice.agentinvoice.eth`) + AgentKit.
3. API verifies human-backed identity (AgentBook on World Chain).
4. If the namespace is already linked, or this agent already has one → `409`.
5. Billie deploys agent UserRegistry, grants `ROLE_REGISTRAR` to the agent, registers the label under the parent registry.
6. Stores `humanId → agentAddress → namespace` (includes `subregistry` for later invoices).

| Status | Meaning |
|--------|---------|
| `402` / `401` / `403` (AgentKit) | not human-backed / bad signature |
| `409` | namespace already linked, label taken on-chain, or agent already has a namespace |
| `503` | parent UserRegistry not ready / Billie key missing |
| `502` | on-chain provision failed |
| `200` | provisioned + linked; response includes `mapping`, `subregistry`, `txs` |

```bash
pnpm agent:domain -- alice
# → 200 + alice.<BILLIE_PARENT_NAME> + subregistry
```

### Invoice prepare + submit

Invoice = subdomain under the agent's namespace, e.g. `inv-01.alice.agentinvoice.eth`.

1. Agent has a linked namespace (`POST /api/domains`) with a UserRegistry.
2. `POST /api/invoices` with `{ "label": "inv-01", "amount": "100", "currency": "USDC" }` → Billie EIP-712 `attestation` + `register` calldata targeting the **agent UserRegistry**. Requires `BILLIE_PRIVATE_KEY`.
3. Agent signs the returned tx on Sepolia (agent pays gas).
4. `POST /api/invoices/submit` with `{ "invoiceId", "signedTx" }` → Billie verifies match, broadcasts, waits ~45s for 1 confirmation (or returns `submitted` + hash on timeout).

```bash
pnpm agent:invoice -- alice.agentinvoice.eth inv-01 100 USDC
BILLIE_SUBMIT_INVOICE=1 pnpm agent:invoice -- alice.agentinvoice.eth inv-02 50 USDC
```

Text records (incl. `billie.attestation` on-chain) are still deferred.

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
# → 200 + ok:true when BILLIE_PARENT_NAME is registered, owned by BILLIE_PRIVATE_KEY, and UserRegistry is attached
# → 503 + ok:false + parent.checks[] when not ready (e.g. missing subregistry)
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

### 6. Namespace claim

1. Parent ready: `curl -s http://127.0.0.1:3000/api/health` → `ok: true`
2. Claim a label under the parent:

```bash
pnpm agent:domain -- alice
# → 200 + mapping { humanId, agentAddress, domain: "alice.<parent>.eth" } + subregistry

pnpm agent:domain -- alice
# → 409 already linked (or agent already has a namespace)
```

### Pass criteria

- [ ] `/api/health` → 200 when parent + UserRegistry ready (else 503 + `parent.checks`)
- [ ] `/api/me` and `/api/domains` without AgentKit → 402
- [ ] Registered agent → `/api/me` 200 + `humanId`
- [ ] Human-backed agent → `/api/domains` provisions namespace + returns `subregistry`
- [ ] Same namespace twice / second namespace for same agent → 409
