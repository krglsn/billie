/**
 * Ops: attach an ENSv2 UserRegistry under BILLIE_PARENT_NAME.
 *
 * Prerequisites:
 *   - BILLIE_PARENT_NAME registered on Sepolia ENSv2 to BILLIE_PRIVATE_KEY
 *   - Billie has ROLE_SET_SUBREGISTRY on that name (usual after app.ens.dev registration)
 *
 * Flow (idempotent — safe to re-run after a partial failure):
 *   1. Deploy UserRegistry proxy via VerifiableFactory (or reuse prior CREATE2 deploy)
 *   2. setParent(ETHRegistry, label) when not already set
 *   3. ETHRegistry.setSubregistry(tokenId, userRegistry) when not attached
 *
 *   pnpm ops:parent-registry
 *   pnpm ops:parent-registry -- --dry-run
 */
import { type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { checkBillieParentStatus } from "@/lib/billie-parent";
import { getEthRegistryAddress } from "@/lib/ens";
import {
  createBillieSepoliaClients,
  deployUserRegistry,
  findDeployedUserRegistry,
  grantRootRoles,
  userRegistryWriteAbi,
  waitSuccess,
  writeContractBuffered,
} from "@/lib/ens-registry-write";
import {
  BILLIE_PARENT_REGISTRY_ROLES,
  ROLE_REGISTRAR,
} from "@/lib/ens-roles";

const DRY_RUN = process.argv.includes("--dry-run");

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

function parentRegistrySaltKey(label: string): string {
  return `billie:parent-registry:v1:${label}`;
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
  console.log(
    JSON.stringify(status, (_, v) => (typeof v === "bigint" ? v.toString() : v), 2),
  );

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

  const clients = createBillieSepoliaClients();
  const ethRegistry = getEthRegistryAddress();
  const label = status.label;
  const tokenId = BigInt(status.tokenId!);
  const saltKey = parentRegistrySaltKey(label);

  let userRegistry = status.subregistry as Address | null;

  if (!userRegistry) {
    if (!status.checks.find((c) => c.id === "billie_can_set_subregistry")?.ok) {
      console.error(
        "Billie lacks ROLE_SET_SUBREGISTRY on the parent name — cannot attach a UserRegistry.",
      );
      process.exit(1);
    }

    if (DRY_RUN) {
      console.log("dry-run: skip deployProxy / setParent / setSubregistry");
      process.exit(0);
    }

    console.log("\n1) deployProxy UserRegistry (or reuse prior deploy)");
    const prior = await findDeployedUserRegistry({
      publicClient: clients.publicClient,
      deployer: account.address,
      saltKey,
    });

    let deployTx: Hex | undefined;
    if (prior) {
      userRegistry = prior;
      console.log("  reusing existing UserRegistry:", userRegistry);
    } else {
      const deployed = await deployUserRegistry({
        clients,
        admin: account.address,
        adminRoles: BILLIE_PARENT_REGISTRY_ROLES,
        saltKey,
      });
      userRegistry = deployed.userRegistry;
      deployTx = deployed.deployTx;
      if (deployTx === "0x") {
        console.log("  reusing existing UserRegistry:", userRegistry);
      } else {
        console.log("  tx:", deployTx);
        console.log("  UserRegistry:", userRegistry);
      }
    }

    console.log("\n2) setParent(ETHRegistry, label)");
    const [parentAddr, parentLabel] = (await clients.publicClient.readContract({
      address: userRegistry,
      abi: userRegistryWriteAbi,
      functionName: "getParent",
    })) as [Address, string];

    if (
      parentAddr.toLowerCase() === ethRegistry.toLowerCase() &&
      parentLabel === label
    ) {
      console.log("  already set — skip");
    } else {
      const parentHash = await writeContractBuffered(clients, {
        address: userRegistry,
        abi: userRegistryWriteAbi,
        functionName: "setParent",
        args: [ethRegistry, label],
      });
      console.log("  tx:", parentHash);
      await waitSuccess(clients.publicClient, parentHash, "setParent");
    }

    console.log("\n3) ETHRegistry.setSubregistry(tokenId, userRegistry)");
    const attachHash = await writeContractBuffered(clients, {
      address: ethRegistry,
      abi: ethRegistryWriteAbi,
      functionName: "setSubregistry",
      args: [tokenId, userRegistry],
    });
    console.log("  tx:", attachHash);
    await waitSuccess(clients.publicClient, attachHash, "setSubregistry");
  } else {
    console.log("Subregistry already attached:", userRegistry);
    const isRegistrar = status.checks.find(
      (c) => c.id === "billie_is_registrar",
    )?.ok;
    if (!isRegistrar) {
      console.log("\nGranting ROLE_REGISTRAR to Billie on existing UserRegistry…");
      if (DRY_RUN) {
        console.log("dry-run: skip grantRootRoles");
        process.exit(0);
      }
      const grantHash = await grantRootRoles({
        clients,
        registry: userRegistry,
        roleBitmap: ROLE_REGISTRAR,
        account: account.address,
      });
      console.log("  tx:", grantHash);
    }
  }

  const after = await checkBillieParentStatus();
  console.log("\nBillie parent status (after):");
  console.log(JSON.stringify(after, null, 2));

  if (!after.canProvisionAgents) {
    console.error(
      "Setup finished but canProvisionAgents is still false — check subregistry / registrar roles.",
    );
    process.exit(1);
  }

  if (!after.ok) {
    console.log(
      "Parent registry ready for agent namespaces. Invoice resolver still missing — run pnpm ops:invoice-resolver next.",
    );
    process.exit(0);
  }

  console.log("\nOK — parent UserRegistry ready. GET /api/health should return 200.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
