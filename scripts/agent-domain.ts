/**
 * Smoke-test POST /api/domains (provision agent namespace under BILLIE_PARENT_NAME).
 *
 * Parent UserRegistry must already be ready (GET /api/health ok:true).
 *
 *   pnpm agent:domain -- alice
 *   pnpm agent:domain -- alice.agentinvoice.eth
 *
 * Billie (BILLIE_PRIVATE_KEY) pays gas to deploy the agent UserRegistry and
 * register `{label}.{parent}.eth`. Agent only needs AgentKit auth.
 */
import { createAgentkitClient } from "@worldcoin/agentkit";
import { privateKeyToAccount } from "viem/accounts";

const API_URL = process.env.BILLIE_API_URL ?? "http://127.0.0.1:3000";
const CHAIN_ID = process.env.AGENT_CHAIN_ID ?? "eip155:8453";
const TIMEOUT_MS = Number(process.env.AGENT_TIMEOUT_MS ?? 180_000);

async function main() {
  const privateKey = process.env.AGENT_PRIVATE_KEY as `0x${string}` | undefined;
  if (!privateKey) {
    console.error("Set AGENT_PRIVATE_KEY (register with AgentKit CLI first).");
    console.error("Example: AGENT_PRIVATE_KEY=0x... pnpm agent:domain -- alice");
    process.exit(1);
  }

  const args = process.argv.slice(2).filter((a) => a !== "--");
  const name = args[0];
  if (!name) {
    console.error("Usage: pnpm agent:domain -- <label|label.parent.eth>");
    process.exit(1);
  }

  const account = privateKeyToAccount(privateKey);
  console.log(`Agent address: ${account.address}`);
  console.log(`Claiming namespace: ${name}`);
  console.log("(Billie will deploy UserRegistry + register on-chain — may take ~1–2 min)");

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
