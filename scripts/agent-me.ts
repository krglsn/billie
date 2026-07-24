/**
 * Smoke-test AgentKit auth against GET /api/me.
 *
 * 1. Start the API:  pnpm dev --hostname 127.0.0.1 --port 3000
 * 2. Register once:  npx @worldcoin/agentkit-cli register <address>
 * 3. Run:            AGENT_PRIVATE_KEY=0x... pnpm agent:me
 *
 * Use 127.0.0.1 (not localhost) — the dev server binds IPv4 only, and
 * macOS often resolves localhost to ::1 which hangs.
 */
import { createAgentkitClient } from "@worldcoin/agentkit";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

const API_URL = process.env.BILLIE_API_URL ?? "http://127.0.0.1:3000";
const CHAIN_ID = process.env.AGENT_CHAIN_ID ?? "eip155:8453"; // Base — AgentBook lookup is still on World Chain
const TIMEOUT_MS = Number(process.env.AGENT_TIMEOUT_MS ?? 30_000);

async function main() {
  const privateKey = (process.env.AGENT_PRIVATE_KEY ?? generatePrivateKey()) as `0x${string}`;
  const account = privateKeyToAccount(privateKey);

  if (!process.env.AGENT_PRIVATE_KEY) {
    console.log("No AGENT_PRIVATE_KEY set — generated a throwaway wallet:");
    console.log(`  address:     ${account.address}`);
    console.log(`  privateKey:  ${privateKey}`);
    console.log();
    console.log("Register it, then re-run with AGENT_PRIVATE_KEY:");
    console.log(`  npx @worldcoin/agentkit-cli register ${account.address}`);
    console.log(`  AGENT_PRIVATE_KEY=${privateKey} pnpm agent:me`);
    process.exit(0);
  }

  console.log(`Agent address: ${account.address}`);
  console.log(`Calling ${API_URL}/api/me ...`);

  const agentkit = createAgentkitClient({
    signer: {
      address: account.address,
      chainId: CHAIN_ID,
      type: "eip191",
      signMessage: (message) => account.signMessage({ message }),
    },
    onEvent: (event) => console.log("  agentkit:", event.type),
  });

  const response = await agentkit.fetch(`${API_URL}/api/me`, {
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const body = await response.json().catch(() => null);

  console.log(`Status: ${response.status}`);
  console.log(JSON.stringify(body, null, 2));

  if (response.ok && body?.humanId) {
    console.log("\nOK — agent authorized as human-backed.");
    process.exit(0);
  }

  console.error("\nFailed — register the wallet in AgentBook if needed:");
  console.error(`  npx @worldcoin/agentkit-cli register ${account.address}`);
  console.error(`  npx @worldcoin/agentkit-cli status ${account.address}`);
  process.exit(1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
