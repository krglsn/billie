/**
 * Check invoice payment status via GET /api/invoices/resolve.
 *
 *   pnpm invoice:status -- <invoice.full.name.eth>
 */
const API_URL = process.env.BILLIE_API_URL ?? "http://127.0.0.1:3000";
const TIMEOUT_MS = Number(process.env.AGENT_TIMEOUT_MS ?? 60_000);

function parseArgs(argv: string[]): { name: string } {
  const args = argv.slice(2).filter((a) => a !== "--");
  const [name] = args;
  if (!name) {
    throw new Error("Usage: pnpm invoice:status -- <invoice.full.name.eth>");
  }
  return { name };
}

async function main() {
  let parsed;
  try {
    parsed = parseArgs(process.argv);
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  }

  const url = `${API_URL}/api/invoices/resolve?name=${encodeURIComponent(parsed.name)}`;
  console.log("GET", url);
  const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
  const body = (await res.json().catch(() => null)) as Record<
    string,
    unknown
  > | null;
  console.log(`HTTP ${res.status}`);

  if (!res.ok || !body) {
    console.log(JSON.stringify(body, null, 2));
    process.exit(1);
  }

  const summary = {
    fullName: body.fullName,
    paymentStatus: body.paymentStatus,
    paidOnRouter: body.paidOnRouter,
    ensStatus: body.ensStatus,
    amount: body.amount,
    currency: body.currency,
    token: body.token,
    paymentAddress: body.paymentAddress,
    invoiceId: body.invoiceId,
    router: body.router,
    routerCheck: body.routerCheck,
    payable: (body.routerCheck as { payable?: boolean } | null)?.payable,
    reason: (body.routerCheck as { reason?: string } | null)?.reason,
    hasPayCalldata: Boolean(body.pay),
  };

  console.log("\nSummary:");
  console.log(JSON.stringify(summary, null, 2));
  console.log("\nFull response:");
  console.log(JSON.stringify(body, null, 2));
  process.exit(0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
