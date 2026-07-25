/**
 * Billie service attestation for invoices.
 *
 * Later this signature is written as an ENS text record on the invoice
 * subdomain (key `billie.attestation`). For now it lives only on the Billie
 * invoice record / prepare response — not in register calldata.
 */
import { type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";

/** Future ENS text record key (Idea.md service signature). */
export const BILLIE_ATTESTATION_ENS_TEXT_KEY = "billie.attestation" as const;

export type InvoiceAttestationPayload = {
  invoiceId: string;
  fullName: string;
  amount: string;
  currency: string;
  agentAddress: Address;
  humanId: string;
};

/** Off-chain attestation; maps to ENS text `billie.attestation` later. */
export type InvoiceAttestation = {
  ensTextKey: typeof BILLIE_ATTESTATION_ENS_TEXT_KEY;
  scheme: "eip712";
  signer: Address;
  signature: Hex;
};

function requireBillieAccount() {
  const key = process.env.BILLIE_PRIVATE_KEY as `0x${string}` | undefined;
  if (!key) {
    throw new Error(
      "BILLIE_PRIVATE_KEY is required to sign invoice attestations",
    );
  }
  return privateKeyToAccount(key);
}

export function getBillieAttestationSigner(): Address {
  return requireBillieAccount().address;
}

export async function signInvoiceAttestation(
  payload: InvoiceAttestationPayload,
): Promise<InvoiceAttestation> {
  const account = requireBillieAccount();

  const signature = await account.signTypedData({
    domain: {
      name: "Billie",
      version: "1",
      chainId: 11155111,
    },
    types: {
      InvoiceAttestation: [
        { name: "invoiceId", type: "string" },
        { name: "fullName", type: "string" },
        { name: "amount", type: "string" },
        { name: "currency", type: "string" },
        { name: "agentAddress", type: "address" },
        { name: "humanId", type: "string" },
      ],
    },
    primaryType: "InvoiceAttestation",
    message: {
      invoiceId: payload.invoiceId,
      fullName: payload.fullName,
      amount: payload.amount,
      currency: payload.currency,
      agentAddress: payload.agentAddress,
      humanId: payload.humanId,
    },
  });

  return {
    ensTextKey: BILLIE_ATTESTATION_ENS_TEXT_KEY,
    scheme: "eip712",
    signer: account.address,
    signature,
  };
}
