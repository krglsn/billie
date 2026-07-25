---
name: billie-agent
description: Claim Billie ENS namespaces, create USDC invoices (prepare/sign/submit), and check invoice status via the Billie API. Use when the user mentions Billie, create domain, claim namespace, create invoice, invoice status, or AgentKit agent invoices.
---

# Billie Agent

Talk to a deployed Billie API from chat. Run all commands from this skill directory.

## Prerequisites

1. AgentBook registration is **manual** (not done by this skill):
   `npx @worldcoin/agentkit-cli register <address>`
2. Copy `.env.example` → `.env`: `AGENT_PRIVATE_KEY`, `BILLIE_API_URL`, `ETHEREUM_SEPOLIA_RPC_URL`
3. `npm install` once in this directory

Never print `AGENT_PRIVATE_KEY` in replies.

## Commands

Run from the skill root (`~/.cursor/skills/billie-agent` or this folder in the repo).

| User intent | Command |
|-------------|---------|
| Who am I / auth check | `npm run me` |
| Create domain `alice` | `npm run domain -- alice` |
| Create invoice `inv01` for 100 USDC | `npm run invoice -- <namespace.eth> inv01 100` |
| Check status | `npm run status -- <inv01.namespace.eth>` |

- **USDC only** — address and decimals are hardcoded in `scripts/tokens.ts`. Do not ask for a token address.
- **Invoice** always prepare + sign + submit in one run.
- Human amount (`100`) is converted to atomic units by the client.
- After `domain`, remember the returned `name` (full namespace) for invoices.

## Details

See [reference.md](reference.md) for env vars, endpoints, and the USDC constant.
