/**
 * Tiny in-memory fixed-window rate limiter.
 *
 * Serverless instances each keep their own map, so this is best-effort rather
 * than a global guarantee — but combined with server-side email validation and
 * the unique DB constraint it is enough to blunt naive abuse of the public
 * subscribe endpoint without adding infrastructure.
 */

interface Bucket {
  count: number;
  resetAt: number;
}

const buckets = new Map<string, Bucket>();

// Opportunistic cleanup so the map cannot grow without bound.
let lastSweep = Date.now();
function sweep(now: number): void {
  if (now - lastSweep < 60_000) return;
  lastSweep = now;
  for (const [key, bucket] of buckets) {
    if (bucket.resetAt <= now) buckets.delete(key);
  }
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  retryAfterSeconds: number;
}

/**
 * @param key    unique scope, e.g. `subscribe:ip:1.2.3.4`
 * @param limit  max requests per window
 * @param windowMs window length in milliseconds
 */
export function consumeRateLimit(key: string, limit: number, windowMs: number): RateLimitResult {
  const now = Date.now();
  sweep(now);

  const bucket = buckets.get(key);
  if (!bucket || bucket.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return { allowed: true, remaining: limit - 1, retryAfterSeconds: Math.ceil(windowMs / 1000) };
  }

  bucket.count += 1;
  if (bucket.count > limit) {
    return {
      allowed: false,
      remaining: 0,
      retryAfterSeconds: Math.max(1, Math.ceil((bucket.resetAt - now) / 1000)),
    };
  }

  return { allowed: true, remaining: limit - bucket.count, retryAfterSeconds: Math.ceil((bucket.resetAt - now) / 1000) };
}

/** Test helper — clears all buckets. */
export function resetRateLimits(): void {
  buckets.clear();
}
