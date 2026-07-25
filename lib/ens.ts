import {
  createPublicClient,
  http,
  namehash,
  zeroAddress,
  type Address,
  type PublicClient,
} from "viem";
import { normalize } from "viem/ens";
import { sepolia } from "viem/chains";

/** ENS Registry (same address on mainnet and Sepolia). */
export const ENS_REGISTRY_ADDRESS =
  "0x00000000000C2E074eC69A0dFb2997BA6C7d2e1e" as const;

/** Sepolia NameWrapper — registry owner is this address when the name is wrapped. */
export const NAME_WRAPPER_SEPOLIA =
  "0x0635513f179D50A207757E05759CbD106d7dFcE8" as const;

const ensRegistryAbi = [
  {
    type: "function",
    name: "owner",
    stateMutability: "view",
    inputs: [{ name: "node", type: "bytes32" }],
    outputs: [{ name: "", type: "address" }],
  },
] as const;

const nameWrapperAbi = [
  {
    type: "function",
    name: "ownerOf",
    stateMutability: "view",
    inputs: [{ name: "id", type: "uint256" }],
    outputs: [{ name: "owner", type: "address" }],
  },
] as const;

export type EnsOwnershipResult =
  | {
      ok: true;
      name: string;
      owner: Address;
      registryOwner: Address;
      wrapped: boolean;
      chainId: "eip155:11155111";
    }
  | {
      ok: false;
      name: string;
      reason: "not_registered" | "owner_mismatch" | "lookup_failed";
      owner?: Address;
      detail?: string;
    };

let cachedClient: PublicClient | undefined;

function getSepoliaClient(): PublicClient {
  if (cachedClient) return cachedClient;
  cachedClient = createPublicClient({
    chain: sepolia,
    transport: http(process.env.ETHEREUM_SEPOLIA_RPC_URL),
  });
  return cachedClient;
}

/**
 * Resolve the effective ENS owner on Ethereum Sepolia.
 * If the registry owner is the NameWrapper, unwrap via ownerOf(node).
 */
export async function getEnsOwnerOnSepolia(name: string): Promise<{
  owner: Address | null;
  registryOwner: Address;
  wrapped: boolean;
}> {
  const client = getSepoliaClient();
  const normalized = normalize(name);
  const node = namehash(normalized);

  const registryOwner = await client.readContract({
    address: ENS_REGISTRY_ADDRESS,
    abi: ensRegistryAbi,
    functionName: "owner",
    args: [node],
  });

  if (registryOwner === zeroAddress) {
    return { owner: null, registryOwner, wrapped: false };
  }

  if (registryOwner.toLowerCase() === NAME_WRAPPER_SEPOLIA.toLowerCase()) {
    const wrappedOwner = await client.readContract({
      address: NAME_WRAPPER_SEPOLIA,
      abi: nameWrapperAbi,
      functionName: "ownerOf",
      args: [BigInt(node)],
    });
    return {
      owner: wrappedOwner,
      registryOwner,
      wrapped: true,
    };
  }

  return { owner: registryOwner, registryOwner, wrapped: false };
}

/**
 * Verify that `agentAddress` owns `name` on Ethereum Sepolia ENS.
 */
export async function verifyAgentOwnsDomain(
  name: string,
  agentAddress: string,
): Promise<EnsOwnershipResult> {
  try {
    const { owner, registryOwner, wrapped } = await getEnsOwnerOnSepolia(name);

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
      registryOwner,
      wrapped,
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
