import type { SupabaseClient } from "@supabase/supabase-js";

export type UsageMetric = "airo_commands" | "voice_seconds";

export type DailyUsageLimits = {
  /** Airo commands that reach the intent model, per person per UTC day. */
  airoCommands: number;
  /** Seconds of streamed voice, per person per UTC day. */
  voiceSeconds: number;
};

export type UsageVerdict = "allowed" | "exhausted" | "service_exhausted";

export type DailyUsage = {
  /**
   * Charges `amount` against the person's allowance for today, then against
   * the whole service's. "exhausted" means the person's allowance would pass
   * its limit and "service_exhausted" the service's; then nothing more is
   * charged.
   */
  consume(profileId: string, metric: UsageMetric, amount: number): Promise<UsageVerdict>;
};

export type ServiceUsageOptions = {
  /**
   * Daily totals for everyone together (consume_service_daily_usage): a fixed
   * ceiling on provider spend however many accounts sign up. Without it only
   * each person's allowance applies.
   */
  service?: DailyUsageLimits;
  /** Called once a day per metric per instance, when the service total is reached. */
  onServiceLimitReached?: (metric: UsageMetric) => void;
};

/**
 * Daily allowances per person and for the whole service, counted in Postgres
 * so they hold across API instances. With a service total, one call
 * (consume_daily_usage_with_service_limit) charges both or neither: requests
 * refused for one person never count against the service, and people refused
 * for the service keep their own allowance. Without a database (local
 * development and the browser tests) nothing is counted. A failed count lets
 * the request through: a database blip must not turn off Airo and voice for
 * everyone, and the per-minute limits and provider spend caps still apply.
 */
export function createDailyUsage(
  client: Pick<SupabaseClient, "rpc"> | null,
  limits: DailyUsageLimits,
  onError: (error: unknown) => void = () => undefined,
  { service, onServiceLimitReached }: ServiceUsageOptions = {},
): DailyUsage {
  const limitFor = (source: DailyUsageLimits, metric: UsageMetric) =>
    metric === "airo_commands" ? source.airoCommands : source.voiceSeconds;
  const reportedServiceLimit = new Map<UsageMetric, string>();
  const count = async (profileId: string, metric: UsageMetric, amount: number): Promise<UsageVerdict> => {
    if (!service) {
      const { data, error } = await client!.rpc("consume_daily_usage", {
        p_profile_id: profileId,
        p_metric: metric,
        p_amount: amount,
        p_limit: limitFor(limits, metric),
      });
      if (error) throw error;
      return data === null ? "exhausted" : "allowed";
    }
    const { data, error } = await client!.rpc("consume_daily_usage_with_service_limit", {
      p_profile_id: profileId,
      p_metric: metric,
      p_amount: amount,
      p_limit: limitFor(limits, metric),
      p_service_limit: limitFor(service, metric),
    });
    if (error) throw error;
    return data === "exhausted" || data === "service_exhausted" ? data : "allowed";
  };
  return {
    async consume(profileId, metric, amount) {
      if (!client) return "allowed";
      let verdict: UsageVerdict;
      try {
        verdict = await count(profileId, metric, amount);
      } catch (error) {
        onError(error);
        return "allowed";
      }
      if (verdict === "service_exhausted") {
        const today = new Date().toISOString().slice(0, 10);
        if (reportedServiceLimit.get(metric) !== today) {
          reportedServiceLimit.set(metric, today);
          onServiceLimitReached?.(metric);
        }
      }
      return verdict;
    },
  };
}
