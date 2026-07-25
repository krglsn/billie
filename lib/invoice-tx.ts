import { encodeFunctionData, type Address, type Hex, zeroAddress } from "viem";
import {
  signInvoiceAttestation,
  type InvoiceAttestation,
} from "@/lib/billie-attestation";
import type { LinkedDomain } from "@/lib/domains";
import {
  Status,
  getBillieInvoiceResolverAddress,
  getRegistryLabelState,
} from "@/lib/ens";
import { AGENT_NAMESPACE_NAME_ROLES } from "@/lib/ens-roles";
import {
  buildInvoiceTextRecords,
  type InvoiceTextRecords,
} from "@/lib/invoice-texts";

const registerAbi = [
  {
    type: "function",
    name: "register",
    stateMutability: "nonpayable",
    inputs: [
      { name: "label", type: "string" },
      { name: "owner", type: "address" },
      { name: "registry", type: "address" },
      { name: "resolver", type: "address" },
      { name: "roleBitmap", type: "uint256" },
      { name: "expiry", type: "uint64" },
    ],
    outputs: [{ name: "tokenId", type: "uint256" }],
  },
] as const;

export type PreparedInvoiceTx = {
  /** register() on the agent UserRegistry */
  to: Address;
  data: Hex;
  value: "0";
  chainId: "eip155:11155111";
  fullName: string;
  resolver: Address;
  texts: InvoiceTextRecords;
  stubCalldata: false;
  attestation: InvoiceAttestation;
};

export class InvoicePrepareError extends Error {
  constructor(
    message: string,
    readonly code:
      | "no_subregistry"
      | "no_resolver"
      | "label_taken"
      | "lookup_failed",
  ) {
    super(message);
    this.name = "InvoicePrepareError";
  }
}

/**
 * Prepare invoice registration for the agent:
 * register calldata on agent UserRegistry with Billie's PermissionedResolver.
 * Text records are written by Billie after submit confirms (not by the agent).
 */
export async function buildInvoiceRegisterTx(input: {
  invoiceId: string;
  label: string;
  amount: string;
  currency: string;
  token: string;
  paymentAddress: string;
  domain: LinkedDomain;
}): Promise<PreparedInvoiceTx> {
  const subregistry = input.domain.subregistry as Address | undefined;
  if (!subregistry) {
    throw new InvoicePrepareError(
      "Linked namespace has no UserRegistry — reclaim via POST /api/domains",
      "no_subregistry",
    );
  }

  const resolver = getBillieInvoiceResolverAddress();
  if (!resolver) {
    throw new InvoicePrepareError(
      "BILLIE_INVOICE_RESOLVER is not set — run pnpm ops:invoice-resolver",
      "no_resolver",
    );
  }

  const fullName = `${input.label}.${input.domain.name}`;

  let existing;
  try {
    existing = await getRegistryLabelState(subregistry, input.label);
  } catch (error) {
    throw new InvoicePrepareError(
      error instanceof Error
        ? error.message
        : "Failed to read agent UserRegistry",
      "lookup_failed",
    );
  }

  if (existing.status === Status.REGISTERED || existing.owner) {
    throw new InvoicePrepareError(
      `Invoice label already registered on-chain as ${fullName}`,
      "label_taken",
    );
  }

  const oneYear =
    BigInt(Math.floor(Date.now() / 1000)) + BigInt(365 * 24 * 60 * 60);
  const expiry = oneYear;

  const attestation = await signInvoiceAttestation({
    invoiceId: input.invoiceId,
    fullName,
    amount: input.amount,
    currency: input.currency,
    agentAddress: input.domain.agentAddress as Address,
    humanId: input.domain.humanId,
  });

  const texts = buildInvoiceTextRecords({
    invoiceId: input.invoiceId,
    fullName,
    amount: input.amount,
    currency: input.currency,
    token: input.token,
    paymentAddress: input.paymentAddress,
    domain: input.domain,
    attestation,
  });

  const data = encodeFunctionData({
    abi: registerAbi,
    functionName: "register",
    args: [
      input.label,
      input.domain.agentAddress as Address,
      zeroAddress,
      resolver,
      AGENT_NAMESPACE_NAME_ROLES,
      expiry,
    ],
  });

  return {
    to: subregistry,
    data,
    value: "0",
    chainId: "eip155:11155111",
    fullName,
    resolver,
    texts,
    stubCalldata: false,
    attestation,
  };
}
