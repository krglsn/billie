import { NextResponse } from "next/server";
import {
  isNextResponse,
  requireHumanBackedAgent,
} from "@/lib/agentkit";
import { getLinkedDomainByAgent, normalizeDomainName } from "@/lib/domains";
import { buildInvoiceRegisterTx } from "@/lib/invoice-tx";
import {
  createInvoiceId,
  getInvoiceByFullName,
  normalizeInvoiceLabel,
  savePreparedInvoice,
} from "@/lib/invoices";

type PrepareInvoiceBody = {
  label?: unknown;
  amount?: unknown;
  currency?: unknown;
  domain?: unknown;
};

/**
 * Prepare an invoice subdomain registration tx (ENSv2, no text records yet).
 *
 * Body: { "label": "inv-01", "amount": "100", "currency": "USDC", "domain"?: "billie.eth" }
 *
 * Checks: AgentKit human-backed, agent has claimed the root domain, label free on Billie.
 * Returns stub attestation + calldata for the agent to sign.
 */
export async function POST(request: Request) {
  const agent = await requireHumanBackedAgent(request);
  if (isNextResponse(agent)) {
    return agent;
  }

  let body: PrepareInvoiceBody;
  try {
    body = (await request.json()) as PrepareInvoiceBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const linked = getLinkedDomainByAgent(agent.address);

  let requestedDomain: string | undefined;
  if (body.domain !== undefined) {
    if (typeof body.domain !== "string") {
      return NextResponse.json(
        { error: "Invalid field: domain (string)" },
        { status: 400 },
      );
    }
    try {
      requestedDomain = normalizeDomainName(body.domain);
    } catch (error) {
      return NextResponse.json(
        {
          error: "Invalid domain name",
          detail: error instanceof Error ? error.message : "Unknown error",
        },
        { status: 400 },
      );
    }
  }

  if (
    !linked ||
    (requestedDomain && linked.name !== requestedDomain)
  ) {
    return NextResponse.json(
      {
        error: "Agent has not claimed the specified domain",
        agentAddress: agent.address,
        domain: requestedDomain,
      },
      { status: 409 },
    );
  }

  const domain = linked;

  if (typeof body.label !== "string") {
    return NextResponse.json(
      { error: "Missing required field: label" },
      { status: 400 },
    );
  }
  if (typeof body.amount !== "string" || !body.amount.trim()) {
    return NextResponse.json(
      { error: "Missing required field: amount (string)" },
      { status: 400 },
    );
  }
  if (typeof body.currency !== "string" || !body.currency.trim()) {
    return NextResponse.json(
      { error: "Missing required field: currency (string)" },
      { status: 400 },
    );
  }

  let label: string;
  try {
    label = normalizeInvoiceLabel(body.label);
  } catch (error) {
    return NextResponse.json(
      {
        error: "Invalid invoice label",
        detail: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 400 },
    );
  }

  const amount = body.amount.trim();
  const currency = body.currency.trim().toUpperCase();
  const fullName = `${label}.${domain.name}`;

  if (getInvoiceByFullName(fullName)) {
    return NextResponse.json(
      { error: "Invoice subdomain already prepared/issued on Billie", fullName },
      { status: 409 },
    );
  }

  const invoiceId = createInvoiceId();
  const prepared = await buildInvoiceRegisterTx({
    invoiceId,
    label,
    amount,
    currency,
    domain,
  });

  const invoice = savePreparedInvoice({
    id: invoiceId,
    label,
    amount,
    currency,
    domain,
    attestation: prepared.attestation,
    tx: {
      to: prepared.to,
      data: prepared.data,
      value: prepared.value,
    },
    stubCalldata: prepared.stubCalldata,
  });

  return NextResponse.json({
    ok: true,
    invoiceId: invoice.id,
    fullName: invoice.fullName,
    amount: invoice.amount,
    currency: invoice.currency,
    rootDomain: invoice.rootDomain,
    attestation: invoice.attestation,
    stubCalldata: invoice.stubCalldata,
    chainId: invoice.chainId,
    tx: invoice.tx,
    hint: invoice.stubCalldata
      ? "Root name has no ENSv2 subregistry yet — calldata targets ETHRegistry as a stub and may revert on-chain"
      : "Sign and submit via POST /api/invoices/submit",
  });
}
