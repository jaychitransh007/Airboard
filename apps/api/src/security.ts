/**
 * Perimeter hardening for the endpoints that spend provider money or create
 * server state: an optional shared API token and a per-client sliding-window
 * rate limiter. Both are no-ops in the default local setup (no token
 * configured, generous limits) and become meaningful the moment the API is
 * exposed beyond localhost.
 */

import { createHash, timingSafeEqual } from "node:crypto";

/**
 * Compares a presented secret with the configured one in constant time.
 * Both sides are hashed first, so neither the content nor the length of the
 * configured secret leaks through response timing.
 */
/**
 * Whether a browser origin may open the API's sockets and media endpoints.
 * Exact matches only, like the REST CORS layer: `*` is not a wildcard
 * (production refuses it at startup).
 */
export function originAllowed(origin: string | undefined, allowedOrigins: readonly string[]): boolean {
  return Boolean(origin && allowedOrigins.includes(origin));
}

/**
 * A token bucket for one connection: up to `max` events at once, refilling
 * at `max` per `windowMs`. Constant memory however fast events arrive.
 */
export function createEventBudget(options: { windowMs: number; max: number }): {
  allowMany: (count: number, now?: number) => boolean;
} {
  const ratePerMs = options.max / options.windowMs;
  let tokens = options.max;
  let updatedAt: number | null = null;
  return {
    allowMany(count, now = Date.now()) {
      if (updatedAt !== null) tokens = Math.min(options.max, tokens + (now - updatedAt) * ratePerMs);
      updatedAt = now;
      if (count > tokens) return false;
      tokens -= count;
      return true;
    },
  };
}

/**
 * Stops calling a provider that is down. After `failureThreshold` outages in
 * a row it answers "unavailable" at once for `cooldownMs`, so an outage does
 * not hold every request open until its timeout; then one trial call decides.
 */
export function createCircuitBreaker(options: { failureThreshold: number; cooldownMs: number }) {
  let failures = 0;
  let openedAt: number | null = null;
  // When the half-open trial began; a trial that never reports back expires
  // after one cooldown so the breaker cannot stay stuck.
  let trialStartedAt: number | null = null;
  return {
    /** Null when a call may go ahead; otherwise how long until the next trial. */
    retryAfterMs(now = Date.now()): number | null {
      if (openedAt === null) return null;
      const remaining = openedAt + options.cooldownMs - now;
      if (remaining > 0) return remaining;
      if (trialStartedAt !== null && now - trialStartedAt < options.cooldownMs) return 1_000;
      trialStartedAt = now;
      return null;
    },
    /** The provider answered (even with a refusal): it is up. */
    recordSuccess() {
      failures = 0;
      openedAt = null;
      trialStartedAt = null;
    },
    /** The provider timed out, was unreachable or could not serve. */
    recordFailure(now = Date.now()) {
      trialStartedAt = null;
      failures += 1;
      if (openedAt !== null || failures >= options.failureThreshold) openedAt = now;
    },
    /** The caller gave up before an answer; neither outcome counts. */
    abandon() {
      trialStartedAt = null;
    },
  };
}

export function secretsMatch(provided: string | null | undefined, expected: string | null | undefined): boolean {
  if (!provided || !expected) return false;
  const digest = (value: string) => createHash("sha256").update(value).digest();
  return timingSafeEqual(digest(provided), digest(expected));
}

export type RateLimiter = {
  /** True when the caller identified by `key` is within its budget. */
  allow: (key: string, now?: number) => boolean;
};

export function createRateLimiter(options: {
  windowMs: number;
  max: number;
}): RateLimiter {
  const { windowMs, max } = options;
  const hits = new Map<string, number[]>();
  // Bound the tracked-client set so a spray of spoofed identities cannot
  // grow memory without limit; evicting the oldest tracked key is safe (the
  // evicted client simply restarts its window).
  const MAX_TRACKED_KEYS = 10_000;

  return {
    allow: (key, now = Date.now()) => {
      let timestamps = hits.get(key);
      if (!timestamps) {
        if (hits.size >= MAX_TRACKED_KEYS) {
          const oldest = hits.keys().next().value as string | undefined;
          if (oldest !== undefined) {
            hits.delete(oldest);
          }
        }
        timestamps = [];
        hits.set(key, timestamps);
      } else {
        // Refresh recency for the eviction order.
        hits.delete(key);
        hits.set(key, timestamps);
      }
      const cutoff = now - windowMs;
      while (timestamps.length > 0 && (timestamps[0] as number) <= cutoff) {
        timestamps.shift();
      }
      if (timestamps.length >= max) {
        return false;
      }
      timestamps.push(now);
      return true;
    },
  };
}

/**
 * Shared-token check. No configured token → open (local development).
 * The operator token is read only from the Authorization header, never from
 * the URL: credentials travel in headers or JSON bodies. The WebSocket
 * upgrades take short, purpose-scoped signed tickets in the URL instead.
 */
export function apiTokenAllowed(
  request: {
    headers: Record<string, string | string[] | undefined>;
  },
  configuredToken: string | undefined,
): boolean {
  if (!configuredToken) {
    return true;
  }
  const header = request.headers.authorization;
  return typeof header === "string" && secretsMatch(header, `Bearer ${configuredToken}`);
}

/** True only for an explicitly configured shared server token. */
export function configuredApiTokenAllowed(
  request: Parameters<typeof apiTokenAllowed>[0],
  configuredToken: string | undefined,
): boolean {
  return Boolean(configuredToken && apiTokenAllowed(request, configuredToken));
}

type ClientRequestLike = {
  ip?: string;
  headers: Record<string, string | string[] | undefined>;
};

/**
 * Rate-limit identity. Authenticated callers are keyed on their profile so a
 * single account cannot multiply its budget by rotating addresses (and users
 * behind one NAT do not share a budget). Anonymous callers fall back to the
 * network address from `clientIp`.
 */
export function clientKey(
  request: ClientRequestLike,
  options: { profileId?: string | null | undefined; trustedProxyHops?: number } = {},
): string {
  if (options.profileId) {
    return `profile:${options.profileId}`;
  }
  return `ip:${clientIp(request, options.trustedProxyHops ?? 0)}`;
}

/**
 * Caller address that the caller cannot choose.
 *
 * Proxies append to X-Forwarded-For; they do not strip what the client sent.
 * Cloud Run's front end appends the real client IP after any client-supplied
 * values, so the FIRST entry is attacker-controlled and only the last
 * `trustedProxyHops` entries were written by infrastructure we trust. With N
 * trusted hops the client address is the Nth entry from the right. With zero
 * hops (local development, direct exposure) the socket address is the only
 * trustworthy value.
 *
 * Fastify's own `trustProxy` is deliberately left off: enabling it would also
 * make `request.hostname` honour a client-supplied X-Forwarded-Host, which the
 * control plane's loopback check reads.
 */
export function clientIp(request: ClientRequestLike, trustedProxyHops: number): string {
  if (trustedProxyHops > 0) {
    const header = request.headers["x-forwarded-for"];
    const forwarded = (Array.isArray(header) ? header.join(",") : header ?? "")
      .split(",")
      .map((entry) => entry.trim())
      .filter(Boolean);
    const candidate = forwarded[forwarded.length - trustedProxyHops];
    if (candidate) {
      return candidate;
    }
  }
  return request.ip ?? "unknown";
}
