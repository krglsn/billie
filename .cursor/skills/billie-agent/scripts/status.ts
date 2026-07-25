/**
 * Check invoice status via GET /api/invoices/resolve.
 *
 *   npm run status -- <invoice.full.name.eth>
 */
import { API_URL, TIMEOUT_MS, positionalArgs } from "./client.ts";

async function main() {
  const [name] = positionalArgs(process.argv);
  if (!name) {
    console.error("Usage: npm run status -- <invoice.full.name.eth>");
    process.exit(1);
  }

  const url = `${API_URL}/api/invoices/resolve?name=${encodeURIComponent(name)}`;
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
    payable: (body.routerCheck as { payable?: boolean } | null)?.payable,
    reason: (body.routerCheck as { reason?: string } | null)?.reason,
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
