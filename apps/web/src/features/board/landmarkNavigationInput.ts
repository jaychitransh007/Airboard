import {
  estimateGrabStrength,
  mapLandmarkToCanvas,
  type CanvasMapping,
  type DetectedHand,
} from "@airboard/gesture-engine";

import type { NavHand } from "./canvasNavigationTracker";

const PALM_ANCHOR_INDEXES = [5, 9, 13, 17] as const;

/**
 * Two detected hands always reserve the camera stream, even when their poses
 * are mixed or temporarily ambiguous. This prevents an open↔closed transition
 * from leaking one of those hands into Move/Place/Erase. An existing tracker
 * reservation also survives its release debounce after one hand disappears.
 */
export function shouldReserveLandmarkNavigation(
  detectedHandCount: number,
  trackerReserving: boolean,
): boolean {
  return detectedHandCount >= 2 || trackerReserving;
}

/**
 * Converts exactly two complete HandLandmarker hands into the canonical
 * two-hand navigation input. The conversion owns both palm anchoring and the
 * open/closed evidence, preventing Pan/Zoom from introducing a second camera
 * interpretation path.
 */
export function collectLandmarkNavigationHands(
  hands: readonly DetectedHand[],
  mapping: CanvasMapping,
): NavHand[] {
  const tracked = hands.filter(
    (hand) =>
      hand.landmarks.length >= 21 &&
      PALM_ANCHOR_INDEXES.every((index) => {
        const point = hand.landmarks[index];
        return (
          point !== undefined &&
          Number.isFinite(point.x) &&
          Number.isFinite(point.y) &&
          (point.z === undefined || Number.isFinite(point.z))
        );
      }),
  );
  if (tracked.length !== 2) {
    return [];
  }

  return tracked.map((hand) => {
    const palmKnuckles = PALM_ANCHOR_INDEXES.map(
      (index) => hand.landmarks[index]!,
    );
    const point = mapLandmarkToCanvas(
      {
        x:
          palmKnuckles.reduce((sum, landmark) => sum + landmark.x, 0) /
          palmKnuckles.length,
        y:
          palmKnuckles.reduce((sum, landmark) => sum + landmark.y, 0) /
          palmKnuckles.length,
      },
      { ...mapping, mirrorInput: true, sensitivity: 1 },
      0,
    );
    return {
      point: { x: point.x, y: point.y },
      grabStrength: estimateGrabStrength(hand.landmarks).strength,
    };
  });
}
