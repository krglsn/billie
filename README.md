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
| `GET` | `/api/invoices/resolve` | public | ENS texts + computed payment status + approve/pay calldata |

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
   If the namespace is **already on-chain** for this agent (owner + UserRegistry + `ROLE_REGISTRAR`), Billie **re-links** it in memory after a restart (`relinked: true`, no new txs).
6. Stores `humanId → agentAddress → namespace` in SQLite (`data/billie.sqlite`, override with `BILLIE_DB_PATH`) including `subregistry` for later invoices.

Optional anti-abuse (Billie pays gas for new namespaces): set `BILLIE_DOMAIN_CLAIM_RATE_LIMIT` + `BILLIE_DOMAIN_CLAIM_RATE_WINDOW_SEC` (default window 86400s). Exceeded → `429` + `Retry-After`. Re-links do not count.

| Status | Meaning |
|--------|---------|
| `402` / `401` / `403` (AgentKit) | not human-backed / bad signature |
| `409` | namespace already linked, label taken on-chain, or agent already has a namespace |
| `429` | humanId domain-claim rate limit (`BILLIE_DOMAIN_CLAIM_RATE_LIMIT`) |
| `503` | parent UserRegistry not ready / Billie key missing |
| `502` | on-chain provision failed |
| `200` | provisioned + linked; response includes `mapping`, `subregistry`, `txs` |

```bash
pnpm agent:domain -- alice
# → 200 + alice.<BILLIE_PARENT_NAME> + subregistry
```

### Invoice prepare + submit

Invoice = subdomain under the agent's namespace, e.g. `inv-01.alice.agentinvoice.eth`.

Settlement fields (written as ENS texts after submit):

- `amount` — **atomic units** string (e.g. `1000000` for 1 USDC with 6 decimals)
- `currency` — human ticker (`USDC`)
- `token` — ERC-20 address
- `paymentAddress` — optional; defaults to the agent wallet

1. Deploy invoice resolver once: `pnpm ops:invoice-resolver` → set `BILLIE_INVOICE_RESOLVER` in `.env`, restart API.
2. Deploy payment router: `pnpm ops:payment-router` → set `BILLIE_PAYMENT_ROUTER` (needs [Foundry](https://book.getfoundry.sh/) `forge`).
3. Agent has a linked namespace (`POST /api/domains`) with a UserRegistry.
4. `POST /api/invoices` → requires `canWriteInvoiceTexts`; returns attestation + `texts` preview + `register` calldata (resolver = Billie PermissionedResolver). `503` + `invoice_texts_unavailable` if resolver/roles not ready.
5. Agent signs + `POST /api/invoices/submit` (agent pays gas for register).
6. After confirm, Billie writes ENS text records via resolver `multicall` (`billie.amount`, `billie.token`, `billie.attestation`, …). Differentiated `code` if register or texts fail.

```bash
pnpm ops:invoice-resolver
# add BILLIE_INVOICE_RESOLVER=0x... to .env and restart

pnpm ops:payment-router
# add BILLIE_PAYMENT_ROUTER=0x... to .env and restart

# Publish source on Sepolia Etherscan (methods + Solidity on Contract tab):
# set ETHERSCAN_API_KEY in .env, then:
pnpm ops:payment-router -- --verify-only

pnpm agent:invoice -- alice.agentinvoice.eth inv-01 1000000 USDC 0xTokenAddress
BILLIE_SUBMIT_INVOICE=1 pnpm agent:invoice -- alice.agentinvoice.eth inv-02 500000 USDC 0xTokenAddress
```

Design notes: [docs/invoice-payment-router.md](./docs/invoice-payment-router.md).

### Pay invoice (Billie Pay)

1. `GET /api/invoices/resolve?name=inv-01.alice.agentinvoice.eth` — reads ENS texts, `eth_call` `PaymentRouter.paid` / `checkInvoice`, returns computed `paymentStatus` and approve + `payInvoice` calldata.
2. Payer approves the ERC-20 to the router, then calls `payInvoice(node)`.
3. Re-resolve: `paymentStatus` becomes `paid` when `paid[node]` is true (no event listener).

```bash
# Status only (no wallet)
pnpm invoice:status -- inv-01.alice.agentinvoice.eth

# Approve + pay from a third-party wallet (private key on CLI)
pnpm pay:invoice -- inv-01.alice.agentinvoice.eth 0xPayerPrivateKey
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
