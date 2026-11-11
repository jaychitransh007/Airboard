import type { SupabaseClient } from "@supabase/supabase-js";
import type { DailyUsageLimits } from "../dailyUsage";

/** Remaining voice minutes at which the person is warned, largest first. */
export const VOICE_ALLOWANCE_WARNING_MINUTES = [15, 5] as const;

export type VoiceAllowanceRemaining = {
  seconds: number;
  /** Which limit is nearer: the person's own, or the pilot-wide total. */
  scope: "personal" | "service";
};

export type VoiceAllowanceReader = {
  remaining(profileId: string): Promise<VoiceAllowanceRemaining | null>;
};

/**
 * Reads how much of today's voice allowance is left, from the same rows the
 * daily_usage RPCs charge (personal, and the service total when one is set).
 * Used only to warn ahead of the limit: a failed read warns nobody and
 * changes nothing about what is charged or refused.
 */
export function createVoiceAllowanceReader(
  client: Pick<SupabaseClient, "from"> | null,
  limits: DailyUsageLimits,
  service: DailyUsageLimits | undefined,
  onError: (error: unknown) => void = () => undefined,
): VoiceAllowanceReader {
  const today = () => new Date().toISOString().slice(0, 10);
  const readAmount = async (table: "daily_usage" | "service_daily_usage", profileId: string | null) => {
    let query = client!.from(table).select("amount").eq("usage_date", today()).eq("metric", "voice_seconds");
    if (profileId) query = query.eq("profile_id", profileId);
    const { data, error } = await query.maybeSingle();
    if (error) throw error;
    // No row yet means nothing used today.
    if (data === null || data === undefined) return 0;
    const amount = Number((data as { amount?: unknown }).amount);
    return Number.isFinite(amount) ? amount : null;
  };
  return {
    async remaining(profileId) {
      if (!client) return null;
      try {
        const personalUsed = await readAmount("daily_usage", profileId);
        if (personalUsed === null) return null;
        const personal = Math.max(0, limits.voiceSeconds - personalUsed);
        if (!service) return { seconds: personal, scope: "personal" };
        const serviceUsed = await readAmount("service_daily_usage", null);
        if (serviceUsed === null) return { seconds: personal, scope: "personal" };
        const serviceLeft = Math.max(0, service.voiceSeconds - serviceUsed);
        return serviceLeft < personal
          ? { seconds: serviceLeft, scope: "service" }
          : { seconds: personal, scope: "personal" };
      } catch (error) {
        onError(error);
        return null;
      }
    },
  };
}

/**
 * The warning to send now, if the remainder has fallen to a threshold not yet
 * warned about on this stream. `warned` holds the thresholds already sent and
 * is updated in place; crossing several at once sends one warning.
 */
export function nextVoiceAllowanceWarning(
  remaining: VoiceAllowanceRemaining,
  warned: Set<number>,
): { remainingMinutes: number; scope: "personal" | "service"; message: string } | null {
  const crossed = VOICE_ALLOWANCE_WARNING_MINUTES.filter(
    (minutes) => remaining.seconds <= minutes * 60 && !warned.has(minutes),
  );
  if (!crossed.length) return null;
  for (const minutes of VOICE_ALLOWANCE_WARNING_MINUTES) {
    if (remaining.seconds <= minutes * 60) warned.add(minutes);
  }
  const remainingMinutes = Math.max(0, Math.floor(remaining.seconds / 60));
  const amount = remainingMinutes < 1 ? "Less than a minute" : `About ${remainingMinutes} minute${remainingMinutes === 1 ? "" : "s"}`;
  const message =
    remaining.scope === "service"
      ? `${amount} of Airo voice left today for everyone in the pilot. Typed commands keep working, and voice is back at midnight UTC.`
      : `${amount} of Airo voice left today. Typed commands keep working, and voice is back at midnight UTC.`;
  return { remainingMinutes, scope: remaining.scope, message };
}
