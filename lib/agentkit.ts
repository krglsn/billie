import { randomBytes } from "crypto";
import { NextResponse } from "next/server";
import {
  AGENTKIT,
  buildAgentkitSchema,
  parseAgentkitHeader,
  validateAgentkitMessage,
  verifyAgentkitSignature,
} from "@worldcoin/agentkit";
import { lookupHumanId } from "@/lib/agentbook";

const WORLD_CHAIN = "eip155:480";
const BASE = "eip155:8453";
const ETHEREUM_SEPOLIA = "eip155:11155111";

const SUPPORTED_NETWORKS = [BASE, ETHEREUM_SEPOLIA, WORLD_CHAIN] as const;

export type HumanBackedAgent = {
  address: string;
  humanId: string;
};

type ChallengeInfo = {
  domain: string;
  uri: string;
  version: string;
  nonce: string;
  issuedAt: string;
  resources: string[];
  statement?: string;
  expirationTime?: string;
};

function getSignatureTypes(network: string): Array<"eip191" | "eip1271"> {
  return network.startsWith("eip155:") ? ["eip191", "eip1271"] : [];
}

function resourceUrl(request: Request): string {
  return new URL(request.url).toString();
}

function buildAgentkitChallenge(request: Request) {
  const uri = resourceUrl(request);
  const domain = new URL(uri).hostname;
  const nonce = randomBytes(16).toString("hex");
  const issuedAt = new Date().toISOString();

  const info: ChallengeInfo = {
    domain,
    uri,
    version: "1",
    nonce,
    issuedAt,
    resources: [uri],
    statement: "Verify your agent is backed by a real human to use Billie",
  };

  const supportedChains = SUPPORTED_NETWORKS.flatMap((network) =>
    getSignatureTypes(network).map((type) => ({
      chainId: network,
      type,
    })),
  );

  return {
    info,
    supportedChains,
    schema: buildAgentkitSchema(),
    mode: { type: "free" as const },
  };
}

export function paymentRequiredResponse(request: Request): NextResponse {
  const body = {
    x402Version: 2,
    error: "AgentKit verification required",
    accepts: [],
    extensions: {
      [AGENTKIT]: buildAgentkitChallenge(request),
    },
  };

  return NextResponse.json(body, { status: 402 });
}

/**
 * Require a human-backed AgentKit agent on the request.
 * Returns a 402 challenge when the agentkit header is missing,
 * or a NextResponse error when verification fails.
 */
export async function requireHumanBackedAgent(
  request: Request,
): Promise<HumanBackedAgent | NextResponse> {
  const header =
    request.headers.get(AGENTKIT) ?? request.headers.get(AGENTKIT.toLowerCase());

  if (!header) {
    return paymentRequiredResponse(request);
  }

  try {
    const payload = parseAgentkitHeader(header);
    const validation = await validateAgentkitMessage(payload, resourceUrl(request));
    if (!validation.valid) {
      return NextResponse.json(
        { error: "Invalid AgentKit message", detail: validation.error },
        { status: 401 },
      );
    }

    const verification = await verifyAgentkitSignature(
      payload,
      process.env.AGENTKIT_RPC_URL,
    );
    if (!verification.valid || !verification.address) {
      return NextResponse.json(
        { error: "Invalid AgentKit signature", detail: verification.error },
        { status: 401 },
      );
    }

    const lookup = await lookupHumanId(verification.address);
    if (!lookup.ok) {
      if (lookup.reason === "lookup_failed") {
        return NextResponse.json(
          {
            error: "Failed to look up agent in AgentBook",
            address: verification.address,
            detail: lookup.detail,
          },
          { status: 502 },
        );
      }
      return NextResponse.json(
        {
          error: "Agent is not registered in AgentBook",
          address: verification.address,
        },
        { status: 403 },
      );
    }

    return {
      address: verification.address,
      humanId: lookup.humanId,
    };
  } catch (error) {
    return NextResponse.json(
      {
        error: "AgentKit verification failed",
        detail: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 401 },
    );
  }
}

export function isNextResponse(
  value: HumanBackedAgent | NextResponse,
): value is NextResponse {
  return value instanceof Response;
}
