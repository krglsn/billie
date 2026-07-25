/**
 * Ops: attach an ENSv2 UserRegistry under BILLIE_PARENT_NAME.
 *
 * Prerequisites:
 *   - BILLIE_PARENT_NAME registered on Sepolia ENSv2 to BILLIE_PRIVATE_KEY
 *   - Billie has ROLE_SET_SUBREGISTRY on that name (usual after app.ens.dev registration)
 *
 * Flow:
 *   1. Deploy UserRegistry proxy via VerifiableFactory (Billie = ROLE_REGISTRAR|…)
 *   2. setParent(ETHRegistry, label) on the new registry
 *   3. ETHRegistry.setSubregistry(tokenId, userRegistry)
 *
 *   pnpm ops:parent-registry
 *   pnpm ops:parent-registry -- --dry-run
 */
import {
  createPublicClient,
  createWalletClient,
  encodeFunctionData,
  http,
  keccak256,
  parseEventLogs,
  stringToHex,
  type Address,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { sepolia } from "viem/chains";
import { checkBillieParentStatus } from "@/lib/billie-parent";
import {
  getEthRegistryAddress,
  getUserRegistryImplAddress,
  getVerifiableFactoryAddress,
} from "@/lib/ens";
import {
  BILLIE_PARENT_REGISTRY_ROLES,
  ROLE_REGISTRAR,
} from "@/lib/ens-roles";

const DRY_RUN = process.argv.includes("--dry-run");

const verifiableFactoryAbi = [
  {
    type: "function",
    name: "deployProxy",
    stateMutability: "nonpayable",
    inputs: [
      { name: "implementation", type: "address" },
      { name: "salt", type: "uint256" },
      { name: "data", type: "bytes" },
    ],
    outputs: [{ name: "proxy", type: "address" }],
  },
  {
    type: "event",
    name: "ProxyDeployed",
    inputs: [
      { name: "sender", type: "address", indexed: true },
      { name: "proxyAddress", type: "address", indexed: true },
      { name: "salt", type: "uint256", indexed: false },
      { name: "implementation", type: "address", indexed: false },
    ],
  },
] as const;

const userRegistryAbi = [
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
  {
    type: "function",
    name: "setParent",
    stateMutability: "nonpayable",
    inputs: [
      { name: "parent", type: "address" },
      { name: "label", type: "string" },
    ],
    outputs: [],
  },
] as const;

const ethRegistryWriteAbi = [
  {
    type: "function",
    name: "setSubregistry",
    stateMutability: "nonpayable",
    inputs: [
      { name: "anyId", type: "uint256" },
      { name: "registry", type: "address" },
    ],
    outputs: [],
  },
] as const;

const grantRootRolesAbi = [
  {
    type: "function",
    name: "grantRootRoles",
    stateMutability: "nonpayable",
    inputs: [
      { name: "roleBitmap", type: "uint256" },
      { name: "account", type: "address" },
    ],
    outputs: [{ type: "bool" }],
  },
] as const;

function parentRegistrySalt(label: string): bigint {
  return BigInt(keccak256(stringToHex(`billie:parent-registry:v1:${label}`)));
}

async function main() {
  const key = process.env.BILLIE_PRIVATE_KEY as `0x${string}` | undefined;
  if (!key) {
    console.error("Set BILLIE_PRIVATE_KEY in .env");
    process.exit(1);
  }

  const account = privateKeyToAccount(key);
  const status = await checkBillieParentStatus();

  console.log("Billie parent status (before):");
  console.log(JSON.stringify(status, (_, v) => (typeof v === "bigint" ? v.toString() : v), 2));

  if (!status.name || !status.label || !status.billieAddress) {
    console.error("Configure BILLIE_PARENT_NAME and BILLIE_PRIVATE_KEY first.");
    process.exit(1);
  }

  if (!status.checks.find((c) => c.id === "name_registered")?.ok) {
    console.error(
      `Register ${status.name} on app.ens.dev to ${account.address} first.`,
    );
    process.exit(1);
  }

  if (!status.checks.find((c) => c.id === "owner_matches_billie")?.ok) {
    console.error("On-chain owner must match BILLIE_PRIVATE_KEY.");
    process.exit(1);
  }

  if (status.ok) {
    console.log("Already ready — nothing to do.");
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

  const ethRegistry = getEthRegistryAddress();
  const factory = getVerifiableFactoryAddress();
  const impl = getUserRegistryImplAddress();
  const label = status.label;
  const tokenId = BigInt(status.tokenId!);

  let userRegistry = status.subregistry as Address | null;

  if (!userRegistry) {
    if (!status.checks.find((c) => c.id === "billie_can_set_subregistry")?.ok) {
      console.error(
        "Billie lacks ROLE_SET_SUBREGISTRY on the parent name — cannot attach a UserRegistry.",
      );
      process.exit(1);
    }

    const salt = parentRegistrySalt(label);
    const initData = encodeFunctionData({
      abi: userRegistryAbi,
      functionName: "initialize",
      args: [account.address, BILLIE_PARENT_REGISTRY_ROLES],
    });

    console.log("\n1) deployProxy UserRegistry");
    console.log({ factory, impl, salt: salt.toString(), admin: account.address });

    if (DRY_RUN) {
      console.log("dry-run: skip deployProxy / setParent / setSubregistry");
      process.exit(0);
    }

    const deployHash = await wallet.writeContract({
      address: factory,
      abi: verifiableFactoryAbi,
      functionName: "deployProxy",
      args: [impl, salt, initData],
    });
    console.log("  tx:", deployHash);
    const deployReceipt = await publicClient.waitForTransactionReceipt({
      hash: deployHash,
    });
    if (deployReceipt.status !== "success") {
      console.error("deployProxy reverted");
      process.exit(1);
    }

    const deployed = parseEventLogs({
      abi: verifiableFactoryAbi,
      eventName: "ProxyDeployed",
      logs: deployReceipt.logs,
    });
    if (!deployed[0]) {
      console.error("ProxyDeployed event not found in receipt");
      process.exit(1);
    }
    userRegistry = deployed[0].args.proxyAddress as Address;
    console.log("  UserRegistry:", userRegistry);

    console.log("\n2) setParent(ETHRegistry, label)");
    const parentHash = await wallet.writeContract({
      address: userRegistry,
      abi: userRegistryAbi,
      functionName: "setParent",
      args: [ethRegistry, label],
    });
    console.log("  tx:", parentHash);
    const parentReceipt = await publicClient.waitForTransactionReceipt({
      hash: parentHash,
    });
    if (parentReceipt.status !== "success") {
      console.error("setParent reverted");
      process.exit(1);
    }

    console.log("\n3) ETHRegistry.setSubregistry(tokenId, userRegistry)");
    const attachHash = await wallet.writeContract({
      address: ethRegistry,
      abi: ethRegistryWriteAbi,
      functionName: "setSubregistry",
      args: [tokenId, userRegistry],
    });
    console.log("  tx:", attachHash);
    const attachReceipt = await publicClient.waitForTransactionReceipt({
      hash: attachHash,
    });
    if (attachReceipt.status !== "success") {
      console.error("setSubregistry reverted");
      process.exit(1);
    }
  } else {
    console.log("Subregistry already attached:", userRegistry);
    const isRegistrar = status.checks.find((c) => c.id === "billie_is_registrar")?.ok;
    if (!isRegistrar) {
      console.log("\nGranting ROLE_REGISTRAR to Billie on existing UserRegistry…");
      if (DRY_RUN) {
        console.log("dry-run: skip grantRootRoles");
        process.exit(0);
      }
      const grantHash = await wallet.writeContract({
        address: userRegistry,
        abi: grantRootRolesAbi,
        functionName: "grantRootRoles",
        args: [ROLE_REGISTRAR, account.address],
      });
      console.log("  tx:", grantHash);
      const grantReceipt = await publicClient.waitForTransactionReceipt({
        hash: grantHash,
      });
      if (grantReceipt.status !== "success") {
        console.error(
          "grantRootRoles reverted — Billie may lack ROLE_REGISTRAR_ADMIN on this registry",
        );
        process.exit(1);
      }
    }
  }

  const after = await checkBillieParentStatus();
  console.log("\nBillie parent status (after):");
  console.log(JSON.stringify(after, null, 2));

  if (!after.ok) {
    console.error("Setup finished but health checks still failing.");
    process.exit(1);
  }

  console.log("\nOK — parent UserRegistry ready. GET /api/health should return 200.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
