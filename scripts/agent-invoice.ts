/**
 * Smoke-test invoice prepare (+ optional submit).
 *
 * Requires a claimed domain for the agent (POST /api/domains first).
 *
 *   pnpm agent:invoice -- <domain.eth> <label> <amount> <currency>
 *   pnpm agent:invoice -- agentinvoice3.eth inv-01 100 USDC
 *
 * With BILLIE_SUBMIT_INVOICE=1: sign Sepolia tx and POST /api/invoices/submit.
 * Stub calldata often reverts in eth_estimateGas — use:
 *
 *   BILLIE_SUBMIT_INVOICE=1 BILLIE_SKIP_GAS_ESTIMATE=1 pnpm agent:invoice -- agentinvoice3.eth inv-05 50 USDC
 *
 * Optional: BILLIE_TX_GAS, BILLIE_TX_MAX_FEE_GWEI, BILLIE_TX_PRIORITY_FEE_GWEI.
 */
import { createAgentkitClient } from "@worldcoin/agentkit";
import {
  createPublicClient,
  createWalletClient,
  http,
  parseGwei,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { sepolia } from "viem/chains";

const API_URL = process.env.BILLIE_API_URL ?? "http://127.0.0.1:3000";
const CHAIN_ID = process.env.AGENT_CHAIN_ID ?? "eip155:8453";
const TIMEOUT_MS = Number(process.env.AGENT_TIMEOUT_MS ?? 60_000);
const SUBMIT = process.env.BILLIE_SUBMIT_INVOICE === "1";
const SKIP_GAS_ESTIMATE = process.env.BILLIE_SKIP_GAS_ESTIMATE === "1";
const TX_GAS = BigInt(process.env.BILLIE_TX_GAS ?? "200000");
const TX_MAX_FEE_GWEI = process.env.BILLIE_TX_MAX_FEE_GWEI ?? "0.1";
const TX_PRIORITY_FEE_GWEI = process.env.BILLIE_TX_PRIORITY_FEE_GWEI ?? "0.05";

function parseArgs(argv: string[]): {
  domain: string;
  label: string;
  amount: string;
  currency: string;
} {
  // pnpm forwards a literal "--" when invoked as `pnpm agent:invoice -- …`
  const args = argv.slice(2).filter((a) => a !== "--");
  const [domain, label, amount, currency] = args;
  if (!domain || !label || !amount || !currency) {
    throw new Error(
      "Usage: pnpm agent:invoice -- <domain.eth> <label> <amount> <currency>",
    );
  }
  return { domain, label, amount, currency };
}

async function main() {
  const privateKey = process.env.AGENT_PRIVATE_KEY as `0x${string}` | undefined;
  if (!privateKey) {
    console.error("Set AGENT_PRIVATE_KEY in .env");
    process.exit(1);
  }

  let parsed;
  try {
    parsed = parseArgs(process.argv);
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  }

  const { domain, label, amount, currency } = parsed;
  const account = privateKeyToAccount(privateKey);
  console.log(`Agent address: ${account.address}`);
  console.log(`Root domain: ${domain}`);

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
    body: JSON.stringify({ domain, label, amount, currency }),
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

  const rpc = process.env.ETHEREUM_SEPOLIA_RPC_URL;
  const wallet = createWalletClient({
    account,
    chain: sepolia,
    transport: http(rpc),
  });

  let signedTx: Hex;
  if (SKIP_GAS_ESTIMATE) {
    const publicClient = createPublicClient({
      chain: sepolia,
      transport: http(rpc),
    });
    const nonce = await publicClient.getTransactionCount({
      address: account.address,
    });
    console.log(
      `\nSigning without estimateGas (gas=${TX_GAS}, maxFee=${TX_MAX_FEE_GWEI} gwei, tip=${TX_PRIORITY_FEE_GWEI} gwei, nonce=${nonce})...`,
    );
    signedTx = await wallet.signTransaction({
      type: "eip1559",
      chainId: sepolia.id,
      to: prepared.tx.to,
      data: prepared.tx.data,
      value: BigInt(prepared.tx.value ?? 0),
      nonce,
      gas: TX_GAS,
      maxFeePerGas: parseGwei(TX_MAX_FEE_GWEI),
      maxPriorityFeePerGas: parseGwei(TX_PRIORITY_FEE_GWEI),
    });
  } else {
    const request = await wallet.prepareTransactionRequest({
      to: prepared.tx.to,
      data: prepared.tx.data,
      value: BigInt(prepared.tx.value ?? 0),
    });
    signedTx = await wallet.signTransaction(request);
  }

  console.log("\nSubmitting signed tx...");
  const submitRes = await agentkit.fetch(`${API_URL}/api/invoices/submit`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      invoiceId: prepared.invoiceId,
      signedTx,
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
