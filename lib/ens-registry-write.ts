/**
 * Shared ENSv2 write helpers for Billie-operated registry provisioning.
 */
import {
  createPublicClient,
  createWalletClient,
  encodeFunctionData,
  http,
  keccak256,
  parseEventLogs,
  stringToHex,
  type Account,
  type Address,
  type Hex,
  type PublicClient,
  type WalletClient,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { sepolia } from "viem/chains";
import {
  getRegistryLabelState,
  getUserRegistryImplAddress,
  getVerifiableFactoryAddress,
} from "@/lib/ens";

export const verifiableFactoryAbi = [
  {
    type: "function",
    name: "deployProxy",
    stateMutability: "nonpayable",
    inputs: [
      { name: "implementation", type: "address" },
      { name: "salt", type: "uint256" },
      { name: "data", type: "bytes" },
    ],
    outputs: [{ name: "proxy", type: "address" }],
  },
  {
    type: "event",
    name: "ProxyDeployed",
    inputs: [
      { name: "sender", type: "address", indexed: true },
      { name: "proxyAddress", type: "address", indexed: true },
      { name: "salt", type: "uint256", indexed: false },
      { name: "implementation", type: "address", indexed: false },
    ],
  },
] as const;

export const userRegistryWriteAbi = [
  {
    type: "function",
    name: "initialize",
    stateMutability: "nonpayable",
    inputs: [
      { name: "admin", type: "address" },
      { name: "roleBitmap", type: "uint256" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "setParent",
    stateMutability: "nonpayable",
    inputs: [
      { name: "parent", type: "address" },
      { name: "label", type: "string" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "getParent",
    stateMutability: "view",
    inputs: [],
    outputs: [
      { name: "parent", type: "address" },
      { name: "label", type: "string" },
    ],
  },
  {
    type: "function",
    name: "register",
    stateMutability: "nonpayable",
    inputs: [
      { name: "label", type: "string" },
      { name: "owner", type: "address" },
      { name: "registry", type: "address" },
      { name: "resolver", type: "address" },
      { name: "roleBitmap", type: "uint256" },
      { name: "expiry", type: "uint64" },
    ],
    outputs: [{ name: "tokenId", type: "uint256" }],
  },
  {
    type: "function",
    name: "grantRootRoles",
    stateMutability: "nonpayable",
    inputs: [
      { name: "roleBitmap", type: "uint256" },
      { name: "account", type: "address" },
    ],
    outputs: [{ type: "bool" }],
  },
] as const;

/** Floor + 2× estimate — flaky public RPCs sometimes under-estimate and OOG. */
const MIN_WRITE_GAS = BigInt(200_000);

export async function writeContractBuffered(
  clients: BillieSepoliaClients,
  params: {
    address: Address;
    abi: typeof verifiableFactoryAbi | typeof userRegistryWriteAbi | readonly unknown[];
    functionName: string;
    args: readonly unknown[];
  },
): Promise<Hex> {
  const base = {
    address: params.address,
    abi: params.abi as typeof userRegistryWriteAbi,
    functionName: params.functionName as "setParent",
    args: params.args as never,
    account: clients.account,
    chain: sepolia,
  };

  let gas = MIN_WRITE_GAS;
  try {
    const estimated = await clients.publicClient.estimateContractGas(base);
    const buffered = estimated * BigInt(2);
    gas = buffered > MIN_WRITE_GAS ? buffered : MIN_WRITE_GAS;
  } catch {
    // Keep floor when estimate reverts or RPC is flaky.
  }

  return clients.walletClient.writeContract({ ...base, gas });
}

/** Find a prior VerifiableFactory ProxyDeployed for this deployer + saltKey. */
export async function findDeployedUserRegistry(input: {
  publicClient: PublicClient;
  deployer: Address;
  saltKey: string;
}): Promise<Address | null> {
  const fromEnv = process.env.BILLIE_PARENT_USER_REGISTRY?.trim();
  if (fromEnv?.startsWith("0x") && fromEnv.length === 42) {
    const code = await input.publicClient.getCode({
      address: fromEnv as Address,
    });
    if (code && code !== "0x") {
      return fromEnv as Address;
    }
  }

  const factory = getVerifiableFactoryAddress();
  const salt = BigInt(keccak256(stringToHex(input.saltKey)));

  const tryRange = async (fromBlock: bigint) => {
    const logs = await input.publicClient.getContractEvents({
      address: factory,
      abi: verifiableFactoryAbi,
      eventName: "ProxyDeployed",
      args: { sender: input.deployer },
      fromBlock,
      toBlock: "latest",
    });
    for (let i = logs.length - 1; i >= 0; i--) {
      const log = logs[i];
      if (log.args.salt === salt && log.args.proxyAddress) {
        return log.args.proxyAddress as Address;
      }
    }
    return null;
  };

  try {
    const found = await tryRange(BigInt(0));
    if (found) return found;
  } catch {
    // Public RPCs often reject eth_getLogs from genesis — fall back to a recent window.
  }

  try {
    const latest = await input.publicClient.getBlockNumber();
    const window = BigInt(200_000);
    const fromBlock = latest > window ? latest - window : BigInt(0);
    return await tryRange(fromBlock);
  } catch {
    return null;
  }
}

export type BillieSepoliaClients = {
  account: Account;
  publicClient: PublicClient;
  walletClient: WalletClient;
};

export function requireBillieAccount(): Account {
  const key = process.env.BILLIE_PRIVATE_KEY as `0x${string}` | undefined;
  if (!key) {
    throw new Error("BILLIE_PRIVATE_KEY is required");
  }
  return privateKeyToAccount(key);
}

export function createBillieSepoliaClients(): BillieSepoliaClients {
  const account = requireBillieAccount();
  const transport = http(process.env.ETHEREUM_SEPOLIA_RPC_URL);
  const publicClient = createPublicClient({
    chain: sepolia,
    transport,
  });
  const walletClient = createWalletClient({
    account,
    chain: sepolia,
    transport,
  });
  return { account, publicClient, walletClient };
}

export async function waitSuccess(
  publicClient: PublicClient,
  hash: Hex,
  label: string,
): Promise<void> {
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") {
    throw new Error(`${label} reverted (${hash})`);
  }
}

/** Deploy a UserRegistry proxy; admin receives `adminRoles` at initialize. */
export async function deployUserRegistry(input: {
  clients: BillieSepoliaClients;
  admin: Address;
  adminRoles: bigint;
  saltKey: string;
}): Promise<{ userRegistry: Address; deployTx: Hex }> {
  const { clients, admin, adminRoles, saltKey } = input;
  const factory = getVerifiableFactoryAddress();
  const impl = getUserRegistryImplAddress();
  const salt = BigInt(keccak256(stringToHex(saltKey)));
  const initData = encodeFunctionData({
    abi: userRegistryWriteAbi,
    functionName: "initialize",
    args: [admin, adminRoles],
  });

  const existing = await findDeployedUserRegistry({
    publicClient: clients.publicClient,
    deployer: admin,
    saltKey,
  });
  if (existing) {
    return { userRegistry: existing, deployTx: "0x" as Hex };
  }

  const deployTx = await writeContractBuffered(clients, {
    address: factory,
    abi: verifiableFactoryAbi,
    functionName: "deployProxy",
    args: [impl, salt, initData],
  });

  const receipt = await clients.publicClient.waitForTransactionReceipt({
    hash: deployTx,
  });
  if (receipt.status !== "success") {
    const recovered = await findDeployedUserRegistry({
      publicClient: clients.publicClient,
      deployer: admin,
      saltKey,
    });
    if (recovered) {
      return { userRegistry: recovered, deployTx };
    }
    throw new Error(`deployProxy reverted (${deployTx})`);
  }

  const deployed = parseEventLogs({
    abi: verifiableFactoryAbi,
    eventName: "ProxyDeployed",
    logs: receipt.logs,
  });
  const userRegistry = deployed[0]?.args.proxyAddress as Address | undefined;
  if (!userRegistry) {
    throw new Error(`ProxyDeployed event missing (${deployTx})`);
  }

  return { userRegistry, deployTx };
}

export async function setUserRegistryParent(input: {
  clients: BillieSepoliaClients;
  userRegistry: Address;
  parentRegistry: Address;
  label: string;
}): Promise<Hex> {
  const hash = await writeContractBuffered(input.clients, {
    address: input.userRegistry,
    abi: userRegistryWriteAbi,
    functionName: "setParent",
    args: [input.parentRegistry, input.label],
  });
  await waitSuccess(input.clients.publicClient, hash, "setParent");
  return hash;
}

export async function grantRootRoles(input: {
  clients: BillieSepoliaClients;
  registry: Address;
  roleBitmap: bigint;
  account: Address;
}): Promise<Hex> {
  const hash = await writeContractBuffered(input.clients, {
    address: input.registry,
    abi: userRegistryWriteAbi,
    functionName: "grantRootRoles",
    args: [input.roleBitmap, input.account],
  });
  await waitSuccess(input.clients.publicClient, hash, "grantRootRoles");
  return hash;
}

export async function registerName(input: {
  clients: BillieSepoliaClients;
  registry: Address;
  label: string;
  owner: Address;
  subregistry: Address;
  resolver?: Address;
  roleBitmap: bigint;
  expiry: bigint;
}): Promise<{ tx: Hex; tokenId: bigint }> {
  const hash = await writeContractBuffered(input.clients, {
    address: input.registry,
    abi: userRegistryWriteAbi,
    functionName: "register",
    args: [
      input.label,
      input.owner,
      input.subregistry,
      input.resolver ?? "0x0000000000000000000000000000000000000000",
      input.roleBitmap,
      input.expiry,
    ],
  });
  await waitSuccess(input.clients.publicClient, hash, "register");

  const state = await getRegistryLabelState(input.registry, input.label);
  return { tx: hash, tokenId: state.tokenId };
}
