/**
 * ENSv2 RegistryRolesLib bitmaps (nybble-packed EAC).
 * Matches ensdomains/contracts-v2 main / Sepolia 20260630 deployment.
 */
export const ROOT_RESOURCE = BigInt(0);

export const ROLE_REGISTRAR = BigInt(1) << BigInt(0);
export const ROLE_REGISTRAR_ADMIN = ROLE_REGISTRAR << BigInt(128);
export const ROLE_REGISTER_RESERVED = BigInt(1) << BigInt(4);
export const ROLE_REGISTER_RESERVED_ADMIN =
  ROLE_REGISTER_RESERVED << BigInt(128);
export const ROLE_SET_PARENT = BigInt(1) << BigInt(8);
export const ROLE_SET_PARENT_ADMIN = ROLE_SET_PARENT << BigInt(128);
export const ROLE_UNREGISTER = BigInt(1) << BigInt(12);
export const ROLE_UNREGISTER_ADMIN = ROLE_UNREGISTER << BigInt(128);
export const ROLE_RENEW = BigInt(1) << BigInt(16);
export const ROLE_RENEW_ADMIN = ROLE_RENEW << BigInt(128);
export const ROLE_SET_SUBREGISTRY = BigInt(1) << BigInt(20);
export const ROLE_SET_SUBREGISTRY_ADMIN = ROLE_SET_SUBREGISTRY << BigInt(128);
export const ROLE_SET_RESOLVER = BigInt(1) << BigInt(24);
export const ROLE_SET_RESOLVER_ADMIN = ROLE_SET_RESOLVER << BigInt(128);
export const ROLE_UPGRADE = BigInt(1) << BigInt(124);
export const ROLE_UPGRADE_ADMIN = ROLE_UPGRADE << BigInt(128);

/** Roles granted to Billie when deploying the parent UserRegistry. */
export const BILLIE_PARENT_REGISTRY_ROLES =
  ROLE_REGISTRAR |
  ROLE_REGISTRAR_ADMIN |
  ROLE_SET_PARENT |
  ROLE_SET_PARENT_ADMIN |
  ROLE_UPGRADE |
  ROLE_UPGRADE_ADMIN;

export const enhancedAccessControlAbi = [
  {
    type: "function",
    name: "hasRootRoles",
    stateMutability: "view",
    inputs: [
      { name: "roleBitmap", type: "uint256" },
      { name: "account", type: "address" },
    ],
    outputs: [{ type: "bool" }],
  },
  {
    type: "function",
    name: "hasRoles",
    stateMutability: "view",
    inputs: [
      { name: "resource", type: "uint256" },
      { name: "roleBitmap", type: "uint256" },
      { name: "account", type: "address" },
    ],
    outputs: [{ type: "bool" }],
  },
  {
    type: "function",
    name: "roles",
    stateMutability: "view",
    inputs: [
      { name: "resource", type: "uint256" },
      { name: "account", type: "address" },
    ],
    outputs: [{ type: "uint256" }],
  },
] as const;
