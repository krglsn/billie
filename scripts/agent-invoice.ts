/**
 * Smoke-test invoice prepare (+ optional submit).
 *
 * Requires a linked domain for the agent (POST /api/domains first).
 *
 *   pnpm agent:invoice -- inv-01 100 USDC
 *   BILLIE_SUBMIT_INVOICE=1 pnpm agent:invoice -- inv-01 100 USDC
 */
import { createAgentkitClient } from "@worldcoin/agentkit";
import {
  createWalletClient,
  http,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { sepolia } from "viem/chains";

const API_URL = process.env.BILLIE_API_URL ?? "http://127.0.0.1:3000";
const CHAIN_ID = process.env.AGENT_CHAIN_ID ?? "eip155:8453";
const TIMEOUT_MS = Number(process.env.AGENT_TIMEOUT_MS ?? 60_000);
const SUBMIT = process.env.BILLIE_SUBMIT_INVOICE === "1";

async function main() {
  const privateKey = process.env.AGENT_PRIVATE_KEY as `0x${string}` | undefined;
  if (!privateKey) {
    console.error("Set AGENT_PRIVATE_KEY in .env");
    process.exit(1);
  }

  const label = process.argv[2];
  const amount = process.argv[3] ?? "100";
  const currency = process.argv[4] ?? "USDC";
  if (!label) {
    console.error("Usage: pnpm agent:invoice -- <label> [amount] [currency]");
    process.exit(1);
  }

  const account = privateKeyToAccount(privateKey);
  console.log(`Agent address: ${account.address}`);

  const agentkit = createAgentkitClient({
    signer: {
      address: account.address,
      chainId: CHAIN_ID,
      type: "eip191",
      signMessage: (message) => account.signMessage({ message }),
    },
    onEvent: (event) => console.log("  agentkit:", event.type),
  });

  console.log(`Preparing invoice ${label} (${amount} ${currency})...`);
  const prepareRes = await agentkit.fetch(`${API_URL}/api/invoices`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ label, amount, currency }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const prepared = await prepareRes.json().catch(() => null);
  console.log(`Prepare status: ${prepareRes.status}`);
  console.log(JSON.stringify(prepared, null, 2));
  if (!prepareRes.ok) process.exit(1);

  if (!SUBMIT) {
    console.log("\nSkipping submit (set BILLIE_SUBMIT_INVOICE=1 to broadcast).");
    process.exit(0);
  }

  const wallet = createWalletClient({
    account,
    chain: sepolia,
    transport: http(process.env.ETHEREUM_SEPOLIA_RPC_URL),
  });

  const signedTx = await wallet.signTransaction({
    to: prepared.tx.to,
    data: prepared.tx.data,
    value: BigInt(prepared.tx.value ?? 0),
    chainId: sepolia.id,
  });

  console.log("\nSubmitting signed tx...");
  const submitRes = await agentkit.fetch(`${API_URL}/api/invoices/submit`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      invoiceId: prepared.invoiceId,
      signedTx: signedTx as Hex,
    }),
    signal: AbortSignal.timeout(TIMEOUT_MS + 60_000),
  });
  const submitted = await submitRes.json().catch(() => null);
  console.log(`Submit status: ${submitRes.status}`);
  console.log(JSON.stringify(submitted, null, 2));
  process.exit(submitRes.ok ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
