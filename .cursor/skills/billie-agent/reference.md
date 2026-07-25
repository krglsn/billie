# Billie agent skill — reference

## Env

| Variable | Required | Notes |
|----------|----------|-------|
| `AGENT_PRIVATE_KEY` | yes | Agent EOA; must be registered in AgentBook |
| `BILLIE_API_URL` | yes | Billie HTTP API base (no trailing slash) |
| `ETHEREUM_SEPOLIA_RPC_URL` | yes for invoice submit | Used to sign/broadcast register tx |
| `AGENT_CHAIN_ID` | no | Default `eip155:8453` (AgentKit signer CAIP-2) |

## Supported tokens

Source of truth: `scripts/tokens.ts` (keep this table in sync).

| Symbol | Chain | Address | Decimals |
|--------|-------|---------|----------|
| USDC | Sepolia (`11155111`) | `0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238` | 6 |

## API

| Method | Path | Auth |
|--------|------|------|
| `GET` | `/api/me` | AgentKit |
| `POST` | `/api/domains` | AgentKit — body `{ "name": "<label>" }` |
| `POST` | `/api/invoices` | AgentKit — prepare |
| `POST` | `/api/invoices/submit` | AgentKit — `{ invoiceId, signedTx }` |
| `GET` | `/api/invoices/resolve?name=` | public |

## Amounts

CLI takes **human** USDC (`100`). Client sends atomic string (`100000000`) to the API.

## Install (without full Billie repo)

```bash
cp -R .cursor/skills/billie-agent ~/.cursor/skills/billie-agent
cd ~/.cursor/skills/billie-agent
npm install
cp .env.example .env
```
