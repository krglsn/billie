import { getDb } from "@/lib/db";

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

type DomainRow = {
  name: string;
  label: string;
  parent_name: string;
  agent_address: string;
  human_id: string;
  chain_id: string;
  ens_owner: string;
  protocol: string;
  token_id: string;
  resolver: string;
  subregistry: string;
  linked_at: string;
};

function normalizeAddress(address: string): string {
  return address.toLowerCase();
}

function rowToDomain(row: DomainRow): LinkedDomain {
  return {
    name: row.name,
    label: row.label,
    parentName: row.parent_name,
    agentAddress: row.agent_address,
    humanId: row.human_id,
    chainId: row.chain_id as LinkedDomain["chainId"],
    ensOwner: row.ens_owner,
    protocol: row.protocol as LinkedDomain["protocol"],
    tokenId: row.token_id,
    resolver: row.resolver,
    subregistry: row.subregistry,
    linkedAt: row.linked_at,
  };
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
  const row = getDb()
    .prepare("SELECT * FROM linked_domains WHERE name = ?")
    .get(name.toLowerCase()) as DomainRow | undefined;
  return row ? rowToDomain(row) : undefined;
}

export function isDomainLinked(name: string): boolean {
  return getLinkedDomain(name) !== undefined;
}

export function getLinkedDomainByAgent(
  agentAddress: string,
): LinkedDomain | undefined {
  const row = getDb()
    .prepare("SELECT * FROM linked_domains WHERE agent_address = ?")
    .get(normalizeAddress(agentAddress)) as DomainRow | undefined;
  return row ? rowToDomain(row) : undefined;
}

/**
 * Resolve a namespace request against the agent's linked record.
 * Accepts label (`alice`), full name (`alice.parent.eth`), or legacy forms.
 * Returns null if the request does not match the linked namespace.
 */
export function matchLinkedNamespace(
  linked: LinkedDomain,
  requested: string,
): LinkedDomain | null {
  const trimmed = requested.trim().toLowerCase();
  if (!trimmed) return null;

  if (!trimmed.includes(".")) {
    try {
      return normalizeNamespaceLabel(trimmed) === linked.label ? linked : null;
    } catch {
      return null;
    }
  }

  try {
    const resolved = resolveNamespaceClaim(trimmed, linked.parentName);
    return resolved.name === linked.name ? linked : null;
  } catch {
    return null;
  }
}

export function getLinkedDomainsByHuman(humanId: string): LinkedDomain[] {
  const rows = getDb()
    .prepare("SELECT * FROM linked_domains WHERE human_id = ?")
    .all(humanId) as DomainRow[];
  return rows.map(rowToDomain);
}

/** All linked agent namespaces. */
export function listLinkedDomains(): LinkedDomain[] {
  const rows = getDb()
    .prepare("SELECT * FROM linked_domains ORDER BY linked_at ASC")
    .all() as DomainRow[];
  return rows.map(rowToDomain);
}

/**
 * Snapshot of the nested mapping humanId → agentAddress → domain name.
 */
export function getHumanAgentDomainMap(): Record<
  string,
  Record<string, string>
> {
  const out: Record<string, Record<string, string>> = {};
  for (const record of listLinkedDomains()) {
    if (!out[record.humanId]) out[record.humanId] = {};
    out[record.humanId]![record.agentAddress] = record.name;
  }
  return out;
}

export function linkDomain(
  input: Omit<LinkedDomain, "linkedAt">,
): LinkedDomain {
  const agentKey = normalizeAddress(input.agentAddress);
  const name = input.name.toLowerCase();

  if (getLinkedDomain(name)) {
    throw new Error("Domain is already registered on Billie");
  }

  if (getLinkedDomainByAgent(agentKey)) {
    throw new Error("Agent already has a linked domain on Billie");
  }

  const record: LinkedDomain = {
    ...input,
    name,
    agentAddress: agentKey,
    linkedAt: new Date().toISOString(),
  };

  try {
    getDb()
      .prepare(
        `INSERT INTO linked_domains (
          name, label, parent_name, agent_address, human_id, chain_id,
          ens_owner, protocol, token_id, resolver, subregistry, linked_at
        ) VALUES (
          @name, @label, @parentName, @agentAddress, @humanId, @chainId,
          @ensOwner, @protocol, @tokenId, @resolver, @subregistry, @linkedAt
        )`,
      )
      .run(record);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("UNIQUE") || message.includes("unique")) {
      throw new Error("Domain is already registered on Billie");
    }
    throw error;
  }

  return record;
}
