import { NextResponse } from "next/server";
import { checkBillieParentStatus } from "@/lib/billie-parent";

/**
 * Liveness + Billie parent ENSv2 readiness.
 * Returns HTTP 503 when parent name / UserRegistry checks fail so ops is visible.
 */
export async function GET() {
  const parent = await checkBillieParentStatus();

  return NextResponse.json(
    {
      ok: parent.ok,
      service: "billie",
      stage: 1,
      parent: {
        name: parent.name,
        label: parent.label,
        billieAddress: parent.billieAddress,
        owner: parent.owner,
        tokenId: parent.tokenId,
        subregistry: parent.subregistry,
        canProvisionAgents: parent.canProvisionAgents,
        ethRegistry: parent.ethRegistry,
        checks: parent.checks,
      },
    },
    { status: parent.ok ? 200 : 503 },
  );
}
