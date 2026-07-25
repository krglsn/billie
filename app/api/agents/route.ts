import { NextResponse } from "next/server";
import { listLinkedDomains } from "@/lib/domains";

/**
 * Public: list linked agents + domains from the in-memory store.
 *
 * GET /api/agents
 */
export async function GET() {
  const byAgent = new Map<
    string,
    { agentAddress: string; humanId: string; domains: string[] }
  >();

  for (const d of listLinkedDomains()) {
    const existing = byAgent.get(d.agentAddress);
    if (existing) {
      existing.domains.push(d.name);
      continue;
    }
    byAgent.set(d.agentAddress, {
      agentAddress: d.agentAddress,
      humanId: d.humanId,
      domains: [d.name],
    });
  }

  return NextResponse.json({
    ok: true,
    agents: [...byAgent.values()],
  });
}
