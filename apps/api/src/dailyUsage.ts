import type { SupabaseClient } from "@supabase/supabase-js";

export type UsageMetric = "airo_commands" | "voice_seconds";

export type DailyUsageLimits = {
  /** Airo commands that reach the intent model, per person per UTC day. */
  airoCommands: number;
  /** Seconds of streamed voice, per person per UTC day. */
  voiceSeconds: number;
};

export type DailyUsage = {
  /**
   * Charges `amount` against the person's allowance for today. "exhausted"
   * means the charge would pass the limit, so nothing was charged.
   */
  consume(profileId: string, metric: UsageMetric, amount: number): Promise<"allowed" | "exhausted">;
};

/**
 * Daily allowances per person, counted in Postgres (consume_daily_usage) so
 * they hold across API instances. Without a database (local development and
 * the browser tests) nothing is counted. A failed count lets the request
 * through: a database blip must not turn off Airo and voice for everyone, and
 * the per-minute limits and provider spend caps still apply.
 */
export function createDailyUsage(
  client: Pick<SupabaseClient, "rpc"> | null,
  limits: DailyUsageLimits,
  onError: (error: unknown) => void = () => undefined,
): DailyUsage {
  const limitFor = (metric: UsageMetric) => (metric === "airo_commands" ? limits.airoCommands : limits.voiceSeconds);
  return {
    async consume(profileId, metric, amount) {
      if (!client) return "allowed";
      try {
        const { data, error } = await client.rpc("consume_daily_usage", {
          p_profile_id: profileId,
          p_metric: metric,
          p_amount: amount,
          p_limit: limitFor(metric),
        });
        if (error) throw error;
        return data === null ? "exhausted" : "allowed";
      } catch (error) {
        onError(error);
        return "allowed";
      }
    },
  };
}
