/**
 * Billie service attestation for invoices.
 *
 * Written on-chain as ENS text `billie.attestation` after invoice submit confirms
 * (via Billie's shared PermissionedResolver multicall).
 */
import {
  getAddress,
  isAddress,
  verifyTypedData,
  type Address,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { lookupHumanId } from "@/lib/agentbook";

/** ENS text record key for the service signature. */
export const BILLIE_ATTESTATION_ENS_TEXT_KEY = "billie.attestation" as const;

export type InvoiceAttestationPayload = {
  invoiceId: string;
  fullName: string;
  amount: string;
  currency: string;
  agentAddress: Address;
  humanId: string;
};

/** Off-chain + on-chain attestation; ENS text `billie.attestation`. */
export type InvoiceAttestation = {
  ensTextKey: typeof BILLIE_ATTESTATION_ENS_TEXT_KEY;
  scheme: "eip712";
  signer: Address;
  signature: Hex;
};

export const invoiceAttestationDomain = {
  name: "Billie",
  version: "1",
  chainId: 11155111,
} as const;

export const invoiceAttestationTypes = {
  InvoiceAttestation: [
    { name: "invoiceId", type: "string" },
    { name: "fullName", type: "string" },
    { name: "amount", type: "string" },
    { name: "currency", type: "string" },
    { name: "agentAddress", type: "address" },
    { name: "humanId", type: "string" },
  ],
} as const;

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
    domain: invoiceAttestationDomain,
    types: invoiceAttestationTypes,
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

export type AttestationVerifyResult =
  | { ok: true; expectedSigner: Address }
  | { ok: false; reason: string; expectedSigner?: Address };

/**
 * Verify EIP-712 attestation against current Billie signer + invoice fields.
 */
export async function verifyInvoiceAttestation(input: {
  signature: string;
  claimedSigner?: string | null;
  scheme?: string | null;
  payload: {
    invoiceId: string;
    fullName: string;
    amount: string;
    currency: string;
    agentAddress: string;
    humanId: string;
  };
}): Promise<AttestationVerifyResult> {
  let expectedSigner: Address;
  try {
    expectedSigner = getBillieAttestationSigner();
  } catch {
    return { ok: false, reason: "billie_signer_unavailable" };
  }

  if (input.scheme && input.scheme !== "eip712") {
    return { ok: false, reason: "unsupported_scheme", expectedSigner };
  }

  if (!input.signature?.startsWith("0x")) {
    return { ok: false, reason: "missing_signature", expectedSigner };
  }

  if (!isAddress(input.payload.agentAddress)) {
    return { ok: false, reason: "invalid_agent_address", expectedSigner };
  }

  if (input.claimedSigner) {
    if (!isAddress(input.claimedSigner)) {
      return { ok: false, reason: "invalid_claimed_signer", expectedSigner };
    }
    if (getAddress(input.claimedSigner) !== expectedSigner) {
      return { ok: false, reason: "signer_mismatch", expectedSigner };
    }
  }

  try {
    const valid = await verifyTypedData({
      address: expectedSigner,
      domain: invoiceAttestationDomain,
      types: invoiceAttestationTypes,
      primaryType: "InvoiceAttestation",
      message: {
        invoiceId: input.payload.invoiceId,
        fullName: input.payload.fullName,
        amount: input.payload.amount,
        currency: input.payload.currency,
        agentAddress: getAddress(input.payload.agentAddress),
        humanId: input.payload.humanId,
      },
      signature: input.signature as Hex,
    });

    if (!valid) {
      return { ok: false, reason: "invalid_signature", expectedSigner };
    }
    return { ok: true, expectedSigner };
  } catch (error) {
    return {
      ok: false,
      reason:
        error instanceof Error ? error.message : "attestation_verify_failed",
      expectedSigner,
    };
  }
}

export type IdentityVerifyResult = {
  agent: { ok: boolean; reason?: string };
  human: { ok: boolean; reason?: string; lookedUpHumanId?: string };
};

/** Confirm agent is AgentBook-registered and maps to the claimed humanId. */
export async function verifyInvoiceAgentHuman(
  agentAddress: string,
  claimedHumanId: string,
): Promise<IdentityVerifyResult> {
  if (!isAddress(agentAddress)) {
    return {
      agent: { ok: false, reason: "invalid_agent_address" },
      human: { ok: false, reason: "invalid_agent_address" },
    };
  }
  if (!claimedHumanId?.trim()) {
    return {
      agent: { ok: false, reason: "missing_human_id" },
      human: { ok: false, reason: "missing_human_id" },
    };
  }

  const lookup = await lookupHumanId(agentAddress);
  if (!lookup.ok) {
    const reason =
      lookup.reason === "not_registered"
        ? "not_registered"
        : (lookup.detail ?? "lookup_failed");
    return {
      agent: { ok: false, reason },
      human: { ok: false, reason },
    };
  }

  const humanMatch =
    lookup.humanId.toLowerCase() === claimedHumanId.trim().toLowerCase();

  return {
    agent: { ok: true },
    human: humanMatch
      ? { ok: true, lookedUpHumanId: lookup.humanId }
      : {
          ok: false,
          reason: "human_id_mismatch",
          lookedUpHumanId: lookup.humanId,
        },
  };
}
