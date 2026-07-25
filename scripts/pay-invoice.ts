/**
 * Smoke: resolve invoice + optionally approve/pay via PaymentRouter.
 *
 *   pnpm pay:invoice -- <invoice.full.name.eth>
 *
 * With BILLIE_PAY_INVOICE=1 and PAYER_PRIVATE_KEY (or AGENT_PRIVATE_KEY):
 * broadcast approve + payInvoice on Sepolia.
 */
import {
  createPublicClient,
  createWalletClient,
  http,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { sepolia } from "viem/chains";

const API_URL = process.env.BILLIE_API_URL ?? "http://127.0.0.1:3000";
const PAY = process.env.BILLIE_PAY_INVOICE === "1";
const TIMEOUT_MS = Number(process.env.AGENT_TIMEOUT_MS ?? 60_000);

function parseArgs(argv: string[]): { name: string } {
  const args = argv.slice(2).filter((a) => a !== "--");
  const [name] = args;
  if (!name) {
    throw new Error("Usage: pnpm pay:invoice -- <invoice.full.name.eth>");
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
  const body = await res.json().catch(() => null);
  console.log(`Status: ${res.status}`);
  console.log(JSON.stringify(body, null, 2));
  if (!res.ok) process.exit(1);

  if (!PAY) {
    console.log("\nSkipping pay (set BILLIE_PAY_INVOICE=1 to broadcast).");
    process.exit(0);
  }

  if (!body?.pay) {
    console.error("No pay calldata (already paid or router/token missing).");
    process.exit(1);
  }

  const key = (process.env.PAYER_PRIVATE_KEY ??
    process.env.AGENT_PRIVATE_KEY) as `0x${string}` | undefined;
  if (!key) {
    console.error("Set PAYER_PRIVATE_KEY or AGENT_PRIVATE_KEY in .env");
    process.exit(1);
  }

  const account = privateKeyToAccount(key);
  const rpc = process.env.ETHEREUM_SEPOLIA_RPC_URL;
  const publicClient = createPublicClient({
    chain: sepolia,
    transport: http(rpc),
  });
  const wallet = createWalletClient({
    account,
    chain: sepolia,
    transport: http(rpc),
  });

  console.log(`Payer: ${account.address}`);

  const approveHash = await wallet.sendTransaction({
    to: body.pay.approve.to,
    data: body.pay.approve.data as Hex,
    value: BigInt(0),
  });
  console.log("approve tx:", approveHash);
  await publicClient.waitForTransactionReceipt({ hash: approveHash });

  const payHash = await wallet.sendTransaction({
    to: body.pay.payInvoice.to,
    data: body.pay.payInvoice.data as Hex,
    value: BigInt(0),
  });
  console.log("payInvoice tx:", payHash);
  const receipt = await publicClient.waitForTransactionReceipt({ hash: payHash });
  console.log("pay status:", receipt.status);

  const again = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
  const after = await again.json().catch(() => null);
  console.log("\nStatus after pay:");
  console.log(JSON.stringify(after, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
