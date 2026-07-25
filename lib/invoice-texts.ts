/**
 * ENS text record keys and values for Billie invoice subdomains.
 * Written on-chain to the Billie PermissionedResolver after register confirms.
 */
import { encodeFunctionData, namehash, type Hex } from "viem";
import { sepolia } from "viem/chains";
import {
  BILLIE_ATTESTATION_ENS_TEXT_KEY,
  type InvoiceAttestation,
} from "@/lib/billie-attestation";
import type { LinkedDomain } from "@/lib/domains";
import {
  createSepoliaPublicClient,
  getBillieInvoiceResolverAddress,
} from "@/lib/ens";
import {
  createBillieSepoliaClients,
  waitSuccess,
} from "@/lib/ens-registry-write";

export const INVOICE_TEXT_KEYS = {
  invoiceId: "billie.invoiceId",
  amount: "billie.amount",
  currency: "billie.currency",
  status: "billie.status",
  recipient: "billie.recipient",
  parent: "billie.parent",
  agent: "billie.agent",
  humanId: "billie.humanId",
  attestation: BILLIE_ATTESTATION_ENS_TEXT_KEY,
  attestationSigner: "billie.attestationSigner",
  attestationScheme: "billie.attestationScheme",
} as const;

export type InvoiceTextRecords = Record<
  (typeof INVOICE_TEXT_KEYS)[keyof typeof INVOICE_TEXT_KEYS],
  string
>;

export function buildInvoiceTextRecords(input: {
  invoiceId: string;
  fullName: string;
  amount: string;
  currency: string;
  status?: string;
  domain: LinkedDomain;
  attestation: InvoiceAttestation;
}): InvoiceTextRecords {
  return {
    [INVOICE_TEXT_KEYS.invoiceId]: input.invoiceId,
    [INVOICE_TEXT_KEYS.amount]: input.amount,
    [INVOICE_TEXT_KEYS.currency]: input.currency,
    [INVOICE_TEXT_KEYS.status]: input.status ?? "open",
    [INVOICE_TEXT_KEYS.recipient]: input.domain.name,
    [INVOICE_TEXT_KEYS.parent]: input.domain.parentName,
    [INVOICE_TEXT_KEYS.agent]: input.domain.agentAddress,
    [INVOICE_TEXT_KEYS.humanId]: input.domain.humanId,
    [INVOICE_TEXT_KEYS.attestation]: input.attestation.signature,
    [INVOICE_TEXT_KEYS.attestationSigner]: input.attestation.signer,
    [INVOICE_TEXT_KEYS.attestationScheme]: input.attestation.scheme,
  };
}

const permissionedResolverAbi = [
  {
    type: "function",
    name: "setText",
    stateMutability: "nonpayable",
    inputs: [
      { name: "node", type: "bytes32" },
      { name: "key", type: "string" },
      { name: "value", type: "string" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "multicall",
    stateMutability: "nonpayable",
    inputs: [{ name: "data", type: "bytes[]" }],
    outputs: [{ name: "results", type: "bytes[]" }],
  },
  {
    type: "function",
    name: "text",
    stateMutability: "view",
    inputs: [
      { name: "node", type: "bytes32" },
      { name: "key", type: "string" },
    ],
    outputs: [{ type: "string" }],
  },
] as const;

/**
 * Billie writes invoice text records on the shared PermissionedResolver.
 * Requires BILLIE_INVOICE_RESOLVER and ROLE_SET_TEXT for Billie on that resolver.
 */
export async function writeInvoiceTextRecords(input: {
  fullName: string;
  texts: InvoiceTextRecords;
}): Promise<{ txHash: Hex; texts: InvoiceTextRecords }> {
  const resolver = getBillieInvoiceResolverAddress();
  if (!resolver) {
    throw new Error(
      "BILLIE_INVOICE_RESOLVER is not set — run pnpm ops:invoice-resolver",
    );
  }

  const node = namehash(input.fullName);
  const calls = Object.entries(input.texts).map(([key, value]) =>
    encodeFunctionData({
      abi: permissionedResolverAbi,
      functionName: "setText",
      args: [node, key, value],
    }),
  );

  const clients = createBillieSepoliaClients();
  const txHash = await clients.walletClient.writeContract({
    address: resolver,
    abi: permissionedResolverAbi,
    functionName: "multicall",
    args: [calls],
    account: clients.account,
    chain: sepolia,
  });
  await waitSuccess(clients.publicClient, txHash, "invoice setText multicall");

  return { txHash, texts: input.texts };
}

export async function readInvoiceTextRecords(
  fullName: string,
): Promise<Partial<InvoiceTextRecords>> {
  const resolver = getBillieInvoiceResolverAddress();
  if (!resolver) return {};

  const client = createSepoliaPublicClient();
  const node = namehash(fullName);
  const out: Partial<InvoiceTextRecords> = {};

  for (const key of Object.values(INVOICE_TEXT_KEYS)) {
    try {
      const value = await client.readContract({
        address: resolver,
        abi: permissionedResolverAbi,
        functionName: "text",
        args: [node, key],
      });
      if (value) out[key] = value;
    } catch {
      // ignore missing keys
    }
  }
  return out;
}
