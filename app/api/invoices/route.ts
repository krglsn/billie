import { NextResponse } from "next/server";
import { isAddress } from "viem";
import {
  isNextResponse,
  requireHumanBackedAgent,
} from "@/lib/agentkit";
import { checkBillieParentStatus } from "@/lib/billie-parent";
import {
  getLinkedDomainByAgent,
  matchLinkedNamespace,
  normalizeDomainName,
} from "@/lib/domains";
import {
  formatAtomicAmount,
  readErc20TokenMeta,
  type Erc20TokenMeta,
} from "@/lib/erc20";
import { INVOICE_TEXT_KEYS } from "@/lib/invoice-texts";
import {
  InvoicePrepareError,
  buildInvoiceRegisterTx,
} from "@/lib/invoice-tx";
import {
  createInvoiceId,
  getInvoiceByFullName,
  listInvoicesByAgent,
  normalizeInvoiceLabel,
  savePreparedInvoice,
} from "@/lib/invoices";
import {
  computePaymentStatus,
  invoiceNode,
  normalizeAtomicAmount,
  normalizeEvmAddress,
  readRouterPaid,
} from "@/lib/payment-router";

type PrepareInvoiceBody = {
  label?: unknown;
  amount?: unknown;
  currency?: unknown;
  token?: unknown;
  paymentAddress?: unknown;
  /** Agent namespace label under Billie parent, e.g. `alice` (preferred). */
  namespace?: unknown;
  /** @deprecated Prefer `namespace` (label). Full ENS name still accepted. */
  domain?: unknown;
};

/**
 * Public: list invoices for an agent (in-memory store).
 *
 * GET /api/invoices?agent=0x…&domain=alice.parent.eth
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const agent = url.searchParams.get("agent")?.trim();
  if (!agent || !isAddress(agent)) {
    return NextResponse.json(
      { error: "Missing or invalid query param: agent (0x address)" },
      { status: 400 },
    );
  }

  const domainRaw = url.searchParams.get("domain")?.trim();
  let domain: string | undefined;
  if (domainRaw) {
    try {
      domain = normalizeDomainName(domainRaw);
    } catch (error) {
      return NextResponse.json(
        {
          error: "Invalid query param: domain",
          detail: error instanceof Error ? error.message : "Unknown error",
        },
        { status: 400 },
      );
    }
  }

  let records = listInvoicesByAgent(agent);
  if (domain) {
    records = records.filter(
      (inv) => inv.rootDomain.toLowerCase() === domain.toLowerCase(),
    );
  }

  const tokenMetaCache = new Map<string, Erc20TokenMeta | null>();

  const invoices = await Promise.all(
    records.map(async (inv) => {
      const ensStatus = inv.texts[INVOICE_TEXT_KEYS.status] ?? "open";
      let paidOnRouter: boolean | null = null;
      if (inv.status === "confirmed" && inv.textsWritten) {
        try {
          paidOnRouter = await readRouterPaid(invoiceNode(inv.fullName));
        } catch {
          paidOnRouter = null;
        }
      }

      const tokenKey = inv.token.toLowerCase();
      let tokenMeta = tokenMetaCache.get(tokenKey);
      if (tokenMeta === undefined) {
        tokenMeta = await readErc20TokenMeta(inv.token);
        tokenMetaCache.set(tokenKey, tokenMeta);
      }

      const amountDisplay = tokenMeta
        ? formatAtomicAmount(inv.amount, tokenMeta.decimals)
        : null;
      const amountLabel =
        amountDisplay && tokenMeta?.symbol
          ? `${amountDisplay} ${tokenMeta.symbol}`
          : (amountDisplay ?? inv.amount);

      return {
        fullName: inv.fullName,
        agentAddress: inv.agentAddress,
        humanId: inv.humanId,
        rootDomain: inv.rootDomain,
        amount: inv.amount,
        amountDisplay,
        amountLabel,
        paymentStatus: computePaymentStatus({ paidOnRouter, ensStatus }),
        registrationStatus: inv.status,
      };
    }),
  );

  return NextResponse.json({
    ok: true,
    agent: agent.toLowerCase(),
    domain: domain ?? null,
    invoices,
  });
}

/**
 * Prepare an invoice subdomain registration under the agent's namespace.
 *
 * Body: {
 *   "namespace": "alice",
 *   "label": "inv-01",
 *   "amount": "1000000",
 *   "currency": "USDC",
 *   "token": "0x…",
 *   "paymentAddress"?: "0x…"
 * }
 *
 * `namespace` is the agent label under BILLIE_PARENT_NAME (not the full ENS name).
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
  if (!linked) {
    return NextResponse.json(
      {
        error: "Agent has not claimed a namespace",
        agentAddress: agent.address,
      },
      { status: 409 },
    );
  }

  if (body.namespace !== undefined && typeof body.namespace !== "string") {
    return NextResponse.json(
      { error: "Invalid field: namespace (string label)" },
      { status: 400 },
    );
  }
  if (body.domain !== undefined && typeof body.domain !== "string") {
    return NextResponse.json(
      { error: "Invalid field: domain (string)" },
      { status: 400 },
    );
  }

  const namespaceRaw =
    typeof body.namespace === "string"
      ? body.namespace
      : typeof body.domain === "string"
        ? body.domain
        : undefined;

  let domain = linked;
  if (namespaceRaw !== undefined) {
    const matched = matchLinkedNamespace(linked, namespaceRaw);
    if (!matched) {
      return NextResponse.json(
        {
          error: "Agent has not claimed the specified namespace",
          agentAddress: agent.address,
          namespace: namespaceRaw.trim().toLowerCase(),
          linkedNamespace: linked.label,
        },
        { status: 409 },
      );
    }
    domain = matched;
  }

  if (!domain.subregistry) {
    return NextResponse.json(
      {
        error: "Linked namespace has no UserRegistry",
        namespace: domain.label,
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
          namespace: domain.label,
          domain: domain.name,
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
    namespace: domain.label,
    domain: domain.name,
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
