# Pay dashboard plan

Laconic payer UI on top of existing invoice + PaymentRouter APIs.

## Flow

1. `/` — pick agent → pick domain → invoices table (name, agent, humanId, status, Pay).
2. Pay → `/invoice?name=<full.ens.name>` — detail table (name links to explorer.ens.dev) + Connect wallet.
3. After connect → Approve & Pay → ERC-20 approve + `payInvoice` (Sepolia).
4. Re-resolve and refresh invoice fields. Spinner on all waits.

## API additions (public)

- `GET /api/agents` — linked agents with `domains[]` from in-memory domain store.
- `GET /api/invoices?agent=0x…&domain=…` — invoices for that agent/domain; `paymentStatus` via memory texts + `paid(node)` when router is configured.

Detail page reuses `GET /api/invoices/resolve?name=`.

## UI

- Minimal CSS (system font, tables). No wagmi — `window.ethereum` + viem.
- Components: Spinner, WalletPayButton.
- Helpers: `listLinkedDomains`, `listInvoicesByAgent`, `lib/browser-wallet.ts`.

## Out of scope

Invoice creation UI, chain indexer after API restart, native ETH, dashboard auth.
