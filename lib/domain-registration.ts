/**
 * Stub registration parameters for Base Sepolia.
 * Replace with real ENS controller calldata when contracts are wired.
 */
export const DOMAIN_REGISTRATION_STUB = {
  chainId: "eip155:84532",
  chainName: "base-sepolia",
  // Placeholder — not a real registrar
  to: "0x0000000000000000000000000000000000000000" as const,
  data: "0x" as const,
  value: "0",
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
