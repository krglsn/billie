export type LinkedDomain = {
  /** Full ENS name, e.g. `alice.agentinvoice.eth`. */
  name: string;
  /** Single label under the Billie parent, e.g. `alice`. */
  label: string;
  /** Parent 2LD, e.g. `agentinvoice.eth`. */
  parentName: string;
  agentAddress: string;
  humanId: string;
  chainId: "eip155:11155111";
  ensOwner: string;
  protocol: "ensv2";
  tokenId: string;
  resolver: string;
  /** Agent UserRegistry — invoices register here. */
  subregistry: string;
  linkedAt: string;
};

/**
 * In-memory store shaped as:
 *   humanId → agentAddress → domain record
 *
 * Plus indexes for uniqueness / invoice lookups:
 *   - by domain name (global uniqueness)
 *   - by agent address (one linked namespace per agent)
 */
const byHumanId = new Map<string, Map<string, LinkedDomain>>();
const byName = new Map<string, LinkedDomain>();
const byAgentAddress = new Map<string, LinkedDomain>();

function normalizeAddress(address: string): string {
  return address.toLowerCase();
}

const LABEL_RE = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/;

/** Validate a single DNS label (3–63 chars). */
export function normalizeNamespaceLabel(input: string): string {
  const trimmed = input.trim().toLowerCase();
  if (!trimmed) {
    throw new Error("Namespace label is required");
  }
  if (!LABEL_RE.test(trimmed)) {
    throw new Error(
      "Invalid label: use lowercase letters, numbers, and hyphens",
    );
  }
  if (trimmed.length < 3 || trimmed.length > 63) {
    throw new Error("Label must be between 3 and 63 characters");
  }
  return trimmed;
}

/**
 * Parse claim body into a namespace label under `parentName`.
 * Accepts `alice`, `alice.parent.eth`, or (legacy) `alice.eth` → label only when parent matches.
 */
export function resolveNamespaceClaim(
  input: string,
  parentName: string,
): { label: string; name: string } {
  const parent = parentName.trim().toLowerCase();
  if (!parent.endsWith(".eth")) {
    throw new Error("Invalid parent name");
  }
  const parentLabel = parent.slice(0, -4);

  const trimmed = input.trim().toLowerCase();
  if (!trimmed) {
    throw new Error("Namespace name is required");
  }

  let label: string;
  if (!trimmed.includes(".")) {
    label = normalizeNamespaceLabel(trimmed);
  } else if (trimmed.endsWith(`.${parent}`)) {
    label = normalizeNamespaceLabel(trimmed.slice(0, -(parent.length + 1)));
  } else if (trimmed.endsWith(".eth") && !trimmed.slice(0, -4).includes(".")) {
    // Legacy `foo.eth` body — treat as label `foo` under Billie parent.
    label = normalizeNamespaceLabel(trimmed.slice(0, -4));
  } else {
    throw new Error(
      `Name must be a label or end with .${parent} (e.g. alice or alice.${parent})`,
    );
  }

  if (label === parentLabel) {
    throw new Error("Namespace label cannot equal the parent label");
  }

  return { label, name: `${label}.${parent}` };
}

/** @deprecated Prefer resolveNamespaceClaim for parent namespaces. */
export function normalizeDomainName(input: string): string {
  const trimmed = input.trim().toLowerCase();
  if (!trimmed) {
    throw new Error("Domain name is required");
  }

  const withoutEth = trimmed.endsWith(".eth")
    ? trimmed.slice(0, -4)
    : trimmed;

  if (withoutEth.includes(".")) {
    // Allow already-full `label.parent.eth` through for lookups.
    const parts = withoutEth.split(".");
    if (parts.length !== 2) {
      throw new Error("Invalid domain name");
    }
    normalizeNamespaceLabel(parts[0]!);
    normalizeNamespaceLabel(parts[1]!);
    return `${parts[0]}.${parts[1]}.eth`;
  }

  return `${normalizeNamespaceLabel(withoutEth)}.eth`;
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

/** All linked agent namespaces (in-memory). */
export function listLinkedDomains(): LinkedDomain[] {
  return [...byAgentAddress.values()];
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
