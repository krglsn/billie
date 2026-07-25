import { NextResponse } from "next/server";
import {
  isNextResponse,
  requireHumanBackedAgent,
} from "@/lib/agentkit";
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
import {
  normalizeAtomicAmount,
  normalizeEvmAddress,
} from "@/lib/payment-router";

type PrepareInvoiceBody = {
  label?: unknown;
  amount?: unknown;
  currency?: unknown;
  token?: unknown;
  paymentAddress?: unknown;
  domain?: unknown;
};

/**
 * Prepare an invoice subdomain registration under the agent's namespace.
 *
 * Body: {
 *   "label": "inv-01",
 *   "amount": "1000000",
 *   "currency": "USDC",
 *   "token": "0x…",
 *   "paymentAddress"?: "0x…",
 *   "domain"?: "alice.parent.eth"
 * }
 *
 * `amount` is atomic units (e.g. 1 USDC with 6 decimals → "1000000").
 * `paymentAddress` defaults to the agent wallet.
 * `register` targets the agent UserRegistry → `inv-01.alice.parent.eth`.
 * Agent signs and submits via POST /api/invoices/submit (agent pays gas).
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
      { error: "Missing required field: amount (atomic integer string)" },
      { status: 400 },
    );
  }
  if (typeof body.currency !== "string" || !body.currency.trim()) {
    return NextResponse.json(
      { error: "Missing required field: currency (string)" },
      { status: 400 },
    );
  }
  if (typeof body.token !== "string" || !body.token.trim()) {
    return NextResponse.json(
      { error: "Missing required field: token (ERC-20 address)" },
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

  let amount: string;
  let token: string;
  let paymentAddress: string;
  try {
    amount = normalizeAtomicAmount(body.amount);
    token = normalizeEvmAddress(body.token, "token");
    paymentAddress =
      body.paymentAddress === undefined || body.paymentAddress === null
        ? normalizeEvmAddress(domain.agentAddress, "paymentAddress")
        : typeof body.paymentAddress === "string"
          ? normalizeEvmAddress(body.paymentAddress, "paymentAddress")
          : (() => {
              throw new Error("paymentAddress must be a string address");
            })();
  } catch (error) {
    return NextResponse.json(
      {
        error: "Invalid settlement fields",
        detail: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 400 },
    );
  }

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
      token,
      paymentAddress,
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
    token,
    paymentAddress,
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
    token: invoice.token,
    paymentAddress: invoice.paymentAddress,
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
