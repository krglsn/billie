# Billie

Invoice system for human-backed agents. If your agent is verified with World AgentKit, it can create invoices in Billie that are saved as ENS names and can be easily shared as a domain link and paid by anyone.

## Naming

Every invoice is a three-level ENS name under Billie’s parent:

```text
inv.agent.parent.eth
 │    │     └─ BILLIE_PARENT_NAME (owned by the service)
 │    └─ agent namespace (one per agent)
 └─ invoice label
```

Example: `inv.agent.parent.eth` → invoice `inv` under namespace `agent` on parent `parent.eth`.

## Stack

- Next.js (App Router) + TypeScript
- pnpm
- World AgentKit (human-backed agent verification)
- viem
- **ENSv2** — register names, subdomains, registries, and roles

## Chains

| Asset | Network | CAIP-2 |
|-------|---------|--------|
| Parent ENS (`BILLIE_PARENT_NAME`) | Ethereum Sepolia (ENSv2) | `eip155:11155111` |
| Agent namespace + invoice subdomains | Ethereum Sepolia (ENSv2) | `eip155:11155111` |
| AgentBook lookup | World Chain | `eip155:480` |

## Flow

An AI agent associated with a wallet and backed by a World ID connects to the Billie API, claims a namespace, and issues invoices. Each invoice is an ENS subdomain filled with text records — easy to share, verify, and pay.

## Roles

### Service operator

- Registers the parent ENS name and sets it up
- Launches the Billie API and dashboard
- Deploys the Billie PaymentRouter contract

### AI agent

- Connects to the Billie API; if it is a verified human-backed agent, it can:
  - claim a namespace under the parent (`agent.parent.eth`)
  - issue an invoice as an ENS subdomain (`inv.agent.parent.eth`), attested by Billie

### Customer

- Validates an invoice through the Billie dashboard or on-chain
- Pays the invoice according to its parameters

## How it works

### Domain claim / namespace provision

Billie owns `BILLIE_PARENT_NAME` (e.g. `parent.eth`) and its UserRegistry.
Agents claim a **namespace** under that parent — Billie deploys their UserRegistry
and registers `agent.parent.eth` on-chain (Billie pays gas). One namespace per agent.

Optional anti-abuse (Billie pays gas for new namespaces): set `BILLIE_DOMAIN_CLAIM_RATE_LIMIT` + `BILLIE_DOMAIN_CLAIM_RATE_WINDOW_SEC` (default window 86400s). Exceeded → `429` + `Retry-After`. Re-links do not count.

### Invoice prepare + submit

Invoice = subdomain under the agent’s namespace, e.g. `inv.agent.parent.eth`.

Settlement fields are written as ENS texts after submit. A few of them:

- `amount` — **atomic units** string (e.g. `1000000` for 1 USDC with 6 decimals)
- `token` — ERC-20 address
- `paymentAddress` — optional; defaults to the agent wallet
- `attestation` — EIP-712 Billie attestation

### Pay invoice

1. `GET /api/invoices/resolve?name=inv.agent.parent.eth` — reads ENS texts, `eth_call` `PaymentRouter.paid` / `checkInvoice`, returns computed `paymentStatus` and approve + `payInvoice` calldata.
2. Payer approves the ERC-20 to the router, then calls `payInvoice(node)`.
3. Re-resolve: `paymentStatus` becomes `paid` when `paid[node]` is true (no event listener). Paid only via PaymentRouter — a plain ERC-20 transfer does not mark the invoice paid.

## Quick start guide

Use `127.0.0.1`, not `localhost` (the dev server binds IPv4 only). Copy `.env.example` → `.env` and fill the vars listed per section below.

### 1. Billie setup (server)

**Env to run the Billie server** (local or Vercel):

| Variable | Required | Notes |
|----------|----------|-------|
| `BILLIE_PRIVATE_KEY` | yes | Service key; must own `BILLIE_PARENT_NAME` on Sepolia ENSv2; pays gas + signs attestations |
| `BILLIE_PARENT_NAME` | yes | Parent ENS, e.g. `parent.eth` |
| `BILLIE_INVOICE_RESOLVER` | yes | Shared PermissionedResolver for invoice texts (`pnpm ops:invoice-resolver`) |
| `BILLIE_PAYMENT_ROUTER` | yes | PaymentRouter address (`pnpm ops:payment-router`) |
| `BILLIE_DB_PATH` | yes on Vercel | SQLite path. Local default `data/billie.sqlite`. On Vercel use `/tmp/billie.sqlite` (ephemeral) |
| `WORLD_CHAIN_RPC_URL` | recommended | World Chain RPC for AgentBook (avoid flaky public RPC) |
| `ETHEREUM_SEPOLIA_RPC_URL` | recommended | Sepolia RPC for ENSv2 + txs |

One-time ops before the server can provision agents / write invoices:

1. Manually register the parent name on Sepolia ENSv2 (e.g. `parent.eth`).
2. Set at least `BILLIE_PRIVATE_KEY` and `BILLIE_PARENT_NAME` in `.env`.
3. Deploy UserRegistry, `setParent`, `setSubregistry`:

```bash
pnpm ops:parent-registry
```

4. Deploy the invoice resolver, then set `BILLIE_INVOICE_RESOLVER`:

```bash
pnpm ops:invoice-resolver
```

5. Deploy the Billie PaymentRouter, then set `BILLIE_PAYMENT_ROUTER`.

   Optional for verify: `ETHERSCAN_API_KEY`.

```bash
pnpm ops:payment-router
```

6. Launch the app and check `/api/health`:

```bash
pnpm install
pnpm dev --hostname 127.0.0.1 --port 3000
```

### 2. Agent setup (scripts)

**Env for agent smoke scripts** (`pnpm agent:*` / `pnpm invoice:status`):

| Variable | Required | Notes |
|----------|----------|-------|
| `AGENT_PRIVATE_KEY` | yes | Agent wallet (register in AgentBook first) |
| `BILLIE_API_URL` | if remote | Billie base URL. Default `http://127.0.0.1:3000`. Point at your Vercel URL when not using local `pnpm dev` |
| `BILLIE_SUBMIT_INVOICE` | for broadcast | Set to `1` so `pnpm agent:invoice` also POSTs `/api/invoices/submit` |

1. Set `AGENT_PRIVATE_KEY` in `.env`.
2. Register the agent in World AgentBook (confirm with your World ID):

```bash
npx @worldcoin/agentkit-cli register <agent wallet address>
```

3. Check agent authorization on the Billie API:

```bash
pnpm agent:me
```

4. Claim a namespace for the agent (one per agent), e.g. `agent` → `agent.parent.eth`:

```bash
pnpm agent:domain agent
```

5. Prepare an invoice, get attested calldata from Billie, sign, and submit (set `BILLIE_SUBMIT_INVOICE=1` to broadcast).
   `amount` is **atomic units** (USDC has 6 decimals → `1000000` = 1 USDC). The script hardcodes the Sepolia USDC token.

```bash
pnpm agent:invoice agent inv 1000000 USDC
```

   Resolves on-chain to `inv.agent.parent.eth`.

6. Check that the invoice is unpaid:

```bash
pnpm invoice:status agent inv
```

### 3. Pay invoice using the dashboard

**Env:** none on the client. The dashboard talks to the same Billie server from §1 (local or via `BILLIE_API_URL` / deployed URL). Payer only needs a wallet on Ethereum Sepolia with USDC.

1. Open http://127.0.0.1:3000 (or your Vercel deployment)
2. Choose agent and domain to see invoices
3. Open an invoice
4. Connect a wallet, approve, and pay the Sepolia USDC amount on the invoice
5. Invoice status becomes paid

## Billie API endpoints

| Method | Path | Auth | Notes |
|--------|------|------|-------|
| `GET` | `/api/health` | public | liveness + parent ENSv2 readiness (`canProvisionAgents`, `canWriteInvoiceTexts`) |
| `GET` | `/api/me` | AgentKit | `agentAddress` + `humanId` |
| `GET` | `/api/agents` | public | linked agents + namespaces (pay dashboard) |
| `GET` | `/api/invoices?agent=&domain=` | public | list invoices for agent/domain + computed `paymentStatus` |
| `POST` | `/api/domains` | AgentKit | claim namespace `agent.parent.eth` (Billie pays gas) |
| `POST` | `/api/invoices` | AgentKit | prepare `inv.agent.parent.eth` + EIP-712 attestation + register calldata |
| `POST` | `/api/invoices/submit` | AgentKit | verify signed register tx, broadcast, write ENS texts |
| `GET` | `/api/invoices/resolve?name=` | public | ENS texts, verification badges, `paymentStatus`, approve/`payInvoice` calldata |
