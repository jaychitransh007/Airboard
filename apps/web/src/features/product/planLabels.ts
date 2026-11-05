const PLAN_NAMES: Readonly<Record<string, string>> = {
  trial_pending: "Free pilot",
  personal_trial: "Free pilot",
  trial: "Free pilot",
  personal: "Personal",
  team: "Team",
  enterprise: "Enterprise",
  local: "Local development",
  dev_pro: "Development",
};

/** The plan a person sees on Billing, never the internal entitlement code. */
export function planName(plan: string | null | undefined): string {
  if (!plan) return "Free pilot";
  return PLAN_NAMES[plan] ?? plan.replace(/_/g, " ").replace(/^\w/, (letter) => letter.toUpperCase());
}

export type AccessEntitlement = { status: string; validUntil: string | null } | null | undefined;

const NOT_STARTED = "Your free one-month pilot starts when you open your first board.";

/**
 * Whether access has started, is running, or is over. A pending trial carries
 * its sign-up time as validUntil, so that date says nothing about an ending.
 */
export function accessState(entitlement: AccessEntitlement, now: Date = new Date()): "not_started" | "active" | "ended" {
  if (!entitlement || entitlement.status === "pending") return "not_started";
  if (entitlement.status === "expired" || entitlement.status === "canceled") return "ended";
  const end = entitlement.validUntil ? new Date(entitlement.validUntil) : null;
  if (!end || Number.isNaN(end.getTime())) return "active";
  return end.getTime() <= now.getTime() ? "ended" : "active";
}

/** "Active until 7 Nov 2026, 10:21 PM", "Ended on 7 Nov 2026", or when the pilot starts. */
export function accessWindow(entitlement: AccessEntitlement, now: Date = new Date()): string {
  const state = accessState(entitlement, now);
  if (state === "not_started") return NOT_STARTED;
  const end = entitlement?.validUntil ? new Date(entitlement.validUntil) : null;
  if (!end || Number.isNaN(end.getTime())) return state === "ended" ? "Ended" : "Active";
  const date = end.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
  if (state === "ended") return `Ended on ${date}`;
  const time = end.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  return `Active until ${date}, ${time}`;
}
