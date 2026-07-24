export type ReservedDomain = {
  name: string;
  agentAddress: string;
  humanId: string;
  reservedAt: string;
};

const reservedByName = new Map<string, ReservedDomain>();

/** Normalize to lowercase; ensure a single trailing `.eth`. */
export function normalizeDomainName(input: string): string {
  const trimmed = input.trim().toLowerCase();
  if (!trimmed) {
    throw new Error("Domain name is required");
  }

  const withoutEth = trimmed.endsWith(".eth")
    ? trimmed.slice(0, -4)
    : trimmed;

  if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/.test(withoutEth)) {
    throw new Error(
      "Invalid domain label: use lowercase letters, numbers, and hyphens",
    );
  }

  if (withoutEth.length < 3 || withoutEth.length > 63) {
    throw new Error("Domain label must be between 3 and 63 characters");
  }

  return `${withoutEth}.eth`;
}

export function getReservedDomain(name: string): ReservedDomain | undefined {
  return reservedByName.get(name);
}

export function isDomainTaken(name: string): boolean {
  return reservedByName.has(name);
}

export function reserveDomain(
  name: string,
  agentAddress: string,
  humanId: string,
): ReservedDomain {
  const existing = reservedByName.get(name);
  if (existing) {
    throw new Error("Domain is already taken");
  }

  const record: ReservedDomain = {
    name,
    agentAddress,
    humanId,
    reservedAt: new Date().toISOString(),
  };
  reservedByName.set(name, record);
  return record;
}
