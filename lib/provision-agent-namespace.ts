import { type Address, type Hex, zeroAddress } from "viem";
import { checkBillieParentStatus } from "@/lib/billie-parent";
import { consumeDomainClaimSlot } from "@/lib/domain-claim-rate-limit";
import {
  Status,
  createSepoliaPublicClient,
  getRegistryLabelState,
} from "@/lib/ens";
import {
  createBillieSepoliaClients,
  deployUserRegistry,
  grantRootRoles,
  registerName,
  setUserRegistryParent,
} from "@/lib/ens-registry-write";
import {
  AGENT_NAMESPACE_NAME_ROLES,
  AGENT_NAMESPACE_REGISTRAR_ROLES,
  BILLIE_AGENT_REGISTRY_ADMIN_ROLES,
  ROLE_REGISTRAR,
  enhancedAccessControlAbi,
} from "@/lib/ens-roles";

export type ProvisionedNamespace = {
  name: string;
  label: string;
  parentName: string;
  parentRegistry: Address;
  subregistry: Address;
  agentAddress: Address;
  tokenId: string;
  resolver: Address;
  expiry: string;
  /** True when an existing on-chain namespace was re-linked (no new txs). */
  relinked: boolean;
  txs: {
    deploy?: Hex;
    setParent?: Hex;
    grantRegistrar?: Hex;
    register?: Hex;
  };
};

export type ProvisionNamespaceError = {
  code:
    | "parent_not_ready"
    | "label_taken"
    | "owner_mismatch"
    | "namespace_incomplete"
    | "billie_key_missing"
    | "rate_limited"
    | "provision_failed";
  message: string;
  detail?: string;
  limit?: number;
  windowSec?: number;
  count?: number;
  retryAfterSec?: number;
};

export type ProvisionNamespaceResult =
  | { ok: true; namespace: ProvisionedNamespace }
  | { ok: false; error: ProvisionNamespaceError };

/**
 * If `{label}` is already registered under the parent registry and is ready
 * for this agent (owner match + UserRegistry + ROLE_REGISTRAR), return it
 * for in-memory re-link after a service restart.
 */
async function tryRelinkExistingNamespace(input: {
  label: string;
  agentAddress: Address;
  parentName: string;
  parentRegistry: Address;
}): Promise<ProvisionNamespaceResult | null> {
  const existing = await getRegistryLabelState(
    input.parentRegistry,
    input.label,
  );

  if (existing.status !== Status.REGISTERED || !existing.owner) {
    return null;
  }

  if (existing.owner.toLowerCase() !== input.agentAddress.toLowerCase()) {
    return {
      ok: false,
      error: {
        code: "owner_mismatch",
        message: `Namespace label already registered under ${input.parentName} to another owner`,
        detail: existing.owner,
      },
    };
  }

  if (!existing.subregistry) {
    return {
      ok: false,
      error: {
        code: "namespace_incomplete",
        message:
          "Namespace is registered on-chain but has no UserRegistry — cannot re-link for invoices",
        detail: `${input.label}.${input.parentName}`,
      },
    };
  }

  const client = createSepoliaPublicClient();
  let isRegistrar = false;
  try {
    isRegistrar = await client.readContract({
      address: existing.subregistry,
      abi: enhancedAccessControlAbi,
      functionName: "hasRootRoles",
      args: [ROLE_REGISTRAR, input.agentAddress],
    });
  } catch (error) {
    return {
      ok: false,
      error: {
        code: "namespace_incomplete",
        message: "Failed to verify ROLE_REGISTRAR on agent UserRegistry",
        detail: error instanceof Error ? error.message : "Unknown error",
      },
    };
  }

  if (!isRegistrar) {
    return {
      ok: false,
      error: {
        code: "namespace_incomplete",
        message:
          "Namespace UserRegistry exists but agent lacks ROLE_REGISTRAR — cannot issue invoices",
        detail: existing.subregistry,
      },
    };
  }

  return {
    ok: true,
    namespace: {
      name: `${input.label}.${input.parentName}`,
      label: input.label,
      parentName: input.parentName,
      parentRegistry: input.parentRegistry,
      subregistry: existing.subregistry,
      agentAddress: input.agentAddress,
      tokenId: existing.tokenId.toString(),
      resolver: existing.resolver,
      expiry: existing.expiry.toString(),
      relinked: true,
      txs: {},
    },
  };
}

/**
 * Billie provisions `{label}.{parent}.eth`, or re-links an existing ready namespace:
 * 1. Deploy agent UserRegistry (Billie admin)
 * 2. setParent(parentRegistry, label)
 * 3. grant ROLE_REGISTRAR to agent
 * 4. register(label) on parent UserRegistry with agent as owner + subregistry
 */
export async function provisionAgentNamespace(input: {
  label: string;
  agentAddress: Address;
  humanId: string;
}): Promise<ProvisionNamespaceResult> {
  const parent = await checkBillieParentStatus();
  if (!parent.ok || !parent.subregistry || !parent.name || !parent.label) {
    return {
      ok: false,
      error: {
        code: "parent_not_ready",
        message:
          "Billie parent UserRegistry is not ready — check /api/health and run pnpm ops:parent-registry",
        detail: parent.checks
          .filter((c) => !c.ok)
          .map((c) => `${c.id}: ${c.detail ?? "failed"}`)
          .join("; "),
      },
    };
  }

  const parentRegistry = parent.subregistry;
  const relink = await tryRelinkExistingNamespace({
    label: input.label,
    agentAddress: input.agentAddress,
    parentName: parent.name,
    parentRegistry,
  });
  if (relink) {
    return relink;
  }

  const rate = consumeDomainClaimSlot(input.humanId);
  if (!rate.ok) {
    return {
      ok: false,
      error: {
        code: "rate_limited",
        message: `Domain claim rate limit exceeded for this human (${rate.count}/${rate.limit} per ${rate.windowSec}s)`,
        detail: `Retry after ${rate.retryAfterSec}s`,
        limit: rate.limit,
        windowSec: rate.windowSec,
        count: rate.count,
        retryAfterSec: rate.retryAfterSec,
      },
    };
  }

  let clients;
  try {
    clients = createBillieSepoliaClients();
  } catch (error) {
    return {
      ok: false,
      error: {
        code: "billie_key_missing",
        message: "BILLIE_PRIVATE_KEY is required to provision namespaces",
        detail: error instanceof Error ? error.message : undefined,
      },
    };
  }

  const fullName = `${input.label}.${parent.name}`;
  const saltKey = `billie:agent-registry:v1:${parent.label}:${input.label}:${input.agentAddress.toLowerCase()}`;

  const parentExpiry = parent.expiry ? BigInt(parent.expiry) : BigInt(0);
  const oneYear =
    BigInt(Math.floor(Date.now() / 1000)) + BigInt(365 * 24 * 60 * 60);
  const expiry =
    parentExpiry > BigInt(0) && parentExpiry < oneYear ? parentExpiry : oneYear;

  try {
    const { userRegistry, deployTx } = await deployUserRegistry({
      clients,
      admin: clients.account.address,
      adminRoles: BILLIE_AGENT_REGISTRY_ADMIN_ROLES,
      saltKey,
    });

    const setParentTx = await setUserRegistryParent({
      clients,
      userRegistry,
      parentRegistry,
      label: input.label,
    });

    const grantTx = await grantRootRoles({
      clients,
      registry: userRegistry,
      roleBitmap: AGENT_NAMESPACE_REGISTRAR_ROLES,
      account: input.agentAddress,
    });

    const { tx: registerTx, tokenId } = await registerName({
      clients,
      registry: parentRegistry,
      label: input.label,
      owner: input.agentAddress,
      subregistry: userRegistry,
      resolver: zeroAddress,
      roleBitmap: AGENT_NAMESPACE_NAME_ROLES,
      expiry,
    });

    const after = await getRegistryLabelState(parentRegistry, input.label);

    return {
      ok: true,
      namespace: {
        name: fullName,
        label: input.label,
        parentName: parent.name,
        parentRegistry,
        subregistry: userRegistry,
        agentAddress: input.agentAddress,
        tokenId: tokenId.toString(),
        resolver: after.resolver,
        expiry: after.expiry.toString(),
        relinked: false,
        txs: {
          deploy: deployTx,
          setParent: setParentTx,
          grantRegistrar: grantTx,
          register: registerTx,
        },
      },
    };
  } catch (error) {
    return {
      ok: false,
      error: {
        code: "provision_failed",
        message: "Failed to provision agent namespace on-chain",
        detail: error instanceof Error ? error.message : "Unknown error",
      },
    };
  }
}
