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
 * ENSv2 Sepolia deployment used by app.ens.dev (ETHRegistry 0xdedb…).
 * A newer 20260630 deploy (0x67b7…) exists but names registered via the
 * current dashboard live on this older pair — override via env if needed.
 * @see ensjs feature/fet-1885-ensjs-refactor packages/ensjs/src/clients/l1.ts
 */
export const ENS_V2_ETH_REGISTRY_SEPOLIA =
  "0xdedb92913a25abe1f7bcdd85d8a344a43b398b67" as const;
export const ENS_V2_VERIFIABLE_FACTORY_SEPOLIA =
  "0xD2a632D8a8b67c2c4398c255CbD7aF8dd7236198" as const;
export const ENS_V2_USER_REGISTRY_IMPL_SEPOLIA =
  "0x0F99e7Ea74903AfCB7224d0354fD7428A6f92917" as const;

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
          { name: "latestOwner", type: "address" },
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
  {
    type: "function",
    name: "getSubregistry",
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

export function getEthRegistryAddress(): `0x${string}` {
  return (process.env.ETHEREUM_SEPOLIA_ENS_V2_REGISTRY ??
    ENS_V2_ETH_REGISTRY_SEPOLIA) as `0x${string}`;
}

export function getVerifiableFactoryAddress(): `0x${string}` {
  return (process.env.ETHEREUM_SEPOLIA_ENS_V2_FACTORY ??
    ENS_V2_VERIFIABLE_FACTORY_SEPOLIA) as `0x${string}`;
}

export function getUserRegistryImplAddress(): `0x${string}` {
  return (process.env.ETHEREUM_SEPOLIA_ENS_V2_USER_REGISTRY_IMPL ??
    ENS_V2_USER_REGISTRY_IMPL_SEPOLIA) as `0x${string}`;
}

export function createSepoliaPublicClient() {
  return getSepoliaClient();
}

/** ENSv2 subregistry for a 2LD label, if configured. */
export async function getEthSubregistry(
  rootLabel: string,
): Promise<Address | null> {
  const client = getSepoliaClient();
  const subregistry = await client.readContract({
    address: getEthRegistryAddress(),
    abi: ensV2RegistryAbi,
    functionName: "getSubregistry",
    args: [rootLabel],
  });
  return subregistry === zeroAddress ? null : subregistry;
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
  resource: bigint;
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

  if (state.status !== Status.REGISTERED || state.latestOwner === zeroAddress) {
    return {
      owner: null,
      tokenId: state.tokenId,
      resource: state.resource,
      expiry: state.expiry,
      status: state.status,
      resolver,
    };
  }

  return {
    owner: state.latestOwner,
    tokenId: state.tokenId,
    resource: state.resource,
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
