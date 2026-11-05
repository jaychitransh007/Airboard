/**
 * Perimeter hardening for the endpoints that spend provider money or create
 * server state: an optional shared API token and a per-client sliding-window
 * rate limiter. Both are no-ops in the default local setup (no token
 * configured, generous limits) and become meaningful the moment the API is
 * exposed beyond localhost.
 */

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
 * Browsers cannot set headers on WebSocket upgrades, so a `token` query
 * parameter is accepted as the WS equivalent of the Bearer header.
 */
export function apiTokenAllowed(
  request: {
    headers: Record<string, string | string[] | undefined>;
    query?: unknown;
  },
  configuredToken: string | undefined,
): boolean {
  if (!configuredToken) {
    return true;
  }
  const header = request.headers.authorization;
  if (typeof header === "string" && header === `Bearer ${configuredToken}`) {
    return true;
  }
  const query = request.query as Record<string, unknown> | undefined;
  return typeof query?.token === "string" && query.token === configuredToken;
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
