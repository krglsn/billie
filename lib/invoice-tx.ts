import { encodeFunctionData, type Address, type Hex } from "viem";
import {
  signInvoiceAttestation,
  type InvoiceAttestation,
} from "@/lib/billie-attestation";
import {
  ethLabelFromName,
  getEthRegistryAddress,
  getEthSubregistry,
} from "@/lib/ens";
import type { LinkedDomain } from "@/lib/domains";

/** ROLE_SET_RESOLVER | ROLE_RENEW — enough for a bare subname without text writes. */
const DEFAULT_ROLE_BITMAP = BigInt(1 << 24) | BigInt(1 << 4);

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
  to: Address;
  data: Hex;
  value: "0";
  chainId: "eip155:11155111";
  stubCalldata: boolean;
  /** Off-chain for now; later ENS text `billie.attestation`. */
  attestation: InvoiceAttestation;
};

export async function buildInvoiceRegisterTx(input: {
  invoiceId: string;
  label: string;
  amount: string;
  currency: string;
  domain: LinkedDomain;
}): Promise<PreparedInvoiceTx> {
  const rootLabel = ethLabelFromName(input.domain.name);
  const fullName = `${input.label}.${input.domain.name}`;
  const subregistry = await getEthSubregistry(rootLabel);
  const stubCalldata = !subregistry;
  const to = (subregistry ?? getEthRegistryAddress()) as Address;

  const expiry = BigInt(Math.floor(Date.now() / 1000) + 365 * 24 * 60 * 60);
  const data = encodeFunctionData({
    abi: registerAbi,
    functionName: "register",
    args: [
      input.label,
      input.domain.agentAddress as Address,
      "0x0000000000000000000000000000000000000000",
      // Text records (incl. billie.attestation) come later — resolver unset.
      "0x0000000000000000000000000000000000000000",
      DEFAULT_ROLE_BITMAP,
      expiry,
    ],
  });

  const attestation = await signInvoiceAttestation({
    invoiceId: input.invoiceId,
    fullName,
    amount: input.amount,
    currency: input.currency,
    agentAddress: input.domain.agentAddress as Address,
    humanId: input.domain.humanId,
  });

  return {
    to,
    data,
    value: "0",
    chainId: "eip155:11155111",
    stubCalldata,
    attestation,
  };
}
