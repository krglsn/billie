import { NextResponse } from "next/server";
import { listLinkedDomains } from "@/lib/domains";

/**
 * Public: list linked agents from the in-memory domain store.
 *
 * GET /api/agents
 */
export async function GET() {
  const agents = listLinkedDomains().map((d) => ({
    agentAddress: d.agentAddress,
    humanId: d.humanId,
    domain: d.name,
  }));

  return NextResponse.json({ ok: true, agents });
}
