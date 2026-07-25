/**
 * Check invoice payment status via GET /api/invoices/resolve.
 *
 *   pnpm invoice:status -- <namespace> <invoiceLabel>
 *   pnpm invoice:status -- agent_invoices invoice_01
 *
 * Resolves to `{invoiceLabel}.{namespace}.{BILLIE_PARENT_NAME}`.
 */
import { getBillieParentName } from "../lib/billie-parent";

const API_URL = process.env.BILLIE_API_URL ?? "http://127.0.0.1:3000";
const TIMEOUT_MS = Number(process.env.AGENT_TIMEOUT_MS ?? 60_000);

function parseArgs(argv: string[]): {
  namespace: string;
  invoiceLabel: string;
  fullName: string;
} {
  const args = argv.slice(2).filter((a) => a !== "--");
  const [namespace, invoiceLabel] = args;
  if (!namespace || !invoiceLabel) {
    throw new Error(
      "Usage: pnpm invoice:status -- <namespace> <invoiceLabel>",
    );
  }

  const parent = getBillieParentName();
  if (!parent) {
    throw new Error("Set BILLIE_PARENT_NAME in .env (e.g. agentinvoice.eth)");
  }

  const fullName = `${invoiceLabel}.${namespace}.${parent}`;
  return { namespace, invoiceLabel, fullName };
}

async function main() {
  let parsed;
  try {
    parsed = parseArgs(process.argv);
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  }

  console.log(
    `Namespace: ${parsed.namespace}  Invoice: ${parsed.invoiceLabel}`,
  );
  console.log(`Full name: ${parsed.fullName}`);

  const url = `${API_URL}/api/invoices/resolve?name=${encodeURIComponent(parsed.fullName)}`;
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
