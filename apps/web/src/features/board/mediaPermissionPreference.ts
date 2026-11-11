export type MediaPermissionKind = "camera" | "microphone";
export type MediaPermissionState = PermissionState | "unsupported";

type PermissionsLike = Pick<Permissions, "query">;
type MediaKinds = { audio: boolean; video: boolean };

export async function queryMediaPermission(
  kind: MediaPermissionKind,
  permissions: PermissionsLike | undefined =
    typeof navigator === "undefined" ? undefined : navigator.permissions,
): Promise<MediaPermissionState> {
  if (!permissions?.query) return "unsupported";
  try {
    const status = await permissions.query(
      { name: kind } as unknown as PermissionDescriptor,
    );
    return status.state;
  } catch {
    // Safari and older Chromium versions may expose Permissions but not these
    // media descriptors. In that case we require an explicit user action.
    return "unsupported";
  }
}

/**
 * Which of Airo's inputs to start when a board opens, and which of them still
 * need the browser's permission prompt. Airboard asks as soon as a board opens;
 * only an input the person has blocked, or turned off in their preferences,
 * stays off.
 */
export function airoStartPlan(input: {
  voice: boolean;
  camera: boolean;
  microphonePermission: MediaPermissionState;
  cameraPermission: MediaPermissionState;
}): { voice: boolean; camera: boolean; ask: MediaKinds } {
  const voice = input.voice && input.microphonePermission !== "denied";
  const camera = input.camera && input.cameraPermission !== "denied";
  return {
    voice,
    camera,
    ask: {
      audio: voice && input.microphonePermission !== "granted",
      video: camera && input.cameraPermission !== "granted",
    },
  };
}

/**
 * Asks for the camera and microphone in one browser prompt, then releases the
 * test stream so each input opens its own. Returns, per kind, whether nothing
 * now stands in its way (kinds not asked for are true). A refusal covers both;
 * a missing device only the kind that is missing, so a laptop without a camera
 * still gets voice.
 */
export async function requestMediaAccess(
  ask: MediaKinds,
  getUserMedia: ((constraints: MediaStreamConstraints) => Promise<MediaStream>) | undefined,
): Promise<MediaKinds> {
  const unblocked = { audio: !ask.audio, video: !ask.video };
  if (!ask.audio && !ask.video) return unblocked;
  if (!getUserMedia) return unblocked;
  const attempt = async (constraints: MediaKinds): Promise<true | unknown> => {
    try {
      const stream = await getUserMedia(constraints);
      for (const track of stream.getTracks()) track.stop();
      return true;
    } catch (error) {
      return error;
    }
  };
  const both = await attempt(ask);
  if (both === true) return { audio: true, video: true };
  const name = (both as { name?: unknown } | null)?.name;
  const refused = name === "NotAllowedError" || name === "SecurityError";
  if (refused || !(ask.audio && ask.video)) return unblocked;
  return {
    audio: (await attempt({ audio: true, video: false })) === true,
    video: (await attempt({ audio: false, video: true })) === true,
  };
}

export function mediaPermissionLabel(state: MediaPermissionState): string {
  if (state === "granted") return "Allowed";
  if (state === "denied") return "Blocked";
  if (state === "prompt") return "Ask once";
  return "Browser managed";
}
