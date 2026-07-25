import { NextResponse } from "next/server";
import {
  isNextResponse,
  requireHumanBackedAgent,
} from "@/lib/agentkit";
import { checkBillieParentStatus } from "@/lib/billie-parent";
import { getLinkedDomainByAgent, normalizeDomainName } from "@/lib/domains";
import {
  InvoicePrepareError,
  buildInvoiceRegisterTx,
} from "@/lib/invoice-tx";
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
 * Prepare an invoice subdomain registration under the agent's namespace.
 *
 * Body: { "label": "inv-01", "amount": "100", "currency": "USDC", "domain"?: "alice.parent.eth" }
 *
 * `register` targets the agent UserRegistry → `inv-01.alice.parent.eth`.
 * Agent signs and submits via POST /api/invoices/submit (agent pays gas).
 */
export async function POST(request: Request) {
  const agent = await requireHumanBackedAgent(request);
  if (isNextResponse(agent)) {
    return agent;
  }

  const parent = await checkBillieParentStatus();
  if (!parent.canWriteInvoiceTexts) {
    const textsCheck = parent.checks.find(
      (c) =>
        c.id === "invoice_resolver_configured" ||
        c.id === "billie_can_set_invoice_text",
    );
    return NextResponse.json(
      {
        error: "Invoice text records are not available",
        code: "invoice_texts_unavailable",
        detail:
          textsCheck?.detail ??
          "Billie cannot write ENS text records — set BILLIE_INVOICE_RESOLVER and ensure ROLE_SET_TEXT",
        canWriteInvoiceTexts: false,
        checks: parent.checks.filter(
          (c) =>
            c.id === "invoice_resolver_configured" ||
            c.id === "billie_can_set_invoice_text",
        ),
      },
      { status: 503 },
    );
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

  if (!linked || (requestedDomain && linked.name !== requestedDomain)) {
    return NextResponse.json(
      {
        error: "Agent has not claimed the specified namespace",
        agentAddress: agent.address,
        domain: requestedDomain,
      },
      { status: 409 },
    );
  }

  const domain = linked;

  if (!domain.subregistry) {
    return NextResponse.json(
      {
        error: "Linked namespace has no UserRegistry",
        domain: domain.name,
      },
      { status: 409 },
    );
  }

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
  let prepared;
  try {
    prepared = await buildInvoiceRegisterTx({
      invoiceId,
      label,
      amount,
      currency,
      domain,
    });
  } catch (error) {
    if (error instanceof InvoicePrepareError) {
      const status =
        error.code === "label_taken"
          ? 409
          : error.code === "no_subregistry" || error.code === "no_resolver"
            ? 503
            : 502;
      return NextResponse.json(
        {
          error: error.message,
          code: error.code,
          fullName,
          namespace: domain.name,
          subregistry: domain.subregistry,
        },
        { status },
      );
    }
    return NextResponse.json(
      {
        error: "Failed to prepare invoice",
        detail: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 },
    );
  }

  const invoice = savePreparedInvoice({
    id: invoiceId,
    label,
    amount,
    currency,
    domain,
    attestation: prepared.attestation,
    texts: prepared.texts,
    tx: {
      to: prepared.to,
      data: prepared.data,
      value: prepared.value,
    },
    stubCalldata: false,
  });

  return NextResponse.json({
    ok: true,
    invoiceId: invoice.id,
    fullName: invoice.fullName,
    amount: invoice.amount,
    currency: invoice.currency,
    rootDomain: invoice.rootDomain,
    namespace: domain.name,
    subregistry: domain.subregistry,
    resolver: prepared.resolver,
    texts: invoice.texts,
    attestation: invoice.attestation,
    stubCalldata: false,
    chainId: invoice.chainId,
    tx: invoice.tx,
    hint: "Sign the tx from the agent wallet and POST /api/invoices/submit (agent pays gas for register). Billie writes ENS text records after confirmation.",
  });
}
