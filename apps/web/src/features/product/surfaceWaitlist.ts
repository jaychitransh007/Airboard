/**
 * Surfaces that are not installable yet. Asking to hear about one files an
 * ordinary support request (category "waitlist") so the pilot team sees who
 * is waiting, instead of sending a signed-in pilot user to the sales form.
 */
export const WAITLIST_SURFACES = {
  google_meet: "Airboard for Google Meet",
  desktop: "Airboard desktop",
  zoom: "Airboard for Zoom",
  teams: "Airboard for Microsoft Teams",
} as const;

export type WaitlistSurface = keyof typeof WAITLIST_SURFACES;

export function waitlistRequest(surface: WaitlistSurface): { category: "waitlist"; subject: string; message: string } {
  const name = WAITLIST_SURFACES[surface];
  return {
    category: "waitlist",
    subject: `Waitlist: ${name}`,
    message: `Please let me know when ${name} is available for my workspace.`,
  };
}

/** Remembers, per browser, that this person already asked. */
export function waitlistStorageKey(surface: WaitlistSurface): string {
  return `airboard.waitlist.${surface}.v1`;
}
