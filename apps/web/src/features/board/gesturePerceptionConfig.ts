import type { MediaPipeHandTrackerOptions } from "@airboard/gesture-engine";

export const MIN_HAND_CONFIDENCE = 0.4;
export const MAX_HAND_CONFIDENCE = 0.95;

/**
 * Maps the user-facing Hand confidence control onto the actual HandLandmarker
 * perception thresholds. Keeping one value avoids the previous split-brain
 * behavior where the slider changed a downstream controller that always
 * received a synthetic confidence of 1.
 */
export function handPerceptionOptions(
  confidence: number,
): Pick<
  MediaPipeHandTrackerOptions,
  | "minHandDetectionConfidence"
  | "minHandPresenceConfidence"
  | "minTrackingConfidence"
> {
  const normalized = Math.min(
    MAX_HAND_CONFIDENCE,
    Math.max(
      MIN_HAND_CONFIDENCE,
      Number.isFinite(confidence) ? confidence : 0.6,
    ),
  );
  return {
    minHandDetectionConfidence: normalized,
    minHandPresenceConfidence: normalized,
    minTrackingConfidence: normalized,
  };
}
