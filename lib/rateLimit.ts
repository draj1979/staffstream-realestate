/**
 * Basic in-memory fixed-window rate limiter — enough to blunt obvious
 * abuse (credential-stuffing a login form, a single sender hammering the
 * WhatsApp webhook and racking up Claude API costs), not a WAF.
 *
 * Caveat: state is per-process. On a multi-instance Cloud Run deployment
 * each instance has its own counters, so the effective limit is
 * (limit × instance count), not a hard global cap. See SECURITY.md — an
 * Upstash/Redis-backed limiter would fix this if it ever becomes a real
 * problem; not worth the added dependency for this MVP's traffic volume.
 */

interface Bucket {
  count: number;
  resetAt: number;
}

const buckets = new Map<string, Bucket>();

// Bound memory growth from a map that otherwise only grows: on a small
// random fraction of calls, sweep out expired buckets.
const SWEEP_PROBABILITY = 0.01;

function sweepExpired(now: number): void {
  for (const [key, bucket] of buckets) {
    if (now >= bucket.resetAt) {
      buckets.delete(key);
    }
  }
}

export interface RateLimitResult {
  allowed: boolean;
  retryAfterSeconds?: number;
}

/**
 * Fixed-window check: `key` gets `limit` calls per `windowMs`, after which
 * further calls are rejected until the window resets.
 */
export function checkRateLimit(key: string, limit: number, windowMs: number): RateLimitResult {
  const now = Date.now();
  if (Math.random() < SWEEP_PROBABILITY) sweepExpired(now);

  const bucket = buckets.get(key);
  if (!bucket || now >= bucket.resetAt) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return { allowed: true };
  }

  if (bucket.count >= limit) {
    return { allowed: false, retryAfterSeconds: Math.ceil((bucket.resetAt - now) / 1000) };
  }

  bucket.count += 1;
  return { allowed: true };
}

/** Best-effort client IP from standard proxy headers (Cloud Run sits behind one). */
export function clientIpFromHeaders(headers: Headers): string {
  const forwardedFor = headers.get("x-forwarded-for");
  if (forwardedFor) {
    return forwardedFor.split(",")[0].trim();
  }
  return headers.get("x-real-ip") ?? "unknown";
}
