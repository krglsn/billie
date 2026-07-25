/**
 * Ops: deploy Billie PaymentRouter on Ethereum Sepolia.
 *
 * Requires Foundry (`forge`) and BILLIE_INVOICE_RESOLVER in .env.
 *
 *   pnpm ops:payment-router
 *   pnpm ops:payment-router -- --dry-run
 *
 * Then put the printed address in .env:
 *   BILLIE_PAYMENT_ROUTER=0x...
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  createPublicClient,
  createWalletClient,
  http,
  type Address,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { sepolia } from "viem/chains";
import { getBillieInvoiceResolverAddress } from "@/lib/ens";
import {
  getBilliePaymentRouterAddress,
  paymentRouterAbi,
} from "@/lib/payment-router";

const DRY_RUN = process.argv.includes("--dry-run");
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

type ForgeArtifact = {
  abi: unknown;
  bytecode: { object: Hex };
};

function buildArtifact(): ForgeArtifact {
  execFileSync("forge", ["build", "--contracts", "contracts/PaymentRouter.sol"], {
    cwd: ROOT,
    stdio: "inherit",
  });
  const artifactPath = join(
    ROOT,
    "out",
    "PaymentRouter.sol",
    "PaymentRouter.json",
  );
  return JSON.parse(readFileSync(artifactPath, "utf8")) as ForgeArtifact;
}

async function main() {
  const existing = getBilliePaymentRouterAddress();
  if (existing) {
    console.log("BILLIE_PAYMENT_ROUTER already set:", existing);
    console.log("Unset it to deploy a new router.");
    process.exit(0);
  }

  const resolver = getBillieInvoiceResolverAddress();
  if (!resolver) {
    console.error(
      "Set BILLIE_INVOICE_RESOLVER in .env (pnpm ops:invoice-resolver first)",
    );
    process.exit(1);
  }

  const key = process.env.BILLIE_PRIVATE_KEY as `0x${string}` | undefined;
  if (!key) {
    console.error("Set BILLIE_PRIVATE_KEY in .env");
    process.exit(1);
  }

  const account = privateKeyToAccount(key);
  console.log({
    deployer: account.address,
    invoiceResolver: resolver,
    chain: "sepolia",
  });

  const artifact = buildArtifact();
  if (!artifact.bytecode?.object?.startsWith("0x")) {
    console.error("Forge artifact missing bytecode");
    process.exit(1);
  }

  if (DRY_RUN) {
    console.log("dry-run: skip deployContract");
    console.log("bytecode bytes:", (artifact.bytecode.object.length - 2) / 2);
    process.exit(0);
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

  const hash = await wallet.deployContract({
    abi: paymentRouterAbi,
    bytecode: artifact.bytecode.object,
    args: [resolver],
  });
  console.log("deploy tx:", hash);
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") {
    console.error("deploy reverted");
    process.exit(1);
  }

  const router = receipt.contractAddress as Address | null;
  if (!router) {
    console.error("No contractAddress on receipt");
    process.exit(1);
  }

  const onChainResolver = await publicClient.readContract({
    address: router,
    abi: paymentRouterAbi,
    functionName: "invoiceResolver",
  });

  console.log("\nOK — PaymentRouter deployed:");
  console.log(router);
  console.log("invoiceResolver:", onChainResolver);
  console.log("\nAdd to .env:");
  console.log(`BILLIE_PAYMENT_ROUTER=${router}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
