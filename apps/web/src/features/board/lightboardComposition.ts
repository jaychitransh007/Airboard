export const SCREEN_PRESENTATION_SCRIM = 0.25;
export const MAX_SCREEN_FRIENDLY_SCRIM = 0.45;
export const CAMERA_PRESENTATION_SCRIM = 0.6;
export const MIN_CAMERA_PRESENTATION_SCRIM = 0.55;
export const MAX_CAMERA_PRESENTATION_SCRIM = 0.75;

/**
 * A camera needs a visibly dark glass canvas while keeping the presenter
 * readable. Screen-friendly values are too light, while the former 0.85
 * default hid too much of the camera.
 */
export function cameraCanvasScrim(current: number): number {
  if (!Number.isFinite(current) || current < MIN_CAMERA_PRESENTATION_SCRIM) {
    return CAMERA_PRESENTATION_SCRIM;
  }
  return Math.min(current, MAX_CAMERA_PRESENTATION_SCRIM);
}

/** Preserve an already-light user preference; otherwise reveal the shared screen. */
export function screenFriendlyScrim(current: number): number {
  if (!Number.isFinite(current)) {
    return SCREEN_PRESENTATION_SCRIM;
  }
  const bounded = Math.min(1, Math.max(0, current));
  return bounded > MAX_SCREEN_FRIENDLY_SCRIM ? SCREEN_PRESENTATION_SCRIM : bounded;
}
