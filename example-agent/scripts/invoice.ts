/**
 * Prepare + sign + submit a USDC invoice under the agent namespace.
 *
 *   npm run invoice -- <namespace.eth> <label> <humanAmount>
 *   npm run invoice -- alice.parent.eth inv01 100
 *
 * Token/decimals come from tokens.ts (USDC only).
 */
import {
  createPublicClient,
  createWalletClient,
  http,
  parseGwei,
  parseUnits,
  type Hex,
} from "viem";
import { sepolia } from "viem/chains";
import {
  API_URL,
  TIMEOUT_MS,
  createAgent,
  loadAccount,
  positionalArgs,
} from "./client.ts";
import { TOKENS } from "./tokens.ts";

const SKIP_GAS_ESTIMATE = process.env.BILLIE_SKIP_GAS_ESTIMATE === "1";
const TX_GAS = BigInt(process.env.BILLIE_TX_GAS ?? "200000");
const TX_MAX_FEE_GWEI = process.env.BILLIE_TX_MAX_FEE_GWEI ?? "0.1";
const TX_PRIORITY_FEE_GWEI = process.env.BILLIE_TX_PRIORITY_FEE_GWEI ?? "0.05";

async function main() {
  const [domain, label, humanAmount] = positionalArgs(process.argv);
  if (!domain || !label || !humanAmount) {
    console.error(
      "Usage: npm run invoice -- <namespace.eth> <label> <humanAmount>",
    );
    process.exit(1);
  }

  const token = TOKENS.USDC;
  let amount: string;
  try {
    amount = parseUnits(humanAmount, token.decimals).toString();
  } catch {
    console.error(`Invalid amount: ${humanAmount}`);
    process.exit(1);
  }

  const account = loadAccount();
  console.log(`Agent address: ${account.address}`);
  console.log(
    `Invoice ${label} on ${domain}: ${humanAmount} ${token.symbol} (${amount} atomic, token=${token.address})`,
  );

  const agentkit = createAgent(account);
  const prepareRes = await agentkit.fetch(`${API_URL}/api/invoices`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      domain,
      label,
      amount,
      currency: token.symbol,
      token: token.address,
    }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const prepared = (await prepareRes.json().catch(() => null)) as {
    invoiceId?: string;
    tx?: { to: Hex; data: Hex; value?: string };
  } | null;
  console.log(`Prepare status: ${prepareRes.status}`);
  console.log(JSON.stringify(prepared, null, 2));
  if (!prepareRes.ok || !prepared?.invoiceId || !prepared.tx) {
    process.exit(1);
  }

  const rpc = process.env.ETHEREUM_SEPOLIA_RPC_URL;
  if (!rpc) {
    console.error("Set ETHEREUM_SEPOLIA_RPC_URL in .env to sign/submit");
    process.exit(1);
  }

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
      `\nSigning (fixed gas=${TX_GAS}, maxFee=${TX_MAX_FEE_GWEI} gwei, nonce=${nonce})...`,
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

  console.log("\nSubmitting signed register tx...");
  const submitRes = await agentkit.fetch(`${API_URL}/api/invoices/submit`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      invoiceId: prepared.invoiceId,
      signedTx,
    }),
    signal: AbortSignal.timeout(TIMEOUT_MS + 90_000),
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
