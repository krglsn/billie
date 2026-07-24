/**
 * Stub registration parameters for Ethereum Sepolia (root ENS domains).
 * Invoice subdomains will target Base Sepolia separately.
 * Replace with real ENS controller calldata when contracts are wired.
 */
export const DOMAIN_REGISTRATION_STUB = {
  chainId: "eip155:11155111",
  chainName: "ethereum-sepolia",
  // Placeholder — not a real registrar
  to: "0x0000000000000000000000000000000000000000" as const,
  data: "0x" as const,
  value: "0",
} as const;

/** Future home for invoice subdomain creation (not used by /api/domains). */
export const INVOICE_CHAIN = {
  chainId: "eip155:84532",
  chainName: "base-sepolia",
} as const;

export type DomainRegistrationParams = {
  name: string;
  chainId: string;
  chainName: string;
  to: `0x${string}`;
  data: `0x${string}`;
  value: string;
  agentAddress: string;
  humanId: string;
};

export function stubDomainRegistrationParams(input: {
  name: string;
  agentAddress: string;
  humanId: string;
}): DomainRegistrationParams {
  return {
    name: input.name,
    ...DOMAIN_REGISTRATION_STUB,
    agentAddress: input.agentAddress,
    humanId: input.humanId,
  };
}
