/**
 * Cancel a stuck pending Sepolia tx by replacing its nonce with a 0-ETH self-transfer.
 *
 * Usage:
 *   node --env-file=.env --import tsx scripts/cancel-pending-tx.ts [nonce]
 */
import {
  createPublicClient,
  createWalletClient,
  formatEther,
  http,
  parseGwei,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { sepolia } from "viem/chains";

const MAX_FEE_GWEI = process.env.CANCEL_MAX_FEE_GWEI ?? "60";
const TIP_GWEI = process.env.CANCEL_TIP_GWEI ?? "3";

async function main() {
  const privateKey = process.env.AGENT_PRIVATE_KEY as `0x${string}` | undefined;
  if (!privateKey) {
    console.error("Set AGENT_PRIVATE_KEY in .env");
    process.exit(1);
  }

  const account = privateKeyToAccount(privateKey);
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

  const [latest, pending, balance] = await Promise.all([
    publicClient.getTransactionCount({
      address: account.address,
      blockTag: "latest",
    }),
    publicClient.getTransactionCount({
      address: account.address,
      blockTag: "pending",
    }),
    publicClient.getBalance({ address: account.address }),
  ]);

  console.log({
    address: account.address,
    latestNonce: latest,
    pendingNonce: pending,
    balanceEth: formatEther(balance),
  });

  const nonceArg = process.argv[2];
  const nonce = nonceArg !== undefined ? Number(nonceArg) : latest;

  if (!Number.isInteger(nonce) || nonce < 0) {
    console.error("nonce must be a non-negative integer");
    process.exit(1);
  }

  if (pending <= latest && nonceArg === undefined) {
    console.log("No pending nonce gap — nothing to cancel.");
    process.exit(0);
  }

  const gas = 21_000n;
  const maxFeePerGas = parseGwei(MAX_FEE_GWEI);
  const maxPriorityFeePerGas = parseGwei(TIP_GWEI);
  const cost = gas * maxFeePerGas;
  console.log({
    replacingNonce: nonce,
    gas: gas.toString(),
    maxFeeGwei: MAX_FEE_GWEI,
    tipGwei: TIP_GWEI,
    costEth: formatEther(cost),
  });

  if (balance < cost) {
    console.error(`Need at least ${formatEther(cost)} ETH for cancel tx`);
    process.exit(1);
  }

  const hash = await wallet.sendTransaction({
    to: account.address,
    value: 0n,
    nonce,
    gas,
    maxFeePerGas,
    maxPriorityFeePerGas,
    type: "eip1559",
    chain: sepolia,
  });
  console.log("cancel tx hash:", hash);

  const receipt = await publicClient.waitForTransactionReceipt({
    hash,
    timeout: 120_000,
  });
  console.log({
    status: receipt.status,
    blockNumber: receipt.blockNumber.toString(),
  });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
