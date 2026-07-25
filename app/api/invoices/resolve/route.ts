import { NextResponse } from "next/server";
import { zeroAddress } from "viem";
import { normalize } from "viem/ens";
import { readInvoiceTextRecords } from "@/lib/invoice-texts";
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
    currency: settlement.currency ?? memory?.currency ?? null,
    token: token ?? null,
    paymentAddress: paymentAddress ?? null,
    invoiceId: settlement.invoiceId ?? memory?.id ?? null,
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
    registration: memory
      ? {
          status: memory.status,
          textsWritten: memory.textsWritten ?? false,
          txHash: memory.txHash,
        }
      : null,
  });
}
