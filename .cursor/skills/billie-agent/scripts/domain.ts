/**
 * Claim an agent namespace under Billie's parent (POST /api/domains).
 *
 *   npm run domain -- alice
 */
import {
  API_URL,
  TIMEOUT_MS,
  createAgent,
  loadAccount,
  positionalArgs,
} from "./client.ts";

async function main() {
  const [name] = positionalArgs(process.argv);
  if (!name) {
    console.error("Usage: npm run domain -- <label|label.parent.eth>");
    process.exit(1);
  }

  const account = loadAccount();
  console.log(`Agent address: ${account.address}`);
  console.log(`Claiming namespace: ${name}`);

  const agentkit = createAgent(account);
  const response = await agentkit.fetch(`${API_URL}/api/domains`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name }),
    signal: AbortSignal.timeout(Math.max(TIMEOUT_MS, 180_000)),
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
