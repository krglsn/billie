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
import {
  InvoiceTextsWriteError,
  writeInvoiceTextRecords,
} from "@/lib/invoice-texts";
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
 * Billie broadcasts the agent-signed register, waits for confirm, then writes
 * billie.* text records via PermissionedResolver.multicall (Billie pays gas).
 *
 * Differentiated error codes:
 * - register_invalid / register_mismatch / …
 * - register_broadcast_failed
 * - register_reverted
 * - register_confirm_timeout
 * - texts_no_resolver / texts_broadcast_failed / texts_reverted
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
      { error: "Missing required field: invoiceId", code: "invalid_body" },
      { status: 400 },
    );
  }
  if (typeof body.signedTx !== "string" || !body.signedTx.startsWith("0x")) {
    return NextResponse.json(
      {
        error: "Missing required field: signedTx (hex)",
        code: "invalid_body",
      },
      { status: 400 },
    );
  }

  const invoice = getInvoice(body.invoiceId);
  if (!invoice) {
    return NextResponse.json(
      { error: "Invoice not found", code: "invoice_not_found" },
      { status: 404 },
    );
  }

  if (invoice.agentAddress !== agent.address.toLowerCase()) {
    return NextResponse.json(
      {
        error: "Invoice does not belong to this agent",
        code: "invoice_forbidden",
      },
      { status: 403 },
    );
  }

  if (invoice.status !== "prepared") {
    return NextResponse.json(
      {
        error: "Invoice is not in prepared state",
        code: "invoice_not_prepared",
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
        code: "register_invalid",
        detail: error instanceof Error ? error.message : "Recover failed",
      },
      { status: 400 },
    );
  }

  if (from.toLowerCase() !== agent.address.toLowerCase()) {
    return NextResponse.json(
      {
        error: "Signed tx from address does not match agent",
        code: "register_signer_mismatch",
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
        code: "register_invalid",
        detail: error instanceof Error ? error.message : "Parse failed",
      },
      { status: 400 },
    );
  }

  if (parsed.chainId !== sepolia.id) {
    return NextResponse.json(
      {
        error: "Signed tx chainId must be Ethereum Sepolia (11155111)",
        code: "register_chain_mismatch",
        chainId: parsed.chainId,
      },
      { status: 400 },
    );
  }

  if (!parsed.to || parsed.to.toLowerCase() !== invoice.tx.to.toLowerCase()) {
    return NextResponse.json(
      {
        error: "Signed tx `to` does not match prepared invoice",
        code: "register_to_mismatch",
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
        code: "register_data_mismatch",
      },
      { status: 400 },
    );
  }

  const value = parsed.value ?? BigInt(0);
  if (value !== BigInt(0)) {
    return NextResponse.json(
      {
        error: "Signed tx value must be 0 for invoice registration",
        code: "register_value_nonzero",
      },
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
      errorCode: "register_broadcast_failed",
      error: error instanceof Error ? error.message : "Broadcast failed",
    });
    return NextResponse.json(
      {
        ok: false,
        invoiceId: invoice.id,
        fullName: invoice.fullName,
        error: "Failed to broadcast register transaction to Sepolia",
        code: "register_broadcast_failed",
        detail: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 502 },
    );
  }

  updateInvoice(invoice.id, {
    status: "submitted",
    txHash,
    errorCode: undefined,
    error: undefined,
  });

  let receipt;
  try {
    receipt = await client.waitForTransactionReceipt({
      hash: txHash,
      timeout: CONFIRM_TIMEOUT_MS,
    });
  } catch {
    const submitted = updateInvoice(invoice.id, {
      status: "submitted",
      txHash,
      errorCode: "register_confirm_timeout",
      error: "Register broadcast ok; confirmation timed out",
    });
    return NextResponse.json(
      {
        ok: false,
        invoiceId: submitted.id,
        status: submitted.status,
        txHash,
        fullName: submitted.fullName,
        error: submitted.error,
        code: "register_confirm_timeout",
        hint: "Check the register tx on Sepolia; texts were not written yet",
      },
      { status: 504 },
    );
  }

  if (receipt.status === "reverted") {
    const failed = updateInvoice(invoice.id, {
      status: "failed",
      txHash,
      errorCode: "register_reverted",
      error: "Register transaction reverted on-chain",
    });
    return NextResponse.json(
      {
        ok: false,
        invoiceId: failed.id,
        status: failed.status,
        txHash,
        fullName: failed.fullName,
        error: failed.error,
        code: "register_reverted",
      },
      { status: 502 },
    );
  }

  // Domain exists on-chain. Texts are a separate Billie-paid step.
  const confirmed = updateInvoice(invoice.id, {
    status: "confirmed",
    txHash,
    errorCode: undefined,
    error: undefined,
  });

  try {
    const written = await writeInvoiceTextRecords({
      fullName: confirmed.fullName,
      texts: confirmed.texts,
    });
    updateInvoice(invoice.id, {
      textsWritten: true,
      textsTxHash: written.txHash,
      textsError: undefined,
    });
    return NextResponse.json({
      ok: true,
      invoiceId: confirmed.id,
      status: "confirmed",
      txHash,
      fullName: confirmed.fullName,
      blockNumber: receipt.blockNumber.toString(),
      texts: confirmed.texts,
      textsWritten: true,
      textsTxHash: written.txHash,
      stubCalldata: confirmed.stubCalldata,
    });
  } catch (error) {
    const textsCode =
      error instanceof InvoiceTextsWriteError
        ? error.code === "no_resolver"
          ? "texts_no_resolver"
          : error.code === "reverted"
            ? "texts_reverted"
            : "texts_broadcast_failed"
        : "texts_write_failed";
    const textsTxHash =
      error instanceof InvoiceTextsWriteError ? error.txHash : undefined;
    const textsError =
      error instanceof Error ? error.message : "Failed to write text records";

    updateInvoice(invoice.id, {
      textsWritten: false,
      textsTxHash,
      textsError,
      errorCode: textsCode,
      error: textsError,
    });

    return NextResponse.json(
      {
        ok: false,
        invoiceId: confirmed.id,
        status: "confirmed",
        txHash,
        fullName: confirmed.fullName,
        blockNumber: receipt.blockNumber.toString(),
        texts: confirmed.texts,
        textsWritten: false,
        textsTxHash,
        textsError,
        error: "Invoice domain registered, but Billie failed to write text records",
        code: textsCode,
        detail: textsError,
        hint: "Domain exists on-chain without billie.* texts; retry texts later",
      },
      { status: 502 },
    );
  }
}
