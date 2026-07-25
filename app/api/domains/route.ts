import { NextResponse } from "next/server";
import type { Address } from "viem";
import {
  isNextResponse,
  requireHumanBackedAgent,
} from "@/lib/agentkit";
import { getBillieParentName } from "@/lib/billie-parent";
import {
  getLinkedDomainByAgent,
  isDomainLinked,
  linkDomain,
  resolveNamespaceClaim,
} from "@/lib/domains";
import { provisionAgentNamespace } from "@/lib/provision-agent-namespace";

type ClaimDomainBody = {
  name?: unknown;
};

/**
 * Provision + claim an agent namespace under BILLIE_PARENT_NAME.
 *
 * Body: { "name": "alice" } or { "name": "alice.parent.eth" }
 *
 * Flow:
 * - AgentKit human-backed identity
 * - Billie deploys agent UserRegistry, registers `{label}.{parent}.eth`
 * - Stores humanId → agentAddress → namespace (+ subregistry for invoices)
 */
export async function POST(request: Request) {
  const agent = await requireHumanBackedAgent(request);
  if (isNextResponse(agent)) {
    return agent;
  }

  const parentName = getBillieParentName();
  if (!parentName) {
    return NextResponse.json(
      {
        error: "Billie parent name is not configured",
        detail: "Set BILLIE_PARENT_NAME",
      },
      { status: 503 },
    );
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

  let label: string;
  let name: string;
  try {
    ({ label, name } = resolveNamespaceClaim(body.name, parentName));
  } catch (error) {
    return NextResponse.json(
      {
        error: "Invalid namespace name",
        detail: error instanceof Error ? error.message : "Unknown error",
        parentName,
      },
      { status: 400 },
    );
  }

  if (isDomainLinked(name)) {
    return NextResponse.json(
      {
        error: "Namespace is already registered on Billie",
        name,
      },
      { status: 409 },
    );
  }

  const existingForAgent = getLinkedDomainByAgent(agent.address);
  if (existingForAgent) {
    return NextResponse.json(
      {
        error: "Agent already has a linked namespace on Billie",
        domain: existingForAgent.name,
        agentAddress: agent.address,
      },
      { status: 409 },
    );
  }

  const provisioned = await provisionAgentNamespace({
    label,
    agentAddress: agent.address as Address,
  });

  if (!provisioned.ok) {
    const { code, message, detail } = provisioned.error;
    const status =
      code === "parent_not_ready"
        ? 503
        : code === "label_taken"
          ? 409
          : code === "billie_key_missing"
            ? 503
            : 502;
    return NextResponse.json(
      { error: message, code, detail, name, parentName },
      { status },
    );
  }

  const ns = provisioned.namespace;
  const linked = linkDomain({
    name: ns.name,
    label: ns.label,
    parentName: ns.parentName,
    agentAddress: agent.address,
    humanId: agent.humanId,
    chainId: "eip155:11155111",
    ensOwner: ns.agentAddress,
    protocol: "ensv2",
    tokenId: ns.tokenId,
    resolver: ns.resolver,
    subregistry: ns.subregistry,
  });

  return NextResponse.json({
    ok: true,
    mapping: {
      humanId: linked.humanId,
      agentAddress: linked.agentAddress,
      domain: linked.name,
    },
    name: linked.name,
    label: linked.label,
    parentName: linked.parentName,
    subregistry: linked.subregistry,
    chainId: linked.chainId,
    protocol: linked.protocol,
    ensOwner: linked.ensOwner,
    tokenId: linked.tokenId,
    resolver: linked.resolver,
    linkedAt: linked.linkedAt,
    txs: ns.txs,
  });
}
