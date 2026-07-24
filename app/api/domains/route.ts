import { NextResponse } from "next/server";
import {
  isNextResponse,
  requireHumanBackedAgent,
} from "@/lib/agentkit";
import { stubDomainRegistrationParams } from "@/lib/domain-registration";
import {
  isDomainTaken,
  normalizeDomainName,
  reserveDomain,
} from "@/lib/domains";

type CreateDomainBody = {
  name?: unknown;
};

export async function POST(request: Request) {
  const agent = await requireHumanBackedAgent(request);
  if (isNextResponse(agent)) {
    return agent;
  }

  let body: CreateDomainBody;
  try {
    body = (await request.json()) as CreateDomainBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (typeof body.name !== "string") {
    return NextResponse.json(
      { error: "Missing required field: name" },
      { status: 400 },
    );
  }

  let name: string;
  try {
    name = normalizeDomainName(body.name);
  } catch (error) {
    return NextResponse.json(
      {
        error: "Invalid domain name",
        detail: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 400 },
    );
  }

  if (isDomainTaken(name)) {
    return NextResponse.json(
      { error: "Domain is already taken", name },
      { status: 409 },
    );
  }

  reserveDomain(name, agent.address, agent.humanId);

  return NextResponse.json(
    stubDomainRegistrationParams({
      name,
      agentAddress: agent.address,
      humanId: agent.humanId,
    }),
  );
}
