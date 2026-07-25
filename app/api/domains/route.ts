import { NextResponse } from "next/server";
import type { Address } from "viem";
import {
  isNextResponse,
  requireHumanBackedAgent,
} from "@/lib/agentkit";
import { getBillieParentName } from "@/lib/billie-parent";
import {
  getLinkedDomain,
  getLinkedDomainByAgent,
  linkDomain,
  resolveNamespaceClaim,
} from "@/lib/domains";
import { provisionAgentNamespace } from "@/lib/provision-agent-namespace";

type ClaimDomainBody = {
  name?: unknown;
};

function linkedResponse(
  linked: ReturnType<typeof linkDomain>,
  extra?: { relinked?: boolean; txs?: Record<string, string> },
) {
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
    relinked: extra?.relinked ?? false,
    txs: extra?.txs ?? {},
  });
}

/**
 * Provision + claim an agent namespace under BILLIE_PARENT_NAME.
 *
 * Body: { "name": "alice" } or { "name": "alice.parent.eth" }
 *
 * Flow:
 * - AgentKit human-backed identity
 * - If namespace already on-chain for this agent (and invoice-ready) → re-link in memory
 * - Else Billie deploys agent UserRegistry and registers `{label}.{parent}.eth`
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

  const alreadyLinked = getLinkedDomain(name);
  if (alreadyLinked) {
    if (alreadyLinked.agentAddress === agent.address.toLowerCase()) {
      return linkedResponse(alreadyLinked, { relinked: true });
    }
    return NextResponse.json(
      {
        error: "Namespace is already registered on Billie to another agent",
        name,
      },
      { status: 409 },
    );
  }

  const existingForAgent = getLinkedDomainByAgent(agent.address);
  if (existingForAgent) {
    if (existingForAgent.name === name) {
      return linkedResponse(existingForAgent, { relinked: true });
    }
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
    humanId: agent.humanId,
  });

  if (!provisioned.ok) {
    const { code, message, detail, limit, windowSec, count, retryAfterSec } =
      provisioned.error;
    const status =
      code === "parent_not_ready" || code === "billie_key_missing"
        ? 503
        : code === "rate_limited"
          ? 429
          : code === "label_taken" ||
              code === "owner_mismatch" ||
              code === "namespace_incomplete"
            ? 409
            : 502;
    const headers =
      code === "rate_limited" && retryAfterSec
        ? { "Retry-After": String(retryAfterSec) }
        : undefined;
    return NextResponse.json(
      {
        error: message,
        code,
        detail,
        name,
        parentName,
        ...(code === "rate_limited"
          ? { limit, windowSec, count, retryAfterSec }
          : {}),
      },
      { status, headers },
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

  return linkedResponse(linked, {
    relinked: ns.relinked,
    txs: Object.fromEntries(
      Object.entries(ns.txs).filter(([, v]) => typeof v === "string"),
    ) as Record<string, string>,
  });
}
