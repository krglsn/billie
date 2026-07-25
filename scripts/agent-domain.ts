/**
 * Smoke-test POST /api/domains (claim / link ENS ownership).
 *
 * Register the .eth name on Ethereum Sepolia with the agent wallet first, then:
 *   AGENT_PRIVATE_KEY=0x... pnpm agent:domain -- billie
 *   AGENT_PRIVATE_KEY=0x... pnpm agent:domain -- billie.eth
 */
import { createAgentkitClient } from "@worldcoin/agentkit";
import { privateKeyToAccount } from "viem/accounts";

const API_URL = process.env.BILLIE_API_URL ?? "http://127.0.0.1:3000";
const CHAIN_ID = process.env.AGENT_CHAIN_ID ?? "eip155:8453";
const TIMEOUT_MS = Number(process.env.AGENT_TIMEOUT_MS ?? 60_000);

async function main() {
  const privateKey = process.env.AGENT_PRIVATE_KEY as `0x${string}` | undefined;
  if (!privateKey) {
    console.error("Set AGENT_PRIVATE_KEY (register with AgentKit CLI first).");
    console.error("Example: AGENT_PRIVATE_KEY=0x... pnpm agent:domain -- billie");
    process.exit(1);
  }

  const name = process.argv[2];
  if (!name) {
    console.error("Usage: pnpm agent:domain -- <name>");
    process.exit(1);
  }

  const account = privateKeyToAccount(privateKey);
  console.log(`Agent address: ${account.address}`);
  console.log(`Claiming domain link for: ${name}`);

  const agentkit = createAgentkitClient({
    signer: {
      address: account.address,
      chainId: CHAIN_ID,
      type: "eip191",
      signMessage: (message) => account.signMessage({ message }),
    },
    onEvent: (event) => console.log("  agentkit:", event.type),
  });

  const response = await agentkit.fetch(`${API_URL}/api/domains`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const body = await response.json().catch(() => null);

  console.log(`Status: ${response.status}`);
  console.log(JSON.stringify(body, null, 2));

  process.exit(response.ok ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
