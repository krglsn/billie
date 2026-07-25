import { NextResponse } from "next/server";
import {
  recoverTransactionAddress,
  parseTransaction,
  type Hex,
} from "viem";
import { sepolia } from "viem/chains";
import {
  isNextResponse,
  requireHumanBackedAgent,
} from "@/lib/agentkit";
import { createSepoliaPublicClient } from "@/lib/ens";
import { writeInvoiceTextRecords } from "@/lib/invoice-texts";
import { getInvoice, updateInvoice } from "@/lib/invoices";

type SubmitInvoiceBody = {
  invoiceId?: unknown;
  signedTx?: unknown;
};

const CONFIRM_TIMEOUT_MS = Number(process.env.INVOICE_CONFIRM_TIMEOUT_MS ?? 45_000);

/**
 * Submit a signed invoice registration tx.
 *
 * Body: { "invoiceId": "inv_…", "signedTx": "0x…" }
 *
 * Verifies AgentKit + invoice ownership + tx matches prepare payload,
 * broadcasts to Ethereum Sepolia, then waits briefly for 1 confirmation.
 */
export async function POST(request: Request) {
  const agent = await requireHumanBackedAgent(request);
  if (isNextResponse(agent)) {
    return agent;
  }

  let body: SubmitInvoiceBody;
  try {
    body = (await request.json()) as SubmitInvoiceBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (typeof body.invoiceId !== "string" || !body.invoiceId) {
    return NextResponse.json(
      { error: "Missing required field: invoiceId" },
      { status: 400 },
    );
  }
  if (typeof body.signedTx !== "string" || !body.signedTx.startsWith("0x")) {
    return NextResponse.json(
      { error: "Missing required field: signedTx (hex)" },
      { status: 400 },
    );
  }

  const invoice = getInvoice(body.invoiceId);
  if (!invoice) {
    return NextResponse.json({ error: "Invoice not found" }, { status: 404 });
  }

  if (invoice.agentAddress !== agent.address.toLowerCase()) {
    return NextResponse.json(
      { error: "Invoice does not belong to this agent" },
      { status: 403 },
    );
  }

  if (invoice.status !== "prepared") {
    return NextResponse.json(
      {
        error: "Invoice is not in prepared state",
        status: invoice.status,
        txHash: invoice.txHash,
      },
      { status: 409 },
    );
  }

  const signedTx = body.signedTx as Hex;

  let from: `0x${string}`;
  try {
    from = await recoverTransactionAddress({
      serializedTransaction: signedTx as Parameters<
        typeof recoverTransactionAddress
      >[0]["serializedTransaction"],
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: "Invalid signed transaction",
        detail: error instanceof Error ? error.message : "Recover failed",
      },
      { status: 400 },
    );
  }

  if (from.toLowerCase() !== agent.address.toLowerCase()) {
    return NextResponse.json(
      {
        error: "Signed tx from address does not match agent",
        from,
        agentAddress: agent.address,
      },
      { status: 403 },
    );
  }

  let parsed;
  try {
    parsed = parseTransaction(
      signedTx as Parameters<typeof parseTransaction>[0],
    );
  } catch (error) {
    return NextResponse.json(
      {
        error: "Could not parse signed transaction",
        detail: error instanceof Error ? error.message : "Parse failed",
      },
      { status: 400 },
    );
  }

  if (parsed.chainId !== sepolia.id) {
    return NextResponse.json(
      {
        error: "Signed tx chainId must be Ethereum Sepolia (11155111)",
        chainId: parsed.chainId,
      },
      { status: 400 },
    );
  }

  if (!parsed.to || parsed.to.toLowerCase() !== invoice.tx.to.toLowerCase()) {
    return NextResponse.json(
      {
        error: "Signed tx `to` does not match prepared invoice",
        expected: invoice.tx.to,
        actual: parsed.to,
      },
      { status: 400 },
    );
  }

  const actualData = (parsed.data ?? "0x").toLowerCase();
  if (actualData !== invoice.tx.data.toLowerCase()) {
    return NextResponse.json(
      {
        error: "Signed tx `data` does not match prepared invoice calldata",
      },
      { status: 400 },
    );
  }

  const value = parsed.value ?? BigInt(0);
  if (value !== BigInt(0)) {
    return NextResponse.json(
      { error: "Signed tx value must be 0 for invoice registration" },
      { status: 400 },
    );
  }

  const client = createSepoliaPublicClient();

  let txHash: `0x${string}`;
  try {
    txHash = await client.sendRawTransaction({
      serializedTransaction: signedTx as Parameters<
        typeof client.sendRawTransaction
      >[0]["serializedTransaction"],
    });
  } catch (error) {
    updateInvoice(invoice.id, {
      status: "failed",
      error: error instanceof Error ? error.message : "Broadcast failed",
    });
    return NextResponse.json(
      {
        error: "Failed to broadcast transaction to Sepolia",
        detail: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 502 },
    );
  }

  updateInvoice(invoice.id, { status: "submitted", txHash });

  try {
    const receipt = await client.waitForTransactionReceipt({
      hash: txHash,
      timeout: CONFIRM_TIMEOUT_MS,
    });

    if (receipt.status === "reverted") {
      const failed = updateInvoice(invoice.id, {
        status: "failed",
        txHash,
        error: "Transaction reverted on-chain",
      });
      return NextResponse.json(
        {
          ok: false,
          invoiceId: failed.id,
          status: failed.status,
          txHash,
          fullName: failed.fullName,
          error: failed.error,
          stubCalldata: failed.stubCalldata,
        },
        { status: 502 },
      );
    }

    const confirmed = updateInvoice(invoice.id, {
      status: "confirmed",
      txHash,
    });

    let textsWritten = false;
    let textsTxHash: `0x${string}` | undefined;
    let textsError: string | undefined;
    try {
      const written = await writeInvoiceTextRecords({
        fullName: confirmed.fullName,
        texts: confirmed.texts,
      });
      textsWritten = true;
      textsTxHash = written.txHash;
      updateInvoice(invoice.id, {
        textsWritten: true,
        textsTxHash: written.txHash,
      });
    } catch (error) {
      textsError =
        error instanceof Error ? error.message : "Failed to write text records";
      updateInvoice(invoice.id, {
        textsWritten: false,
        textsError,
      });
    }

    return NextResponse.json({
      ok: true,
      invoiceId: confirmed.id,
      status: confirmed.status,
      txHash,
      fullName: confirmed.fullName,
      blockNumber: receipt.blockNumber.toString(),
      texts: confirmed.texts,
      textsWritten,
      textsTxHash,
      textsError,
      stubCalldata: confirmed.stubCalldata,
    });
  } catch {
    // Mining can be slow on Sepolia — return hash so the client can watch it.
    const submitted = updateInvoice(invoice.id, {
      status: "submitted",
      txHash,
    });
    return NextResponse.json({
      ok: true,
      invoiceId: submitted.id,
      status: submitted.status,
      txHash,
      fullName: submitted.fullName,
      stubCalldata: submitted.stubCalldata,
      hint: "Broadcast ok; confirmation timed out — check tx on Sepolia explorer",
    });
  }
}
