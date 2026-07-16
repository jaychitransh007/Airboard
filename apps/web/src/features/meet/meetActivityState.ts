import {
  parseGoogleMeetActivityData,
  type GoogleMeetActivityData,
  type GoogleMeetSurface,
} from "@airboard/integrations";

export type MeetActivityResolution = {
  activity: GoogleMeetActivityData | null;
  /**
   * Set when activity data exists but cannot be read (legacy format or
   * corruption). The side panel must stay usable so the organizer can start a
   * fresh activity instead of being stranded on an error page.
   */
  staleActivityNotice: string | null;
};

/**
 * Interprets the Meet activity starting state for a surface. Unreadable
 * activity data is a recoverable condition on the side panel and an
 * actionable error on the main stage — never a raw parse failure.
 */
export function resolveMeetActivityState(input: {
  surface: GoogleMeetSurface;
  additionalData: string | undefined;
}): MeetActivityResolution {
  if (!input.additionalData) {
    if (input.surface === "main-stage") {
      throw new Error("The Meet activity did not provide an Airboard session.");
    }
    return { activity: null, staleActivityNotice: null };
  }

  try {
    return {
      activity: parseGoogleMeetActivityData(input.additionalData),
      staleActivityNotice: null,
    };
  } catch {
    if (input.surface === "main-stage") {
      throw new Error(
        "This Airboard activity uses an unsupported or outdated data format. " +
          "Ask the organizer to start a fresh activity from the Airboard side panel.",
      );
    }
    return {
      activity: null,
      staleActivityNotice:
        "The existing Meet activity data could not be read. " +
        "Starting the activity again opens a fresh shared board.",
    };
  }
}
