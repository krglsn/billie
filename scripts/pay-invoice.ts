/**
 * Approve + pay an invoice from a third-party payer wallet.
 *
 * Private key is taken from the CLI (not .env) so the payer can differ from the agent.
 *
 *   pnpm pay:invoice -- <invoice.full.name.eth> <payerPrivateKey>
 *
 * Example:
 *   pnpm pay:invoice -- inv-01.alice.agentinvoice.eth 0xabc…
 *
 * Resolves the invoice via Billie API, then broadcasts ERC-20 approve + payInvoice on Sepolia.
 */
import {
  createPublicClient,
  createWalletClient,
  http,
  isHex,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { sepolia } from "viem/chains";

const API_URL = process.env.BILLIE_API_URL ?? "http://127.0.0.1:3000";
const TIMEOUT_MS = Number(process.env.AGENT_TIMEOUT_MS ?? 60_000);

function parseArgs(argv: string[]): { name: string; privateKey: Hex } {
  const args = argv.slice(2).filter((a) => a !== "--");
  const [name, privateKeyRaw] = args;
  if (!name || !privateKeyRaw) {
    throw new Error(
      "Usage: pnpm pay:invoice -- <invoice.full.name.eth> <payerPrivateKey>",
    );
  }
  const privateKey = (
    privateKeyRaw.startsWith("0x") ? privateKeyRaw : `0x${privateKeyRaw}`
  ) as Hex;
  if (!isHex(privateKey) || privateKey.length !== 66) {
    throw new Error(
      "payerPrivateKey must be a 32-byte hex key (64 hex chars, optional 0x)",
    );
  }
  return { name, privateKey };
}

async function main() {
  let parsed;
  try {
    parsed = parseArgs(process.argv);
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  }

  const account = privateKeyToAccount(parsed.privateKey);
  console.log(`Payer: ${account.address}`);
  console.log(`Invoice: ${parsed.name}`);

  const url = `${API_URL}/api/invoices/resolve?name=${encodeURIComponent(parsed.name)}`;
  console.log("GET", url);
  const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
  const body = await res.json().catch(() => null);
  console.log(`Resolve HTTP ${res.status}`);
  if (!res.ok) {
    console.log(JSON.stringify(body, null, 2));
    process.exit(1);
  }

  console.log(
    `paymentStatus=${body.paymentStatus} paidOnRouter=${body.paidOnRouter}`,
  );

  if (!body?.pay) {
    console.error(
      "No pay calldata — invoice already paid, or router/token/texts missing.",
    );
    console.log(JSON.stringify(body, null, 2));
    process.exit(1);
  }

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

  console.log(
    `\nApproving ${body.amount} of ${body.token} for router ${body.pay.router}...`,
  );
  const approveHash = await wallet.sendTransaction({
    to: body.pay.approve.to,
    data: body.pay.approve.data as Hex,
    value: BigInt(0),
  });
  console.log("approve tx:", approveHash);
  const approveReceipt = await publicClient.waitForTransactionReceipt({
    hash: approveHash,
  });
  if (approveReceipt.status !== "success") {
    console.error("approve reverted");
    process.exit(1);
  }

  console.log("\nCalling payInvoice...");
  const payHash = await wallet.sendTransaction({
    to: body.pay.payInvoice.to,
    data: body.pay.payInvoice.data as Hex,
    value: BigInt(0),
  });
  console.log("payInvoice tx:", payHash);
  const payReceipt = await publicClient.waitForTransactionReceipt({
    hash: payHash,
  });
  console.log("pay status:", payReceipt.status);
  if (payReceipt.status !== "success") {
    process.exit(1);
  }

  const again = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
  const after = await again.json().catch(() => null);
  console.log("\nStatus after pay:");
  console.log(
    JSON.stringify(
      {
        paymentStatus: after?.paymentStatus,
        paidOnRouter: after?.paidOnRouter,
        amount: after?.amount,
        token: after?.token,
        paymentAddress: after?.paymentAddress,
      },
      null,
      2,
    ),
  );
  process.exit(after?.paymentStatus === "paid" ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
