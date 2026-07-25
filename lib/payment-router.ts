/**
 * Billie PaymentRouter — ABI + helpers for settle / status.
 */
import {
  encodeFunctionData,
  getAddress,
  isAddress,
  namehash,
  type Address,
  type Hex,
} from "viem";
import {
  createSepoliaPublicClient,
  getBillieInvoiceResolverAddress,
} from "@/lib/ens";
import { INVOICE_TEXT_KEYS } from "@/lib/invoice-texts";

const ROUTER_READ_ATTEMPTS = 4;
const ROUTER_READ_BASE_DELAY_MS = 250;

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

/** Retry flaky Sepolia eth_call / RPC errors. */
async function withRpcRetry<T>(fn: () => Promise<T>): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt < ROUTER_READ_ATTEMPTS; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (attempt === ROUTER_READ_ATTEMPTS - 1) break;
      await sleep(ROUTER_READ_BASE_DELAY_MS * 2 ** attempt);
    }
  }
  throw lastError;
}

export const paymentRouterAbi = [
  {
    type: "constructor",
    inputs: [{ name: "invoiceResolver_", type: "address" }],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "paid",
    stateMutability: "view",
    inputs: [{ name: "node", type: "bytes32" }],
    outputs: [{ type: "bool" }],
  },
  {
    type: "function",
    name: "checkInvoice",
    stateMutability: "view",
    inputs: [{ name: "node", type: "bytes32" }],
    outputs: [
      { name: "payable_", type: "bool" },
      { name: "token", type: "address" },
      { name: "paymentAddress", type: "address" },
      { name: "amount", type: "uint256" },
      { name: "status", type: "string" },
      { name: "reason", type: "string" },
    ],
  },
  {
    type: "function",
    name: "payInvoice",
    stateMutability: "nonpayable",
    inputs: [{ name: "node", type: "bytes32" }],
    outputs: [],
  },
  {
    type: "function",
    name: "invoiceResolver",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "address" }],
  },
  {
    type: "function",
    name: "owner",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "address" }],
  },
  {
    type: "event",
    name: "InvoicePaid",
    inputs: [
      { name: "node", type: "bytes32", indexed: true },
      { name: "invoiceId", type: "string", indexed: false },
      { name: "payer", type: "address", indexed: true },
      { name: "token", type: "address", indexed: false },
      { name: "paymentAddress", type: "address", indexed: false },
      { name: "amount", type: "uint256", indexed: false },
    ],
  },
] as const;

export const erc20ApproveAbi = [
  {
    type: "function",
    name: "approve",
    stateMutability: "nonpayable",
    inputs: [
      { name: "spender", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ type: "bool" }],
  },
  {
    type: "function",
    name: "allowance",
    stateMutability: "view",
    inputs: [
      { name: "owner", type: "address" },
      { name: "spender", type: "address" },
    ],
    outputs: [{ type: "uint256" }],
  },
] as const;

export function getBilliePaymentRouterAddress(): Address | null {
  const raw = process.env.BILLIE_PAYMENT_ROUTER?.trim();
  if (!raw || !/^0x[0-9a-fA-F]{40}$/.test(raw)) return null;
  return getAddress(raw);
}

/** Atomic amount string: non-empty decimal digits only. */
export function normalizeAtomicAmount(input: string): string {
  const trimmed = input.trim();
  if (!/^\d+$/.test(trimmed)) {
    throw new Error(
      "amount must be an atomic integer string (e.g. \"1000000\" for 1 USDC)",
    );
  }
  if (trimmed === "0" || /^0\d+$/.test(trimmed)) {
    throw new Error("amount must be a positive integer without leading zeros");
  }
  return trimmed;
}

export function normalizeEvmAddress(
  input: string,
  field: string,
): Address {
  const trimmed = input.trim();
  if (!isAddress(trimmed)) {
    throw new Error(`Invalid ${field}: expected 0x-prefixed address`);
  }
  return getAddress(trimmed);
}

export type RouterCheckResult = {
  payable: boolean;
  token: Address;
  paymentAddress: Address;
  amount: string;
  ensStatus: string;
  reason: string;
  paidOnRouter: boolean;
};

export async function readRouterPaid(node: Hex): Promise<boolean | null> {
  const router = getBilliePaymentRouterAddress();
  if (!router) return null;
  return withRpcRetry(async () => {
    const client = createSepoliaPublicClient();
    return client.readContract({
      address: router,
      abi: paymentRouterAbi,
      functionName: "paid",
      args: [node],
    });
  });
}

export async function checkInvoiceOnRouter(
  node: Hex,
): Promise<RouterCheckResult | null> {
  const router = getBilliePaymentRouterAddress();
  if (!router) return null;
  return withRpcRetry(async () => {
    const client = createSepoliaPublicClient();
    const [payable_, token, paymentAddress, amount, status, reason] =
      await client.readContract({
        address: router,
        abi: paymentRouterAbi,
        functionName: "checkInvoice",
        args: [node],
      });
    const paidOnRouter = await client.readContract({
      address: router,
      abi: paymentRouterAbi,
      functionName: "paid",
      args: [node],
    });
    return {
      payable: payable_,
      token,
      paymentAddress,
      amount: amount.toString(),
      ensStatus: status,
      reason,
      paidOnRouter,
    };
  });
}

/** Computed payment status for API responses. */
export function computePaymentStatus(input: {
  paidOnRouter: boolean | null;
  ensStatus?: string;
}): "paid" | "open" | "cancelled" | "rejected" | string {
  if (input.paidOnRouter) return "paid";
  const ens = (input.ensStatus ?? "open").trim() || "open";
  return ens;
}

export function buildPayCalldata(node: Hex): Hex {
  return encodeFunctionData({
    abi: paymentRouterAbi,
    functionName: "payInvoice",
    args: [node],
  });
}

export function buildApproveCalldata(input: {
  spender: Address;
  amount: bigint;
}): Hex {
  return encodeFunctionData({
    abi: erc20ApproveAbi,
    functionName: "approve",
    args: [input.spender, input.amount],
  });
}

export function invoiceNode(fullName: string): Hex {
  return namehash(fullName.trim().toLowerCase());
}

export function settlementFieldsFromTexts(texts: Record<string, string | undefined>): {
  token?: string;
  paymentAddress?: string;
  amount?: string;
  status?: string;
  currency?: string;
  invoiceId?: string;
} {
  return {
    token: texts[INVOICE_TEXT_KEYS.token],
    paymentAddress: texts[INVOICE_TEXT_KEYS.paymentAddress],
    amount: texts[INVOICE_TEXT_KEYS.amount],
    status: texts[INVOICE_TEXT_KEYS.status],
    currency: texts[INVOICE_TEXT_KEYS.currency],
    invoiceId: texts[INVOICE_TEXT_KEYS.invoiceId],
  };
}

export function assertPaymentRouterConfigured(): Address {
  const router = getBilliePaymentRouterAddress();
  if (!router) {
    throw new Error(
      "BILLIE_PAYMENT_ROUTER is not set — run pnpm ops:payment-router",
    );
  }
  const resolver = getBillieInvoiceResolverAddress();
  if (!resolver) {
    throw new Error(
      "BILLIE_INVOICE_RESOLVER is not set — run pnpm ops:invoice-resolver",
    );
  }
  return router;
}
