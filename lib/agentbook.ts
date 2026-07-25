import { createPublicClient, http, toHex, type Address } from "viem";
import { worldchain } from "viem/chains";

/** Canonical AgentBook on World Chain (eip155:480). */
export const AGENT_BOOK_ADDRESS =
  "0xA23aB2712eA7BBa896930544C7d6636a96b944dA" as const;

const agentBookAbi = [
  {
    type: "function",
    name: "lookupHuman",
    stateMutability: "view",
    inputs: [{ name: "agent", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
] as const;

export type AgentBookLookupResult =
  | { ok: true; humanId: string }
  | { ok: false; reason: "not_registered" }
  | { ok: false; reason: "lookup_failed"; detail: string };

function getWorldChainClient() {
  return createPublicClient({
    chain: worldchain,
    transport: http(process.env.WORLD_CHAIN_RPC_URL),
  });
}

/**
 * Resolve AgentBook humanId for an agent wallet.
 * Unlike `@worldcoin/agentkit`'s verifier, RPC failures are not silently
 * treated as "not registered".
 */
export async function lookupHumanId(
  agentAddress: string,
): Promise<AgentBookLookupResult> {
  try {
    const client = getWorldChainClient();
    const humanId = await client.readContract({
      address: AGENT_BOOK_ADDRESS,
      abi: agentBookAbi,
      functionName: "lookupHuman",
      args: [agentAddress as Address],
    });

    if (humanId === BigInt(0)) {
      return { ok: false, reason: "not_registered" };
    }

    return { ok: true, humanId: toHex(humanId) };
  } catch (error) {
    return {
      ok: false,
      reason: "lookup_failed",
      detail: error instanceof Error ? error.message : "Unknown RPC error",
    };
  }
}
