import { privateKeyToAccount } from "viem/accounts";
import { normalize } from "viem/ens";
import { type Address } from "viem";
import {
  createSepoliaPublicClient,
  ethLabelFromName,
  getBillieInvoiceResolverAddress,
  getEnsV2OwnerOnSepolia,
  getEthRegistryAddress,
  getEthSubregistry,
  getUserRegistryImplAddress,
  getVerifiableFactoryAddress,
} from "@/lib/ens";
import {
  ROLE_REGISTRAR,
  ROLE_SET_SUBREGISTRY,
  RESOLVER_ROLE_SET_TEXT,
  enhancedAccessControlAbi,
} from "@/lib/ens-roles";

export type ParentCheckId =
  | "env_configured"
  | "name_registered"
  | "owner_matches_billie"
  | "subregistry_attached"
  | "billie_is_registrar"
  | "billie_can_set_subregistry"
  | "invoice_resolver_configured"
  | "billie_can_set_invoice_text";

export type ParentCheck = {
  id: ParentCheckId;
  ok: boolean;
  detail?: string;
};

export type BillieParentStatus = {
  ok: boolean;
  name: string | null;
  label: string | null;
  billieAddress: Address | null;
  owner: Address | null;
  tokenId: string | null;
  resource: string | null;
  expiry: string | null;
  subregistry: Address | null;
  invoiceResolver: Address | null;
  ethRegistry: Address;
  verifiableFactory: Address;
  userRegistryImpl: Address;
  canProvisionAgents: boolean;
  canWriteInvoiceTexts: boolean;
  checks: ParentCheck[];
};

function getBillieAddressFromEnv(): Address | null {
  const key = process.env.BILLIE_PRIVATE_KEY as `0x${string}` | undefined;
  if (!key) return null;
  try {
    return privateKeyToAccount(key).address;
  } catch {
    return null;
  }
}

/** Normalize BILLIE_PARENT_NAME to `label.eth` (label only also accepted). */
export function getBillieParentName(): string | null {
  const raw = process.env.BILLIE_PARENT_NAME?.trim();
  if (!raw) return null;
  try {
    const withTld = raw.includes(".") ? raw : `${raw}.eth`;
    const normalized = normalize(withTld);
    ethLabelFromName(normalized);
    return normalized;
  } catch {
    return null;
  }
}

/**
 * Readiness of Billie's parent ENSv2 name + UserRegistry for agent namespaces.
 * Source of truth is on-chain; used by /api/health and ops scripts.
 */
export async function checkBillieParentStatus(): Promise<BillieParentStatus> {
  const ethRegistry = getEthRegistryAddress();
  const verifiableFactory = getVerifiableFactoryAddress();
  const userRegistryImpl = getUserRegistryImplAddress();
  const checks: ParentCheck[] = [];

  const billieAddress = getBillieAddressFromEnv();
  const name = getBillieParentName();

  const base: BillieParentStatus = {
    ok: false,
    name,
    label: null,
    billieAddress,
    owner: null,
    tokenId: null,
    resource: null,
    expiry: null,
    subregistry: null,
    invoiceResolver: getBillieInvoiceResolverAddress(),
    ethRegistry,
    verifiableFactory,
    userRegistryImpl,
    canProvisionAgents: false,
    canWriteInvoiceTexts: false,
    checks,
  };

  if (!billieAddress || !name) {
    checks.push({
      id: "env_configured",
      ok: false,
      detail: !billieAddress
        ? "BILLIE_PRIVATE_KEY missing or invalid"
        : "BILLIE_PARENT_NAME missing or invalid (expected label.eth)",
    });
    return await finish(base, checks);
  }

  checks.push({ id: "env_configured", ok: true });

  let label: string;
  try {
    label = ethLabelFromName(name);
  } catch (error) {
    checks.push({
      id: "name_registered",
      ok: false,
      detail: error instanceof Error ? error.message : "Invalid parent name",
    });
    return await finish({ ...base, name }, checks);
  }

  base.label = label;

  try {
    const state = await getEnsV2OwnerOnSepolia(name);
    base.owner = state.owner;
    base.tokenId = state.tokenId.toString();
    base.resource = state.resource.toString();
    base.expiry = state.expiry.toString();

    if (!state.owner) {
      checks.push({
        id: "name_registered",
        ok: false,
        detail: `Not registered on ETHRegistry (${ethRegistry})`,
      });
      return await finish(base, checks);
    }

    checks.push({ id: "name_registered", ok: true });

    const ownerMatches =
      state.owner.toLowerCase() === billieAddress.toLowerCase();
    checks.push({
      id: "owner_matches_billie",
      ok: ownerMatches,
      detail: ownerMatches
        ? undefined
        : `On-chain owner ${state.owner} ≠ BILLIE_PRIVATE_KEY ${billieAddress}`,
    });

    const client = createSepoliaPublicClient();

    let canSetSubregistry = false;
    try {
      canSetSubregistry = await client.readContract({
        address: ethRegistry,
        abi: enhancedAccessControlAbi,
        functionName: "hasRoles",
        args: [state.resource, ROLE_SET_SUBREGISTRY, billieAddress],
      });
      checks.push({
        id: "billie_can_set_subregistry",
        ok: canSetSubregistry,
        detail: canSetSubregistry
          ? undefined
          : "Billie lacks ROLE_SET_SUBREGISTRY on parent name (needed to attach UserRegistry)",
      });
    } catch (error) {
      checks.push({
        id: "billie_can_set_subregistry",
        ok: false,
        detail:
          error instanceof Error
            ? error.message
            : "Failed to read ROLE_SET_SUBREGISTRY",
      });
    }

    const subregistry = await getEthSubregistry(label);
    base.subregistry = subregistry;

    if (!subregistry) {
      checks.push({
        id: "subregistry_attached",
        ok: false,
        detail: "No UserRegistry attached — run pnpm ops:parent-registry",
      });
      checks.push({
        id: "billie_is_registrar",
        ok: false,
        detail: "Skipped — no subregistry",
      });
      return await finish(base, checks);
    }

    checks.push({ id: "subregistry_attached", ok: true });

    try {
      const isRegistrar = await client.readContract({
        address: subregistry,
        abi: enhancedAccessControlAbi,
        functionName: "hasRootRoles",
        args: [ROLE_REGISTRAR, billieAddress],
      });
      checks.push({
        id: "billie_is_registrar",
        ok: isRegistrar,
        detail: isRegistrar
          ? undefined
          : `Billie lacks ROLE_REGISTRAR on UserRegistry ${subregistry}`,
      });
    } catch (error) {
      checks.push({
        id: "billie_is_registrar",
        ok: false,
        detail:
          error instanceof Error
            ? error.message
            : "Failed to read ROLE_REGISTRAR on subregistry",
      });
    }

    return await finish(base, checks);
  } catch (error) {
    checks.push({
      id: "name_registered",
      ok: false,
      detail: error instanceof Error ? error.message : "RPC lookup failed",
    });
    return await finish(base, checks);
  }
}

async function finish(
  base: BillieParentStatus,
  checks: ParentCheck[],
): Promise<BillieParentStatus> {
  const invoiceResolver = getBillieInvoiceResolverAddress();
  base.invoiceResolver = invoiceResolver;

  if (!invoiceResolver || !base.billieAddress) {
    checks.push({
      id: "invoice_resolver_configured",
      ok: false,
      detail: invoiceResolver
        ? "Billie address missing"
        : "BILLIE_INVOICE_RESOLVER missing — run pnpm ops:invoice-resolver",
    });
    checks.push({
      id: "billie_can_set_invoice_text",
      ok: false,
      detail: "Skipped — invoice resolver not ready",
    });
  } else {
    checks.push({ id: "invoice_resolver_configured", ok: true });
    try {
      const client = createSepoliaPublicClient();
      const canSetText = await client.readContract({
        address: invoiceResolver,
        abi: enhancedAccessControlAbi,
        functionName: "hasRootRoles",
        args: [RESOLVER_ROLE_SET_TEXT, base.billieAddress],
      });
      checks.push({
        id: "billie_can_set_invoice_text",
        ok: canSetText,
        detail: canSetText
          ? undefined
          : `Billie lacks ROLE_SET_TEXT on invoice resolver ${invoiceResolver}`,
      });
    } catch (error) {
      checks.push({
        id: "billie_can_set_invoice_text",
        ok: false,
        detail:
          error instanceof Error
            ? error.message
            : "Failed to read ROLE_SET_TEXT on invoice resolver",
      });
    }
  }

  const required: ParentCheckId[] = [
    "env_configured",
    "name_registered",
    "owner_matches_billie",
    "subregistry_attached",
    "billie_is_registrar",
  ];
  const byId = new Map(checks.map((c) => [c.id, c]));
  const ok = required.every((id) => byId.get(id)?.ok === true);
  const canWriteInvoiceTexts =
    byId.get("invoice_resolver_configured")?.ok === true &&
    byId.get("billie_can_set_invoice_text")?.ok === true;

  return {
    ...base,
    checks,
    ok,
    canProvisionAgents: ok,
    canWriteInvoiceTexts,
  };
}
