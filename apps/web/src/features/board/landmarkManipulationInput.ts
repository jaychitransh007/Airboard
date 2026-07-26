import {
  estimateGrabStrength,
  mapLandmarkToFittedCanvas,
  type CanvasMapping,
  type DetectedHand,
  type GestureResult,
} from "@airboard/gesture-engine";

const PALM_ANCHOR_INDEXES = [5, 9, 13, 17] as const;

export type LandmarkManipulationSignal = {
  point: { x: number; y: number };
  trackingConfidence: number;
  grabStrength: number;
  grabConfidence: number;
};

/**
 * Selects one HandLandmarker hand for Move/Place/Erase and derives its cursor
 * and grab evidence. No static gesture label participates in manipulation.
 */
export function selectLandmarkManipulationSignal(
  hands: readonly DetectedHand[],
  preferredHand: GestureResult["hand"],
  mapping: CanvasMapping,
): LandmarkManipulationSignal | null {
  const eligibleHands = hands.filter((hand) =>
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
  const hand =
    eligibleHands.find((candidate) => candidate.handedness === preferredHand) ??
    [...eligibleHands].sort(
      (left, right) => right.handednessScore - left.handednessScore,
    )[0];
  if (!hand) {
    return null;
  }

  const palmKnuckles = PALM_ANCHOR_INDEXES.map(
    (index) => hand.landmarks[index]!,
  );
  const grab = estimateGrabStrength(hand.landmarks);
  const fitted = mapLandmarkToFittedCanvas(
    {
      x:
        palmKnuckles.reduce((sum, point) => sum + point.x, 0) /
        palmKnuckles.length,
      y:
        palmKnuckles.reduce((sum, point) => sum + point.y, 0) /
        palmKnuckles.length,
    },
    mapping,
  );
  return {
    point: {
      // The HybridGestureController owns selfie mirroring and its compact
      // control zone. Feed it crop-correct normalized camera coordinates.
      x: fitted.x / mapping.canvasWidth,
      y: fitted.y / mapping.canvasHeight,
    },
    trackingConfidence: hand.handednessScore,
    grabStrength: grab.strength,
    grabConfidence: grab.confidence,
  };
}
