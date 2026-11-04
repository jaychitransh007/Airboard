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

/** "Active until 7 Nov 2026, 10:21 PM", "Ended on 7 Nov 2026", or when the pilot starts. */
export function accessWindow(validUntil: string | null | undefined, now: Date = new Date()): string {
  if (!validUntil) return "Your free 72-hour pilot starts when you open your first board.";
  const end = new Date(validUntil);
  if (Number.isNaN(end.getTime())) return "Your free 72-hour pilot starts when you open your first board.";
  const date = end.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
  if (end.getTime() <= now.getTime()) return `Ended on ${date}`;
  const time = end.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  return `Active until ${date}, ${time}`;
}
