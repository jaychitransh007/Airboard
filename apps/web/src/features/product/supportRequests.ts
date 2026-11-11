/**
 * One-tap requests a signed-in person files instead of filling in a form.
 * Each is an ordinary support request the pilot team sees in its queue. The
 * API requires a 3–160 character subject and a 10+ character message.
 */
export type SupportRequestBody = { category: string; subject: string; message: string };

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
