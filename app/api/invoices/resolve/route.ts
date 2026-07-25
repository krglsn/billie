import { NextResponse } from "next/server";
import { zeroAddress } from "viem";
import { normalize } from "viem/ens";
import {
  verifyInvoiceAgentHuman,
  verifyInvoiceAttestation,
} from "@/lib/billie-attestation";
import {
  formatAtomicAmount,
  formatCurrencyDisplay,
  readErc20TokenMeta,
} from "@/lib/erc20";
import {
  INVOICE_TEXT_KEYS,
  readInvoiceTextRecords,
} from "@/lib/invoice-texts";
import { getInvoiceByFullName } from "@/lib/invoices";
import {
  buildApproveCalldata,
  buildPayCalldata,
  checkInvoiceOnRouter,
  computePaymentStatus,
  getBilliePaymentRouterAddress,
  invoiceNode,
  settlementFieldsFromTexts,
} from "@/lib/payment-router";

/**
 * Public: resolve an invoice ENS name, compute payment status, return pay calldata.
 *
 * GET /api/invoices/resolve?name=inv-01.alice.parent.eth
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const rawName = url.searchParams.get("name")?.trim();
  if (!rawName) {
    return NextResponse.json(
      { error: "Missing query param: name" },
      { status: 400 },
    );
  }

  let fullName: string;
  try {
    fullName = normalize(rawName);
  } catch (error) {
    return NextResponse.json(
      {
        error: "Invalid ENS name",
        detail: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 400 },
    );
  }

  const node = invoiceNode(fullName);
  const texts = await readInvoiceTextRecords(fullName);
  const settlement = settlementFieldsFromTexts(texts);
  const memory = getInvoiceByFullName(fullName);

  if (!settlement.amount && !memory) {
    return NextResponse.json(
      {
        error: "Invoice not found on-chain (no billie.* texts)",
        fullName,
        node,
      },
      { status: 404 },
    );
  }

  const router = getBilliePaymentRouterAddress();
  let routerCheck = null as Awaited<ReturnType<typeof checkInvoiceOnRouter>>;
  try {
    routerCheck = await checkInvoiceOnRouter(node);
  } catch (error) {
    return NextResponse.json(
      {
        error: "Failed to read PaymentRouter",
        detail: error instanceof Error ? error.message : "Unknown error",
        fullName,
        node,
        router,
      },
      { status: 502 },
    );
  }

  const paidOnRouter = routerCheck?.paidOnRouter ?? null;
  const paymentStatus = computePaymentStatus({
    paidOnRouter,
    ensStatus: settlement.status,
  });

  const amountAtomic =
    routerCheck?.amount && routerCheck.amount !== "0"
      ? routerCheck.amount
      : (settlement.amount ?? memory?.amount);
  const token =
    routerCheck?.token && routerCheck.token !== zeroAddress
      ? routerCheck.token
      : (settlement.token ?? memory?.token);
  const paymentAddress =
    routerCheck?.paymentAddress &&
    routerCheck.paymentAddress !== zeroAddress
      ? routerCheck.paymentAddress
      : (settlement.paymentAddress ?? memory?.paymentAddress);

  const tokenMeta = token ? await readErc20TokenMeta(token) : null;
  const amountDisplay =
    amountAtomic && tokenMeta
      ? formatAtomicAmount(amountAtomic, tokenMeta.decimals)
      : null;
  const currencyDisplay = tokenMeta
    ? formatCurrencyDisplay(tokenMeta)
    : (settlement.currency ?? memory?.currency ?? null);

  const invoiceId = settlement.invoiceId ?? memory?.id ?? null;
  const currency = settlement.currency ?? memory?.currency ?? null;
  const agentAddress =
    texts[INVOICE_TEXT_KEYS.agent] ?? memory?.agentAddress ?? null;
  const humanId = texts[INVOICE_TEXT_KEYS.humanId] ?? memory?.humanId ?? null;

  const [identity, attestation] = await Promise.all([
    agentAddress && humanId
      ? verifyInvoiceAgentHuman(agentAddress, humanId)
      : Promise.resolve({
          agent: {
            ok: false,
            reason: !agentAddress ? "missing_agent" : "missing_human_id",
          },
          human: {
            ok: false,
            reason: !humanId ? "missing_human_id" : "missing_agent",
          },
        }),
    invoiceId && amountAtomic && currency && agentAddress && humanId
      ? verifyInvoiceAttestation({
          signature: texts[INVOICE_TEXT_KEYS.attestation] ?? "",
          claimedSigner: texts[INVOICE_TEXT_KEYS.attestationSigner],
          scheme: texts[INVOICE_TEXT_KEYS.attestationScheme],
          payload: {
            invoiceId,
            fullName,
            amount: amountAtomic,
            currency,
            agentAddress,
            humanId,
          },
        })
      : Promise.resolve({
          ok: false as const,
          reason: "missing_attestation_fields",
        }),
  ]);

  const pay =
    router && routerCheck?.payable === true && token && amountAtomic
      ? {
          chainId: "eip155:11155111" as const,
          router,
          node,
          approve: {
            to: token,
            data: buildApproveCalldata({
              spender: router,
              amount: BigInt(amountAtomic),
            }),
            value: "0" as const,
          },
          payInvoice: {
            to: router,
            data: buildPayCalldata(node),
            value: "0" as const,
          },
          hint: "Approve the ERC-20 spending allowance, then submit payInvoice from the payer wallet.",
        }
      : null;

  return NextResponse.json({
    ok: true,
    fullName,
    node,
    paymentStatus,
    paidOnRouter,
    ensStatus: settlement.status ?? null,
    amount: amountAtomic ?? null,
    amountDisplay,
    currency,
    currencyDisplay,
    token: token ?? null,
    tokenMeta,
    paymentAddress: paymentAddress ?? null,
    invoiceId,
    texts,
    router,
    routerCheck: routerCheck
      ? {
          payable: routerCheck.payable,
          reason: routerCheck.reason,
          token: routerCheck.token,
          paymentAddress: routerCheck.paymentAddress,
          amount: routerCheck.amount,
          ensStatus: routerCheck.ensStatus,
        }
      : null,
    pay,
    verification: {
      human: {
        ok: identity.human.ok,
        label: identity.human.ok
          ? "verified unique human"
          : "unverified human",
        reason: identity.human.reason ?? null,
      },
      agent: {
        ok: identity.agent.ok,
        label: identity.agent.ok
          ? "verified backed-human agent"
          : "unverified agent",
        reason: identity.agent.reason ?? null,
      },
      attestation: {
        ok: attestation.ok,
        label: attestation.ok
          ? "verified attestation"
          : "unverified issuer",
        reason: attestation.ok ? null : attestation.reason,
        expectedSigner:
          "expectedSigner" in attestation
            ? (attestation.expectedSigner ?? null)
            : null,
      },
    },
    registration: memory
      ? {
          status: memory.status,
          textsWritten: memory.textsWritten ?? false,
          txHash: memory.txHash,
        }
      : null,
  });
}
