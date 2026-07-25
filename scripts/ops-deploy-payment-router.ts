/**
 * Ops: deploy Billie PaymentRouter on Ethereum Sepolia.
 *
 * Requires Foundry (`forge`) and BILLIE_INVOICE_RESOLVER in .env.
 *
 *   pnpm ops:payment-router
 *   pnpm ops:payment-router -- --dry-run
 *   pnpm ops:payment-router -- --verify-only   # verify existing BILLIE_PAYMENT_ROUTER
 *
 * After deploy, if ETHERSCAN_API_KEY is set, source is submitted to Sepolia Etherscan
 * so Contract / Read Contract / Write Contract show methods + Solidity.
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
  encodeAbiParameters,
  http,
  parseAbiParameters,
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
const VERIFY_ONLY = process.argv.includes("--verify-only");
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

function constructorArgsHex(resolver: Address): Hex {
  return encodeAbiParameters(parseAbiParameters("address"), [resolver]);
}

/** Submit source to Sepolia Etherscan via forge (needs ETHERSCAN_API_KEY). */
function verifyOnEtherscan(input: {
  router: Address;
  resolver: Address;
}): void {
  const apiKey = process.env.ETHERSCAN_API_KEY?.trim();
  if (!apiKey) {
    console.log(
      "\nSkip Etherscan verify — set ETHERSCAN_API_KEY to publish source/ABI.",
    );
    console.log(
      "Get a key at https://etherscan.io/apidashboard (works for Sepolia).",
    );
    console.log("Then re-run: pnpm ops:payment-router -- --verify-only");
    return;
  }

  const argsHex = constructorArgsHex(input.resolver);
  // Sepolia chain id — Etherscan deprecated V1; V2 uses a single host + chainid.
  const verifierUrl = "https://api.etherscan.io/v2/api?chainid=11155111";
  console.log("\nVerifying on Sepolia Etherscan (API V2)...");
  console.log({
    address: input.router,
    constructorArg: input.resolver,
    verifierUrl,
    explorer: `https://sepolia.etherscan.io/address/${input.router}#code`,
  });

  execFileSync(
    "forge",
    [
      "verify-contract",
      "--chain",
      "sepolia",
      "--verifier",
      "etherscan",
      "--verifier-url",
      verifierUrl,
      "--etherscan-api-key",
      apiKey,
      "--watch",
      "--constructor-args",
      argsHex,
      input.router,
      "contracts/PaymentRouter.sol:PaymentRouter",
    ],
    { cwd: ROOT, stdio: "inherit" },
  );

  console.log("\nVerified — open Contract tab:");
  console.log(`https://sepolia.etherscan.io/address/${input.router}#code`);
}

async function main() {
  const resolver = getBillieInvoiceResolverAddress();
  if (!resolver) {
    console.error(
      "Set BILLIE_INVOICE_RESOLVER in .env (pnpm ops:invoice-resolver first)",
    );
    process.exit(1);
  }

  if (VERIFY_ONLY) {
    const router = getBilliePaymentRouterAddress();
    if (!router) {
      console.error("Set BILLIE_PAYMENT_ROUTER in .env for --verify-only");
      process.exit(1);
    }
    buildArtifact();
    verifyOnEtherscan({ router, resolver });
    process.exit(0);
  }

  const existing = getBilliePaymentRouterAddress();
  if (existing) {
    console.log("BILLIE_PAYMENT_ROUTER already set:", existing);
    console.log("Unset it to deploy a new router.");
    console.log("Or verify existing: pnpm ops:payment-router -- --verify-only");
    process.exit(0);
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

  verifyOnEtherscan({ router, resolver });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
