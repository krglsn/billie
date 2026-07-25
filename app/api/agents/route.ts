import { NextResponse } from "next/server";
import { listLinkedDomains } from "@/lib/domains";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Public: list linked agents + domains from SQLite.
 *
 * GET /api/agents
 */
export async function GET() {
  try {
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
  } catch (error) {
    return NextResponse.json(
      {
        error: "Failed to list agents",
        detail: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 },
    );
  }
}
