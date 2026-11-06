import { createHmac } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createRateLimiter } from "./security";

export type SharedRateLimiter = {
  /** True when the caller identified by `key` is within its budget. */
  allow: (key: string) => Promise<boolean>;
};

/**
 * A per-minute limit that holds across API instances (RGB-019). Each instance
 * first checks its own sliding window, which refuses a flood without a
 * database round trip and is the only check without a database (local
 * development and the browser tests). A request it lets through is then
 * counted in Postgres (consume_rate_limit), so three instances still allow
 * `max` requests per window, not three times `max`.
 *
 * Keys are hashed with a server secret before they leave the process, so no
 * address or account id is stored, and an IP address can't be recovered by
 * hashing every address. A failed count lets the request through: a database
 * blip must not turn the API off, and the local window still applies.
 */
export function createSharedRateLimiter(options: {
  /** Names the limit in the shared table, e.g. "intent". */
  bucket: string;
  windowMs: number;
  max: number;
  client: Pick<SupabaseClient, "rpc"> | null;
  /** Keys the hash; the same on every instance (the session signing secret). */
  keySecret: string;
  onError?: (error: unknown) => void;
}): SharedRateLimiter {
  const { bucket, windowMs, max, client, keySecret, onError = () => undefined } = options;
  const local = createRateLimiter({ windowMs, max });
  const windowSeconds = Math.max(1, Math.round(windowMs / 1000));
  return {
    async allow(key) {
      if (!local.allow(key)) return false;
      if (!client) return true;
      try {
        const { data, error } = await client.rpc("consume_rate_limit", {
          p_bucket: bucket,
          p_key_hash: hashRateLimitKey(key, keySecret),
          p_window_seconds: windowSeconds,
          p_max: max,
        });
        if (error) throw error;
        return data !== false;
      } catch (error) {
        onError(error);
        return true;
      }
    },
  };
}

export function hashRateLimitKey(key: string, keySecret: string): string {
  return createHmac("sha256", keySecret).update(`airboard-rate-limit:${key}`).digest("hex");
}
