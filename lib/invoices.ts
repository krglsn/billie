import { randomBytes } from "crypto";
import type { InvoiceAttestation } from "@/lib/billie-attestation";
import { getDb } from "@/lib/db";
import type { LinkedDomain } from "@/lib/domains";
import type { InvoiceTextRecords } from "@/lib/invoice-texts";
import type { Hex } from "viem";

export type InvoiceStatus =
  | "prepared"
  | "submitted"
  | "confirmed"
  | "failed";

export type PreparedTxPayload = {
  to: `0x${string}`;
  data: `0x${string}`;
  value: "0";
};

export type InvoiceRecord = {
  id: string;
  label: string;
  fullName: string;
  amount: string;
  currency: string;
  token: string;
  paymentAddress: string;
  rootDomain: string;
  agentAddress: string;
  humanId: string;
  status: InvoiceStatus;
  attestation: InvoiceAttestation;
  texts: InvoiceTextRecords;
  chainId: "eip155:11155111";
  /** register() on agent UserRegistry — agent-signed */
  tx: PreparedTxPayload;
  stubCalldata: boolean;
  createdAt: string;
  updatedAt: string;
  txHash?: `0x${string}`;
  textsTxHash?: Hex;
  textsWritten?: boolean;
  textsError?: string;
  error?: string;
  errorCode?: string;
};

type InvoiceRow = {
  id: string;
  label: string;
  full_name: string;
  amount: string;
  currency: string;
  token: string;
  payment_address: string;
  root_domain: string;
  agent_address: string;
  human_id: string;
  status: string;
  attestation_json: string;
  texts_json: string;
  chain_id: string;
  tx_json: string;
  stub_calldata: number;
  created_at: string;
  updated_at: string;
  tx_hash: string | null;
  texts_tx_hash: string | null;
  texts_written: number | null;
  texts_error: string | null;
  error: string | null;
  error_code: string | null;
};

function normalizeAddress(address: string): string {
  return address.toLowerCase();
}

function rowToInvoice(row: InvoiceRow): InvoiceRecord {
  const record: InvoiceRecord = {
    id: row.id,
    label: row.label,
    fullName: row.full_name,
    amount: row.amount,
    currency: row.currency,
    token: row.token,
    paymentAddress: row.payment_address,
    rootDomain: row.root_domain,
    agentAddress: row.agent_address,
    humanId: row.human_id,
    status: row.status as InvoiceStatus,
    attestation: JSON.parse(row.attestation_json) as InvoiceAttestation,
    texts: JSON.parse(row.texts_json) as InvoiceTextRecords,
    chainId: row.chain_id as InvoiceRecord["chainId"],
    tx: JSON.parse(row.tx_json) as PreparedTxPayload,
    stubCalldata: row.stub_calldata === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
  if (row.tx_hash) record.txHash = row.tx_hash as `0x${string}`;
  if (row.texts_tx_hash) record.textsTxHash = row.texts_tx_hash as Hex;
  if (row.texts_written !== null) record.textsWritten = row.texts_written === 1;
  if (row.texts_error) record.textsError = row.texts_error;
  if (row.error) record.error = row.error;
  if (row.error_code) record.errorCode = row.error_code;
  return record;
}

export function normalizeInvoiceLabel(input: string): string {
  const trimmed = input.trim().toLowerCase();
  if (!trimmed) {
    throw new Error("Invoice label is required");
  }
  if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/.test(trimmed)) {
    throw new Error(
      "Invalid invoice label: use lowercase letters, numbers, and hyphens",
    );
  }
  if (trimmed.length < 1 || trimmed.length > 63) {
    throw new Error("Invoice label must be between 1 and 63 characters");
  }
  return trimmed;
}

export function createInvoiceId(): string {
  return `inv_${randomBytes(8).toString("hex")}`;
}

export function getInvoice(id: string): InvoiceRecord | undefined {
  const row = getDb()
    .prepare("SELECT * FROM invoices WHERE id = ?")
    .get(id) as InvoiceRow | undefined;
  return row ? rowToInvoice(row) : undefined;
}

export function getInvoiceByFullName(
  fullName: string,
): InvoiceRecord | undefined {
  const row = getDb()
    .prepare("SELECT * FROM invoices WHERE full_name = ?")
    .get(fullName.toLowerCase()) as InvoiceRow | undefined;
  return row ? rowToInvoice(row) : undefined;
}

/** Invoices for an agent wallet. */
export function listInvoicesByAgent(agentAddress: string): InvoiceRecord[] {
  const rows = getDb()
    .prepare(
      "SELECT * FROM invoices WHERE agent_address = ? ORDER BY created_at ASC",
    )
    .all(normalizeAddress(agentAddress)) as InvoiceRow[];
  return rows.map(rowToInvoice);
}

function insertInvoice(record: InvoiceRecord): void {
  getDb()
    .prepare(
      `INSERT INTO invoices (
        id, label, full_name, amount, currency, token, payment_address,
        root_domain, agent_address, human_id, status, attestation_json,
        texts_json, chain_id, tx_json, stub_calldata, created_at, updated_at,
        tx_hash, texts_tx_hash, texts_written, texts_error, error, error_code
      ) VALUES (
        @id, @label, @fullName, @amount, @currency, @token, @paymentAddress,
        @rootDomain, @agentAddress, @humanId, @status, @attestationJson,
        @textsJson, @chainId, @txJson, @stubCalldata, @createdAt, @updatedAt,
        @txHash, @textsTxHash, @textsWritten, @textsError, @error, @errorCode
      )`,
    )
    .run({
      id: record.id,
      label: record.label,
      fullName: record.fullName,
      amount: record.amount,
      currency: record.currency,
      token: record.token,
      paymentAddress: record.paymentAddress,
      rootDomain: record.rootDomain,
      agentAddress: record.agentAddress,
      humanId: record.humanId,
      status: record.status,
      attestationJson: JSON.stringify(record.attestation),
      textsJson: JSON.stringify(record.texts),
      chainId: record.chainId,
      txJson: JSON.stringify(record.tx),
      stubCalldata: record.stubCalldata ? 1 : 0,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
      txHash: record.txHash ?? null,
      textsTxHash: record.textsTxHash ?? null,
      textsWritten:
        record.textsWritten === undefined ? null : record.textsWritten ? 1 : 0,
      textsError: record.textsError ?? null,
      error: record.error ?? null,
      errorCode: record.errorCode ?? null,
    });
}

export function savePreparedInvoice(input: {
  id: string;
  label: string;
  amount: string;
  currency: string;
  token: string;
  paymentAddress: string;
  domain: LinkedDomain;
  attestation: InvoiceAttestation;
  texts: InvoiceTextRecords;
  tx: PreparedTxPayload;
  stubCalldata: boolean;
}): InvoiceRecord {
  const fullName = `${input.label}.${input.domain.name}`.toLowerCase();
  if (getInvoiceByFullName(fullName)) {
    throw new Error("Invoice subdomain already exists on Billie");
  }

  const now = new Date().toISOString();
  const record: InvoiceRecord = {
    id: input.id,
    label: input.label,
    fullName,
    amount: input.amount,
    currency: input.currency,
    token: input.token,
    paymentAddress: input.paymentAddress,
    rootDomain: input.domain.name,
    agentAddress: normalizeAddress(input.domain.agentAddress),
    humanId: input.domain.humanId,
    status: "prepared",
    attestation: input.attestation,
    texts: input.texts,
    chainId: "eip155:11155111",
    tx: input.tx,
    stubCalldata: input.stubCalldata,
    createdAt: now,
    updatedAt: now,
  };

  try {
    insertInvoice(record);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("UNIQUE") || message.includes("unique")) {
      throw new Error("Invoice subdomain already exists on Billie");
    }
    throw error;
  }

  return record;
}

export function updateInvoice(
  id: string,
  patch: Partial<
    Pick<
      InvoiceRecord,
      | "status"
      | "txHash"
      | "error"
      | "errorCode"
      | "updatedAt"
      | "textsTxHash"
      | "textsWritten"
      | "textsError"
    >
  >,
): InvoiceRecord {
  const existing = getInvoice(id);
  if (!existing) {
    throw new Error("Invoice not found");
  }
  const updated: InvoiceRecord = {
    ...existing,
    ...patch,
    updatedAt: new Date().toISOString(),
  };

  getDb()
    .prepare(
      `UPDATE invoices SET
        status = @status,
        updated_at = @updatedAt,
        tx_hash = @txHash,
        texts_tx_hash = @textsTxHash,
        texts_written = @textsWritten,
        texts_error = @textsError,
        error = @error,
        error_code = @errorCode
      WHERE id = @id`,
    )
    .run({
      id: updated.id,
      status: updated.status,
      updatedAt: updated.updatedAt,
      txHash: updated.txHash ?? null,
      textsTxHash: updated.textsTxHash ?? null,
      textsWritten:
        updated.textsWritten === undefined
          ? null
          : updated.textsWritten
            ? 1
            : 0,
      textsError: updated.textsError ?? null,
      error: updated.error ?? null,
      errorCode: updated.errorCode ?? null,
    });

  return updated;
}
