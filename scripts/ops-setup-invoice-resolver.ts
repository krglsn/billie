/**
 * Ops: deploy Billie's shared PermissionedResolver for invoice text records.
 *
 *   pnpm ops:invoice-resolver
 *
 * Then put the printed address in .env:
 *   BILLIE_INVOICE_RESOLVER=0x...
 */
import {
  encodeFunctionData,
  keccak256,
  parseEventLogs,
  stringToHex,
  type Address,
} from "viem";
import {
  getBillieInvoiceResolverAddress,
  getPermissionedResolverImplAddress,
  getVerifiableFactoryAddress,
} from "@/lib/ens";
import {
  createBillieSepoliaClients,
  verifiableFactoryAbi,
  writeContractBuffered,
} from "@/lib/ens-registry-write";
import { BILLIE_INVOICE_RESOLVER_ROLES } from "@/lib/ens-roles";

const DRY_RUN = process.argv.includes("--dry-run");

const permissionedResolverInitAbi = [
  {
    type: "function",
    name: "initialize",
    stateMutability: "nonpayable",
    inputs: [
      { name: "admin", type: "address" },
      { name: "roleBitmap", type: "uint256" },
    ],
    outputs: [],
  },
] as const;

async function main() {
  const existing = getBillieInvoiceResolverAddress();
  if (existing) {
    console.log("BILLIE_INVOICE_RESOLVER already set:", existing);
    console.log("Unset it to deploy a new resolver.");
    process.exit(0);
  }

  const clients = createBillieSepoliaClients();
  const { account, publicClient } = clients;
  const factory = getVerifiableFactoryAddress();
  const impl = getPermissionedResolverImplAddress();
  const saltKey = `billie:invoice-resolver:v1:${account.address.toLowerCase()}`;
  const salt = BigInt(keccak256(stringToHex(saltKey)));
  const initData = encodeFunctionData({
    abi: permissionedResolverInitAbi,
    functionName: "initialize",
    args: [account.address, BILLIE_INVOICE_RESOLVER_ROLES],
  });

  console.log({
    admin: account.address,
    factory,
    impl,
    salt: salt.toString(),
  });

  if (DRY_RUN) {
    console.log("dry-run: skip deployProxy");
    process.exit(0);
  }

  // Public RPCs under-estimate deployProxy+initialize (~178k) → OOG; buffer like parent registry.
  const deployHash = await writeContractBuffered(clients, {
    address: factory,
    abi: verifiableFactoryAbi,
    functionName: "deployProxy",
    args: [impl, salt, initData],
  });
  console.log("deployProxy tx:", deployHash);
  const receipt = await publicClient.waitForTransactionReceipt({
    hash: deployHash,
  });
  if (receipt.status !== "success") {
    console.error(
      `deployProxy reverted (gasUsed=${receipt.gasUsed}). Check https://sepolia.etherscan.io/tx/${deployHash}`,
    );
    process.exit(1);
  }

  const deployed = parseEventLogs({
    abi: verifiableFactoryAbi,
    eventName: "ProxyDeployed",
    logs: receipt.logs,
  });
  const resolver = deployed[0]?.args.proxyAddress as Address | undefined;
  if (!resolver) {
    console.error("ProxyDeployed event missing");
    process.exit(1);
  }

  console.log("\nOK — PermissionedResolver deployed:");
  console.log(resolver);
  console.log("\nAdd to .env:");
  console.log(`BILLIE_INVOICE_RESOLVER=${resolver}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
