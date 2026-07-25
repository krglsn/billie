import { createAgentkitClient } from "@worldcoin/agentkit";
import { privateKeyToAccount, type PrivateKeyAccount } from "viem/accounts";

export const API_URL = process.env.BILLIE_API_URL ?? "http://127.0.0.1:3000";
export const CHAIN_ID = process.env.AGENT_CHAIN_ID ?? "eip155:8453";
export const TIMEOUT_MS = Number(process.env.AGENT_TIMEOUT_MS ?? 60_000);

export function requirePrivateKey(): `0x${string}` {
  const key = process.env.AGENT_PRIVATE_KEY as `0x${string}` | undefined;
  if (!key) {
    console.error("Set AGENT_PRIVATE_KEY in .env");
    process.exit(1);
  }
  return key;
}

export function createAgent(account: PrivateKeyAccount) {
  return createAgentkitClient({
    signer: {
      address: account.address,
      chainId: CHAIN_ID,
      type: "eip191",
      signMessage: (message) => account.signMessage({ message }),
    },
    onEvent: (event) => console.log("  agentkit:", event.type),
  });
}

export function loadAccount(): PrivateKeyAccount {
  return privateKeyToAccount(requirePrivateKey());
}

export function positionalArgs(argv: string[]): string[] {
  return argv.slice(2).filter((a) => a !== "--");
}
