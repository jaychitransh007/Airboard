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

/** Best-effort caller identity for rate limiting. */
export function clientKey(request: {
  ip?: string;
  headers: Record<string, string | string[] | undefined>;
}): string {
  const forwarded = request.headers["x-forwarded-for"];
  if (typeof forwarded === "string" && forwarded.length > 0) {
    return forwarded.split(",")[0]?.trim() ?? "unknown";
  }
  return request.ip ?? "unknown";
}
