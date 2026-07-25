import { type Address, type Hex, zeroAddress } from "viem";
import { checkBillieParentStatus } from "@/lib/billie-parent";
import { Status, getRegistryLabelState } from "@/lib/ens";
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
  txs: {
    deploy: Hex;
    setParent: Hex;
    grantRegistrar: Hex;
    register: Hex;
  };
};

export type ProvisionNamespaceError = {
  code:
    | "parent_not_ready"
    | "label_taken"
    | "billie_key_missing"
    | "provision_failed";
  message: string;
  detail?: string;
};

export type ProvisionNamespaceResult =
  | { ok: true; namespace: ProvisionedNamespace }
  | { ok: false; error: ProvisionNamespaceError };

/**
 * Billie provisions `{label}.{parent}.eth`:
 * 1. Deploy agent UserRegistry (Billie admin)
 * 2. setParent(parentRegistry, label)
 * 3. grant ROLE_REGISTRAR to agent
 * 4. register(label) on parent UserRegistry with agent as owner + subregistry
 */
export async function provisionAgentNamespace(input: {
  label: string;
  agentAddress: Address;
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
  const existing = await getRegistryLabelState(parentRegistry, input.label);
  if (existing.status === Status.REGISTERED || existing.owner) {
    return {
      ok: false,
      error: {
        code: "label_taken",
        message: `Namespace label already registered under ${parent.name}`,
        detail: existing.owner ?? undefined,
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
