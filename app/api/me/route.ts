import { NextResponse } from "next/server";
import {
  isNextResponse,
  requireHumanBackedAgent,
} from "@/lib/agentkit";

export async function GET(request: Request) {
  const agent = await requireHumanBackedAgent(request);
  if (isNextResponse(agent)) {
    return agent;
  }

  return NextResponse.json({
    ok: true,
    agentAddress: agent.address,
    humanId: agent.humanId,
  });
}
