/**
 * In-memory rate limit for Billie-paid namespace provisions, keyed by humanId.
 *
 * Env:
 *   BILLIE_DOMAIN_CLAIM_RATE_LIMIT — max new provisions per window (0/unset = disabled)
 *   BILLIE_DOMAIN_CLAIM_RATE_WINDOW_SEC — window length in seconds (default 86400)
 *
 * Re-links (no Billie gas) should not call this.
 */
const claimTimestampsByHuman = new Map<string, number[]>();

export type DomainClaimRateLimitConfig = {
  limit: number;
  windowSec: number;
  enabled: boolean;
};

export function getDomainClaimRateLimitConfig(): DomainClaimRateLimitConfig {
  const rawLimit = process.env.BILLIE_DOMAIN_CLAIM_RATE_LIMIT?.trim();
  const limit = rawLimit ? Number(rawLimit) : 0;
  const rawWindow = process.env.BILLIE_DOMAIN_CLAIM_RATE_WINDOW_SEC?.trim();
  const windowSec = rawWindow ? Number(rawWindow) : 86_400;

  const enabled =
    Number.isFinite(limit) &&
    limit > 0 &&
    Number.isFinite(windowSec) &&
    windowSec > 0;

  return {
    limit: enabled ? Math.floor(limit) : 0,
    windowSec: enabled ? Math.floor(windowSec) : 86_400,
    enabled,
  };
}

function prune(humanId: string, now: number, windowMs: number): number[] {
  const prev = claimTimestampsByHuman.get(humanId) ?? [];
  const kept = prev.filter((ts) => now - ts < windowMs);
  claimTimestampsByHuman.set(humanId, kept);
  return kept;
}

export type DomainClaimRateLimitResult =
  | { ok: true; limited: false }
  | {
      ok: false;
      limited: true;
      limit: number;
      windowSec: number;
      count: number;
      retryAfterSec: number;
    };

/**
 * Check (and on success, consume one slot) whether this human may start a
 * Billie-paid namespace provision.
 */
export function consumeDomainClaimSlot(
  humanId: string,
  nowMs: number = Date.now(),
): DomainClaimRateLimitResult {
  const config = getDomainClaimRateLimitConfig();
  if (!config.enabled) {
    return { ok: true, limited: false };
  }

  const windowMs = config.windowSec * 1000;
  const recent = prune(humanId, nowMs, windowMs);

  if (recent.length >= config.limit) {
    const oldest = recent[0]!;
    const retryAfterSec = Math.max(
      1,
      Math.ceil((oldest + windowMs - nowMs) / 1000),
    );
    return {
      ok: false,
      limited: true,
      limit: config.limit,
      windowSec: config.windowSec,
      count: recent.length,
      retryAfterSec,
    };
  }

  recent.push(nowMs);
  claimTimestampsByHuman.set(humanId, recent);
  return { ok: true, limited: false };
}

/** Test helper — clear in-memory counters. */
export function clearDomainClaimRateLimitState(): void {
  claimTimestampsByHuman.clear();
}
