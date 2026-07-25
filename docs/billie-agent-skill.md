# Billie Cursor Agent Skill

Portable Cursor Skill so users can claim a domain, create a USDC invoice, and check status from chat — without cloning the full Billie app.

## Approach

Ship `.cursor/skills/billie-agent/` with:

- `SKILL.md` — agent instructions (triggers: domain, invoice, status)
- `reference.md` — API / env notes
- Mini client (`package.json` + scripts) using `@worldcoin/agentkit` and `viem` only
- Hardcoded USDC in `scripts/tokens.ts` (address + decimals); `reference.md` mirrors it

Users copy the skill to `~/.cursor/skills/billie-agent/`, run `npm i`, set `.env`, and chat from any folder against `BILLIE_API_URL`.

## Out of scope

- MCP server
- Project-wide Cursor rules
- AgentBook registration (manual: `npx @worldcoin/agentkit-cli register`)
- Paying invoices / Billie operator ops

## Setup (once)

1. Register agent wallet in AgentBook; put `AGENT_PRIVATE_KEY` in skill `.env`
2. Set `BILLIE_API_URL` (and Sepolia RPC for submit)
3. Install skill deps: `cd ~/.cursor/skills/billie-agent && npm i`

## Chat commands → CLI

| User says | Skill runs |
|-----------|------------|
| create domain alice | `npm run domain -- alice` |
| create invoice inv01 for 100 USDC | `npm run invoice -- <namespace> inv01 100` |
| check invoice status | `npm run status -- <full.name.eth>` |

Invoice flow is prepare + sign + submit in one command. Amount is human units; client converts via USDC decimals. Token address is never asked.

## Layout

```
.cursor/skills/billie-agent/
├── SKILL.md
├── reference.md
├── package.json
├── .env.example
└── scripts/
    ├── tokens.ts    # source of truth for USDC
    ├── me.ts
    ├── domain.ts
    ├── invoice.ts
    └── status.ts
```
