import {
  createPublicClient,
  http,
  keccak256,
  stringToBytes,
  toHex,
  zeroAddress,
  type Address,
} from "viem";
import { normalize } from "viem/ens";
import { sepolia } from "viem/chains";

/**
 * ENSv2 ETHRegistry on Sepolia (app.ens.dev / Namechain test deployment).
 * Paired with ETHRegistrar 0x8c2E866B439358c41AE05De9cbE8A00BFEFafFcA.
 * Override with ETHEREUM_SEPOLIA_ENS_V2_REGISTRY if deployments move.
 */
export const ENS_V2_ETH_REGISTRY_SEPOLIA =
  "0xdedb92913a25abe1f7bcdd85d8a344a43b398b67" as const;

const Status = {
  AVAILABLE: 0,
  RESERVED: 1,
  REGISTERED: 2,
} as const;

const ensV2RegistryAbi = [
  {
    type: "function",
    name: "getState",
    stateMutability: "view",
    inputs: [{ name: "anyId", type: "uint256" }],
    outputs: [
      {
        type: "tuple",
        components: [
          { name: "status", type: "uint8" },
          { name: "expiry", type: "uint64" },
          { name: "owner", type: "address" },
          { name: "tokenId", type: "uint256" },
          { name: "resource", type: "uint256" },
        ],
      },
    ],
  },
  {
    type: "function",
    name: "getResolver",
    stateMutability: "view",
    inputs: [{ name: "label", type: "string" }],
    outputs: [{ type: "address" }],
  },
] as const;

export type EnsOwnershipResult =
  | {
      ok: true;
      name: string;
      owner: Address;
      tokenId: string;
      expiry: string;
      resolver: Address;
      protocol: "ensv2";
      chainId: "eip155:11155111";
    }
  | {
      ok: false;
      name: string;
      reason: "not_registered" | "owner_mismatch" | "lookup_failed";
      owner?: Address;
      detail?: string;
    };

function getSepoliaClient() {
  return createPublicClient({
    chain: sepolia,
    transport: http(process.env.ETHEREUM_SEPOLIA_RPC_URL),
  });
}

function getEthRegistryAddress(): `0x${string}` {
  return (process.env.ETHEREUM_SEPOLIA_ENS_V2_REGISTRY ??
    ENS_V2_ETH_REGISTRY_SEPOLIA) as `0x${string}`;
}

/** Extract the 2LD label from a normalized `foo.eth` name. */
export function ethLabelFromName(name: string): string {
  const normalized = normalize(name);
  if (!normalized.endsWith(".eth")) {
    throw new Error("Only .eth second-level names are supported");
  }
  const label = normalized.slice(0, -4);
  if (!label || label.includes(".")) {
    throw new Error("Only second-level .eth names are supported (e.g. billie.eth)");
  }
  return label;
}

export function labelHashOf(label: string): `0x${string}` {
  return keccak256(toHex(stringToBytes(label)));
}

/**
 * Resolve ENSv2 ownership for a Sepolia `.eth` name via ETHRegistry.getState.
 */
export async function getEnsV2OwnerOnSepolia(name: string): Promise<{
  owner: Address | null;
  tokenId: bigint;
  expiry: bigint;
  status: number;
  resolver: Address;
}> {
  const client = getSepoliaClient();
  const registry = getEthRegistryAddress();
  const label = ethLabelFromName(name);
  const labelHash = BigInt(labelHashOf(label));

  const [state, resolver] = await Promise.all([
    client.readContract({
      address: registry,
      abi: ensV2RegistryAbi,
      functionName: "getState",
      args: [labelHash],
    }),
    client.readContract({
      address: registry,
      abi: ensV2RegistryAbi,
      functionName: "getResolver",
      args: [label],
    }),
  ]);

  if (state.status !== Status.REGISTERED || state.owner === zeroAddress) {
    return {
      owner: null,
      tokenId: state.tokenId,
      expiry: state.expiry,
      status: state.status,
      resolver,
    };
  }

  return {
    owner: state.owner,
    tokenId: state.tokenId,
    expiry: state.expiry,
    status: state.status,
    resolver,
  };
}

/**
 * Verify that `agentAddress` owns `name` on Ethereum Sepolia ENSv2.
 */
export async function verifyAgentOwnsDomain(
  name: string,
  agentAddress: string,
): Promise<EnsOwnershipResult> {
  try {
    const { owner, tokenId, expiry, resolver } =
      await getEnsV2OwnerOnSepolia(name);

    if (!owner) {
      return { ok: false, name, reason: "not_registered" };
    }

    if (owner.toLowerCase() !== agentAddress.toLowerCase()) {
      return {
        ok: false,
        name,
        reason: "owner_mismatch",
        owner,
      };
    }

    return {
      ok: true,
      name,
      owner,
      tokenId: tokenId.toString(),
      expiry: expiry.toString(),
      resolver,
      protocol: "ensv2",
      chainId: "eip155:11155111",
    };
  } catch (error) {
    return {
      ok: false,
      name,
      reason: "lookup_failed",
      detail: error instanceof Error ? error.message : "Unknown RPC error",
    };
  }
}
