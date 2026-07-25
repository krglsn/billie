import { NextResponse } from "next/server";
import {
  isNextResponse,
  requireHumanBackedAgent,
} from "@/lib/agentkit";
import {
  isDomainLinked,
  linkDomain,
  normalizeDomainName,
} from "@/lib/domains";
import { verifyAgentOwnsDomain } from "@/lib/ens";

type ClaimDomainBody = {
  name?: unknown;
};

/**
 * Claim / link an already-registered ENS root domain on Ethereum Sepolia.
 *
 * Body: { "name": "billie.eth" }
 *
 * Checks:
 * - AgentKit human-backed identity (402 / 401 / 403)
 * - Domain not already linked in Billie (409)
 * - On-chain ENS owner on Sepolia matches the agent address (404 / 403 / 502)
 * - Domain is wrapped in the ENS NameWrapper (422) — required for invoice subdomains
 */
export async function POST(request: Request) {
  const agent = await requireHumanBackedAgent(request);
  if (isNextResponse(agent)) {
    return agent;
  }

  let body: ClaimDomainBody;
  try {
    body = (await request.json()) as ClaimDomainBody;
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

  if (isDomainLinked(name)) {
    return NextResponse.json(
      {
        error: "Domain is already registered on Billie",
        name,
      },
      { status: 409 },
    );
  }

  const ownership = await verifyAgentOwnsDomain(name, agent.address);
  if (!ownership.ok) {
    if (ownership.reason === "not_registered") {
      return NextResponse.json(
        {
          error: "Domain is not registered on Ethereum Sepolia ENS",
          name,
          chainId: "eip155:11155111",
        },
        { status: 404 },
      );
    }
    if (ownership.reason === "owner_mismatch") {
      return NextResponse.json(
        {
          error: "Domain owner does not match agent address",
          name,
          agentAddress: agent.address,
          ensOwner: ownership.owner,
          chainId: "eip155:11155111",
        },
        { status: 403 },
      );
    }
    return NextResponse.json(
      {
        error: "Failed to verify ENS ownership on Sepolia",
        name,
        detail: ownership.detail,
      },
      { status: 502 },
    );
  }

  if (!ownership.wrapped) {
    return NextResponse.json(
      {
        error:
          "Domain must be wrapped in the ENS NameWrapper before it can be linked",
        name,
        ensOwner: ownership.owner,
        wrapped: false,
        chainId: "eip155:11155111",
        hint: "Wrap the name on Ethereum Sepolia, then retry the claim",
      },
      { status: 422 },
    );
  }

  const linked = linkDomain({
    name,
    agentAddress: agent.address,
    humanId: agent.humanId,
    chainId: ownership.chainId,
    ensOwner: ownership.owner,
    wrapped: ownership.wrapped,
  });

  return NextResponse.json({
    ok: true,
    mapping: {
      humanId: linked.humanId,
      agentAddress: linked.agentAddress,
      domain: linked.name,
    },
    chainId: linked.chainId,
    ensOwner: linked.ensOwner,
    wrapped: linked.wrapped,
    linkedAt: linked.linkedAt,
  });
}
