/**
 * Probe GET /api/me with AgentKit auth.
 *
 *   npm run me
 */
import { API_URL, TIMEOUT_MS, createAgent, loadAccount } from "./client.ts";

async function main() {
  const account = loadAccount();
  console.log(`Agent address: ${account.address}`);
  console.log(`Calling ${API_URL}/api/me ...`);

  const agentkit = createAgent(account);
  const response = await agentkit.fetch(`${API_URL}/api/me`, {
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
