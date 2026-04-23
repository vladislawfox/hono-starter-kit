import type { Context, MiddlewareHandler, Next } from "hono";
import { RateLimitError, ValidationError } from "@/core/errors";
import type { AppEnv } from "@/http/context";

type RateLimitOptions = {
  /** Window length in milliseconds. */
  windowMs: number;
  /** Max requests allowed per window per key. */
  max: number;
  /** Custom key function. Default: CF-Connecting-IP → X-Forwarded-For → "unknown". */
  keyGenerator?: (c: Context<AppEnv>) => string;
  /**
   * Behavior when no client-IP header is present (no `CF-Connecting-IP`
   * and no `X-Forwarded-For`).
   *
   * - `"shared"` (default) — all anonymous traffic shares one `"unknown"`
   *   bucket. Convenient for local dev; in production this means one
   *   misbehaving client can exhaust the anonymous quota for everyone.
   * - `"reject"` — treat missing IP as a misconfigured deploy (direct
   *   internet exposure without a proxy) and refuse the request with 400.
   *
   * Only read when `keyGenerator` is not provided — a custom keyGen owns
   * its own fallback semantics.
   */
  onMissingIp?: "shared" | "reject";
};

/**
 * Extracts client IP with awareness of Cloudflare and upstream proxies.
 *
 * Priority:
 *   1. `CF-Connecting-IP` — set by Cloudflare; the real origin IP.
 *   2. First entry in `X-Forwarded-For` — for non-CF proxies.
 *   3. `null` — no header present. Caller decides whether to share a bucket
 *      or reject the request.
 *
 * Do NOT read from the TCP layer directly: behind a CDN, every request
 * appears to come from an edge IP, making per-IP limits useless.
 */
// Exported once the first custom keyGenerator needs to compose with IP fallback
// (typical pattern: `(c) => c.var.user?.id ?? clientIp(c) ?? "unknown"` once auth exists).
function clientIp(c: Context<AppEnv>): string | null {
  const cfIp = c.req.header("CF-Connecting-IP");
  if (cfIp) return cfIp;

  const xff = c.req.header("X-Forwarded-For");
  if (xff) {
    const first = xff.split(",")[0]?.trim();
    if (first) return first;
  }

  return null;
}

type Bucket = { count: number; resetAt: number };

/**
 * In-memory rate limit store. Adequate for single-instance deployments and
 * development. For horizontally scaled production, replace with a Redis-backed
 * implementation (INCR + EXPIRE) so all instances share the same bucket.
 */
const store = new Map<string, Bucket>();

/**
 * Clears all rate-limit buckets. Use in `beforeEach` of tests that hit
 * rate-limited endpoints, otherwise buckets leak across tests.
 */
export function clearRateLimits(): void {
  store.clear();
}

/**
 * Fixed-window rate limiter (in-memory). Buckets expire lazily on the next
 * request that hits the same key — no background timer.
 */
export function rateLimit(opts: RateLimitOptions): MiddlewareHandler<AppEnv> {
  const onMissingIp = opts.onMissingIp ?? "shared";
  const keyFn =
    opts.keyGenerator ??
    ((c: Context<AppEnv>): string => {
      const ip = clientIp(c);
      if (ip) return ip;
      if (onMissingIp === "reject") {
        throw new ValidationError("Missing client IP header (CF-Connecting-IP / X-Forwarded-For)");
      }
      return "unknown";
    });

  return async (c: Context<AppEnv>, next: Next): Promise<void> => {
    const id = keyFn(c);
    const key = `${c.req.path}:${id}`;
    const now = Date.now();

    let bucket = store.get(key);
    if (!bucket || bucket.resetAt <= now) {
      bucket = { count: 0, resetAt: now + opts.windowMs };
      store.set(key, bucket);
    }
    bucket.count++;

    const remaining = Math.max(0, opts.max - bucket.count);
    c.header("X-RateLimit-Limit", String(opts.max));
    c.header("X-RateLimit-Remaining", String(remaining));

    if (bucket.count > opts.max) {
      const retryAfterSec = Math.max(1, Math.ceil((bucket.resetAt - now) / 1000));
      c.header("Retry-After", String(retryAfterSec));
      throw new RateLimitError(`Too many requests. Try again in ${retryAfterSec}s.`);
    }

    await next();
  };
}
