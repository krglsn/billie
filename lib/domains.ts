export type LinkedDomain = {
  name: string;
  agentAddress: string;
  humanId: string;
  chainId: "eip155:11155111";
  ensOwner: string;
  protocol: "ensv2";
  tokenId: string;
  resolver: string;
  linkedAt: string;
};

/**
 * In-memory store shaped as:
 *   humanId → agentAddress → domain record
 *
 * Plus indexes for uniqueness / invoice lookups:
 *   - by domain name (global uniqueness)
 *   - by agent address (one linked root domain per agent)
 */
const byHumanId = new Map<string, Map<string, LinkedDomain>>();
const byName = new Map<string, LinkedDomain>();
const byAgentAddress = new Map<string, LinkedDomain>();

function normalizeAddress(address: string): string {
  return address.toLowerCase();
}

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

export function getLinkedDomain(name: string): LinkedDomain | undefined {
  return byName.get(name);
}

export function isDomainLinked(name: string): boolean {
  return byName.has(name);
}

export function getLinkedDomainByAgent(
  agentAddress: string,
): LinkedDomain | undefined {
  return byAgentAddress.get(normalizeAddress(agentAddress));
}

export function getLinkedDomainsByHuman(humanId: string): LinkedDomain[] {
  const agents = byHumanId.get(humanId);
  if (!agents) return [];
  return [...agents.values()];
}

/**
 * Snapshot of the nested mapping humanId → agentAddress → domain name.
 */
export function getHumanAgentDomainMap(): Record<
  string,
  Record<string, string>
> {
  const out: Record<string, Record<string, string>> = {};
  for (const [humanId, agents] of byHumanId) {
    out[humanId] = {};
    for (const [agentAddress, record] of agents) {
      out[humanId][agentAddress] = record.name;
    }
  }
  return out;
}

export function linkDomain(
  input: Omit<LinkedDomain, "linkedAt">,
): LinkedDomain {
  const agentKey = normalizeAddress(input.agentAddress);

  if (byName.has(input.name)) {
    throw new Error("Domain is already registered on Billie");
  }

  if (byAgentAddress.has(agentKey)) {
    throw new Error("Agent already has a linked domain on Billie");
  }

  const record: LinkedDomain = {
    ...input,
    agentAddress: agentKey,
    linkedAt: new Date().toISOString(),
  };

  let agents = byHumanId.get(input.humanId);
  if (!agents) {
    agents = new Map();
    byHumanId.set(input.humanId, agents);
  }
  agents.set(agentKey, record);
  byName.set(input.name, record);
  byAgentAddress.set(agentKey, record);

  return record;
}
