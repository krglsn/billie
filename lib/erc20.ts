/**
 * ERC-20 metadata reads + human-readable amount formatting.
 */
import { formatUnits, getAddress, isAddress, type Address } from "viem";
import { createSepoliaPublicClient } from "@/lib/ens";

export const erc20MetadataAbi = [
  {
    type: "function",
    name: "decimals",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint8" }],
  },
  {
    type: "function",
    name: "symbol",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "string" }],
  },
  {
    type: "function",
    name: "name",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "string" }],
  },
] as const;

export type Erc20TokenMeta = {
  address: Address;
  name: string;
  symbol: string;
  decimals: number;
};

export async function readErc20TokenMeta(
  token: string,
): Promise<Erc20TokenMeta | null> {
  if (!isAddress(token)) return null;
  const address = getAddress(token);
  const client = createSepoliaPublicClient();
  try {
    const [name, symbol, decimals] = await Promise.all([
      client.readContract({
        address,
        abi: erc20MetadataAbi,
        functionName: "name",
      }),
      client.readContract({
        address,
        abi: erc20MetadataAbi,
        functionName: "symbol",
      }),
      client.readContract({
        address,
        abi: erc20MetadataAbi,
        functionName: "decimals",
      }),
    ]);
    return {
      address,
      name,
      symbol,
      decimals: Number(decimals),
    };
  } catch {
    return null;
  }
}

/** Format atomic amount with token decimals (trim trailing zeros). */
export function formatAtomicAmount(
  amountAtomic: string,
  decimals: number,
): string {
  if (!/^\d+$/.test(amountAtomic)) return amountAtomic;
  const raw = formatUnits(BigInt(amountAtomic), decimals);
  if (!raw.includes(".")) return raw;
  return raw.replace(/\.?0+$/, "");
}

export function formatCurrencyDisplay(meta: Erc20TokenMeta): string {
  if (meta.name && meta.symbol && meta.name !== meta.symbol) {
    return `${meta.name} (${meta.symbol})`;
  }
  return meta.symbol || meta.name || meta.address;
}
