import type {
  FrameOpenReason,
  FrameType,
  MeetAddonClient,
  MeetingInfo,
} from "@googleworkspace/meet-addons/meet.addons";

export type GoogleMeetSurface = "side-panel" | "main-stage";

export type GoogleMeetRuntime = {
  frameType: FrameType;
  frameOpenReason: FrameOpenReason;
  meetingInfo: MeetingInfo;
  endActivity(): Promise<void>;
  closeAddon(): Promise<void>;
};

const EXPECTED_FRAME: Record<GoogleMeetSurface, FrameType> = {
  "side-panel": "SIDE_PANEL",
  "main-stage": "MAIN_STAGE",
};

/**
 * Initializes the official Meet Add-ons SDK inside a Meet-provided iframe.
 * The dynamic import is intentional: the SDK expects browser globals and must
 * never execute during Next.js server rendering.
 */
export async function createGoogleMeetRuntime(input: {
  cloudProjectNumber: string;
  surface: GoogleMeetSurface;
}): Promise<GoogleMeetRuntime> {
  if (!/^\d+$/.test(input.cloudProjectNumber)) {
    throw new Error("Google Meet Cloud project number must contain only digits");
  }

  const { meet } = await import("@googleworkspace/meet-addons/meet.addons");
  const frameType = meet.addon.getFrameType();
  const expectedFrame = EXPECTED_FRAME[input.surface];
  if (frameType !== expectedFrame) {
    throw new Error(
      `Google Meet frame mismatch: expected ${expectedFrame}, received ${frameType}`,
    );
  }

  const session = await meet.addon.createAddonSession({
    cloudProjectNumber: input.cloudProjectNumber,
  });
  const client: MeetAddonClient =
    input.surface === "side-panel"
      ? await session.createSidePanelClient()
      : await session.createMainStageClient();
  const [meetingInfo, frameOpenReason] = await Promise.all([
    client.getMeetingInfo(),
    client.getFrameOpenReason(),
  ]);

  return {
    frameType,
    frameOpenReason,
    meetingInfo,
    endActivity: () => client.endActivity(),
    closeAddon: () => client.closeAddon(),
  };
}

export function describeGoogleMeetError(error: unknown): string {
  if (error instanceof Error) {
    const errorType = meetAddonErrorType(error);
    return errorType ? `${errorType}: ${error.message}` : error.message;
  }
  return "Unknown Google Meet SDK error";
}

function meetAddonErrorType(error: unknown): string | null {
  if (!error || typeof error !== "object") {
    return null;
  }
  const errorType = (error as { errorType?: unknown }).errorType;
  return typeof errorType === "string" ? errorType : null;
}
