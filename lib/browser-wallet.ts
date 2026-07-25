/**
 * Browser wallet helpers for Billie Pay (injected ethereum + viem, no wagmi).
 */
"use client";

import {
  createPublicClient,
  createWalletClient,
  custom,
  type Address,
  type Hex,
  type WalletClient,
} from "viem";
import { sepolia } from "viem/chains";

type EthereumProvider = {
  request: (args: {
    method: string;
    params?: unknown[];
  }) => Promise<unknown>;
};

function getEthereum(): EthereumProvider {
  const eth = (
    globalThis as unknown as { ethereum?: EthereumProvider }
  ).ethereum;
  if (!eth) {
    throw new Error("No injected wallet found (install MetaMask or similar)");
  }
  return eth;
}

export async function connectWallet(): Promise<Address> {
  const eth = getEthereum();
  const accounts = (await eth.request({
    method: "eth_requestAccounts",
  })) as string[];
  const address = accounts[0];
  if (!address) throw new Error("No account returned from wallet");
  await ensureSepolia(eth);
  return address as Address;
}

async function ensureSepolia(eth: EthereumProvider): Promise<void> {
  const chainId = (await eth.request({ method: "eth_chainId" })) as string;
  if (chainId.toLowerCase() === "0xaa36a7") return; // Sepolia
  try {
    await eth.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: "0xaa36a7" }],
    });
  } catch (error) {
    const code =
      error && typeof error === "object" && "code" in error
        ? (error as { code: number }).code
        : null;
    if (code === 4902) {
      await eth.request({
        method: "wallet_addEthereumChain",
        params: [
          {
            chainId: "0xaa36a7",
            chainName: "Sepolia",
            nativeCurrency: { name: "Sepolia ETH", symbol: "ETH", decimals: 18 },
            rpcUrls: ["https://rpc.sepolia.org"],
            blockExplorerUrls: ["https://sepolia.etherscan.io"],
          },
        ],
      });
      return;
    }
    throw error;
  }
}

export function createBrowserClients(account: Address): {
  publicClient: ReturnType<typeof createPublicClient>;
  walletClient: WalletClient;
} {
  const eth = getEthereum();
  const transport = custom(eth);
  const publicClient = createPublicClient({
    chain: sepolia,
    transport,
  });
  const walletClient = createWalletClient({
    account,
    chain: sepolia,
    transport,
  });
  return { publicClient, walletClient };
}

export async function sendAndWait(input: {
  account: Address;
  to: Address;
  data: Hex;
}): Promise<Hex> {
  const { publicClient, walletClient } = createBrowserClients(input.account);
  const hash = await walletClient.sendTransaction({
    account: input.account,
    chain: sepolia,
    to: input.to,
    data: input.data,
    value: BigInt(0),
  });
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") {
    throw new Error(`Transaction reverted: ${hash}`);
  }
  return hash;
}
