import { randomBytes } from "crypto";
import type { InvoiceAttestation } from "@/lib/billie-attestation";
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

const byId = new Map<string, InvoiceRecord>();
const byFullName = new Map<string, InvoiceRecord>();

function normalizeAddress(address: string): string {
  return address.toLowerCase();
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
  return byId.get(id);
}

export function getInvoiceByFullName(
  fullName: string,
): InvoiceRecord | undefined {
  return byFullName.get(fullName.toLowerCase());
}

/** Invoices for an agent wallet (in-memory). */
export function listInvoicesByAgent(agentAddress: string): InvoiceRecord[] {
  const key = normalizeAddress(agentAddress);
  return [...byId.values()].filter((inv) => inv.agentAddress === key);
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
  const fullName = `${input.label}.${input.domain.name}`;
  if (byFullName.has(fullName)) {
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

  byId.set(record.id, record);
  byFullName.set(fullName, record);
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
  const existing = byId.get(id);
  if (!existing) {
    throw new Error("Invoice not found");
  }
  const updated: InvoiceRecord = {
    ...existing,
    ...patch,
    updatedAt: new Date().toISOString(),
  };
  byId.set(id, updated);
  byFullName.set(updated.fullName, updated);
  return updated;
}
