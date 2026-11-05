/**
 * One-tap requests a signed-in person files instead of filling in a form.
 * Each is an ordinary support request the pilot team sees in its queue. The
 * API requires a 3–160 character subject and a 10+ character message.
 */
export type SupportRequestBody = { category: string; subject: string; message: string };

/** Surfaces that are not installable yet; asking files a "waitlist" request. */
export const WAITLIST_SURFACES = {
  google_meet: "Airboard for Google Meet",
  desktop: "Airboard desktop",
  zoom: "Airboard for Zoom",
  teams: "Airboard for Microsoft Teams",
} as const;

export type WaitlistSurface = keyof typeof WAITLIST_SURFACES;

export function waitlistRequest(surface: WaitlistSurface): SupportRequestBody & { category: "waitlist" } {
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

export function pilotExtensionRequest(): SupportRequestBody & { category: "pilot_extension" } {
  return {
    category: "pilot_extension",
    subject: "More pilot time",
    message: "My free pilot has ended. Please extend it so I can keep creating boards and sharing live links.",
  };
}

/**
 * Keyed by the access that ended, so someone whose extended pilot ends again
 * can ask again rather than seeing their earlier request as the answer.
 */
export function pilotExtensionStorageKey(endedAt: string | null | undefined): string {
  return `airboard.pilot-extension.${endedAt ?? "unknown"}.v1`;
}
