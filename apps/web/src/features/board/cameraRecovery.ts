/**
 * Camera and hand-tracker auto-recovery (gap 12 of the hands-free audit).
 *
 * When hand tracking errors, or the camera track ends (unplugged, another app
 * takes it, the OS revokes it), the board restarts the camera and tracker on
 * its own with backoff. Permission refusals are final: retrying would only
 * re-prompt or fail the same way.
 */

export type CameraRecoveryReason = "tracker_error" | "track_ended" | "start_failed";

export const CAMERA_RECOVERY_MAX_ATTEMPTS = 8;
/** How long a restarted camera must run before the backoff starts over. */
export const CAMERA_RECOVERY_STABLE_MS = 10_000;

const BASE_DELAY_MS = 1_000;
const MAX_DELAY_MS = 15_000;

/** Delay before recovery attempt `attempt` (0-based): 1 s, 2 s, 4 s, 8 s, then 15 s. */
export function cameraRecoveryDelayMs(attempt: number): number {
  const safe = Math.max(0, Math.floor(attempt));
  return Math.min(MAX_DELAY_MS, BASE_DELAY_MS * 2 ** safe);
}

/** True when a start failure is worth retrying automatically. */
export function shouldRetryCameraStart(error: unknown): boolean {
  const name =
    typeof error === "object" && error !== null && "name" in error
      ? String((error as { name?: unknown }).name)
      : "";
  // NotAllowed/Security: the person or the browser refused; never re-prompt.
  return name !== "NotAllowedError" && name !== "SecurityError";
}
