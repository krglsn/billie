# Billie

Invoice system for human-backed agents. If your agent is verified with World AgentKit, it can create invoices in Billie that are saved as ENS domains and can be easily shared as domain link and paid by anyone.

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


## Flow

AI Agent associated with a wallet and backed by your World ID connects to Billie API, registers a domain and can issue invoices via Billie API. Invoices are ENS subdomains that filled with domain text records representing the invoice - easy to share, verify and pay.

## Roles

### Service operator
- Registers root domain for invoices and set them up properly
- Launches Billie API and Dashboard
- Deploys Billie Router contract

### AI Agent
- Connects Billie API and can use the following features if he is verified human-backed agent:
-- registers a new subdomain for invoices
-- issues an invoice in form of ENS subdomain, verified and attestated by Billie

### Customer
- Validates invoice through Billie dashboard or smart contract
- Pays the invoice per its parameters

## Billie API Endpoints

| Method | Path | Auth | Notes |
|--------|------|------|-------|
| `GET` | `/api/health` | public | liveness + Billie parent ENSv2 readiness |
| `GET` | `/api/me` | AgentKit | returns `agentAddress` + `humanId` |
| `POST` | `/api/domains` | AgentKit | provision agent namespace under parent + link |
| `POST` | `/api/invoices` | AgentKit | prepare invoice subdomain tx + Billie EIP-712 attestation |
| `POST` | `/api/invoices/submit` | AgentKit | verify signed tx, broadcast to Sepolia, wait briefly |
| `GET` | `/api/invoices/resolve` | public | ENS texts + computed payment status + approve/pay calldata |

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
6. Stores `humanId → agentAddress → namespace` (includes `subregistry` for later invoices).

Optional anti-abuse (Billie pays gas for new namespaces): set `BILLIE_DOMAIN_CLAIM_RATE_LIMIT` + `BILLIE_DOMAIN_CLAIM_RATE_WINDOW_SEC` (default window 86400s). Exceeded → `429` + `Retry-After`. Re-links do not count.

### Invoice prepare + submit

Invoice = subdomain under the agent's namespace, e.g. `inv-01.alice.agentinvoice.eth`.

Settlement fields are written as ENS texts after submit

- `amount` — **atomic units** string (e.g. `1000000` for 1 USDC with 6 decimals)
- `token` — ERC-20 address
- `paymentAddress` — optional; defaults to the agent wallet
- `attestation` - EIP721 Billie attestation value

### Pay invoice

1. `GET /api/invoices/resolve?name=inv-01.alice.agentinvoice.eth` — reads ENS texts, `eth_call` `PaymentRouter.paid` / `checkInvoice`, returns computed `paymentStatus` and approve + `payInvoice` calldata.
2. Payer approves the ERC-20 to the router, then calls `payInvoice(node)`.
3. Re-resolve: `paymentStatus` becomes `paid` when `paid[node]` is true (no event listener).


## Quick start guide

### 1. Billie setup

1. Manually register root Billie domain via ENS dashboard. 
2. Set BILLIE_PRIVATE_KEY and BILLIE_PARENT_NAME in .env
3. Deploy UserRegistry, setParent, setSubregistry
```bash
pnpm ops:parent-registry
``` 
4. Set resolver, get result adn add BILLIE_INVOICE_RESOLVER to .env
 ```bash
 pnpm ops:invoice-resolver
 ```
 
5. Deploy Billie router, get the address and add BILLIE_PAYMENT_ROUTER to the .env

Note: you need to set `ETHERSCAN_API_KEY` env var to get contract verified and readable on Etherscan 
```bash
pnpm ops:payment-router
``` 
6. Launch the app and validate /api/health status after launch 
```bash
pnpm dev --hostname 127.0.0.1 --port 3000
```

### 2. Agent setup
1. Set `AGENT_PRIVATE_KEY` in .env
2. Register the agent in World agentBook using confirmation by you WorldID:
```bash
npx @worldcoin/agentkit-cli register <agent wallet address>
```
3. Check agent authorisation on Billie API
```bash
pnpm agent:me
```
4. Register a namespace (subdomain) for agent invoices (can have multiple per agent)
```bash
pnpm agent:domain agent_invoices
```
5. Prepare invoice with parameters, get attestated calldata from Billie API sign and submit back to Billie:
```bash
pnpm agent:invoice agent_invoices invoice_01 100 USDC
```
6. Check the status of invoice to ensure it is unpaid:
```bash
pnpm invoice:status agent_invoices invoice_01
```

### 3. Pay invoice using dashboard
1. Open webdashboard in the browser http://127.0.0.1:3000
2. Choose Agent and Domain to see invoices
3. Choose invoice
4. Connect a wallet, approve and pay amount of Sepolia USDC specified in the invoice
5. Invoice status changed to paid

