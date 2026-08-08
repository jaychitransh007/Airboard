import type {
  DetectedHand,
  HandLandmark,
} from "@airboard/gesture-engine";

export type LandmarkPoseEstimate = {
  score: number;
};

export type LandmarkPoseEstimator = (
  landmarks: readonly HandLandmark[],
) => LandmarkPoseEstimate;

export type LandmarkPoseSelection = {
  score: number;
  point: { x: number; y: number } | null;
  trackedHands: number;
};

/**
 * Evaluates one pose from the canonical HandLandmarker stream.
 *
 * Pose-controlled global actions require exactly one complete hand. This keeps
 * them out of the two-hand navigation path and gives every static definition
 * the same hand-count and anchor contract.
 */
export function selectSingleLandmarkPose(
  hands: readonly DetectedHand[],
  estimatePose: LandmarkPoseEstimator,
): LandmarkPoseSelection {
  const tracked = hands.filter(
    (hand) =>
      hand.landmarks.length >= 21 &&
      hand.landmarks
        .slice(0, 21)
        .every(
          (point) =>
            Number.isFinite(point.x) &&
            Number.isFinite(point.y) &&
            (point.z === undefined || Number.isFinite(point.z)),
        ),
  );
  if (tracked.length !== 1) {
    return { score: 0, point: null, trackedHands: tracked.length };
  }

  const hand = tracked[0]!;
  const estimate = estimatePose(hand.landmarks);
  const rawScore = Number(estimate.score);
  const palmKnuckles = [5, 9, 13, 17].map((index) => hand.landmarks[index]!);
  return {
    score: Number.isFinite(rawScore) ? Math.min(1, Math.max(0, rawScore)) : 0,
    point: {
      x:
        palmKnuckles.reduce((sum, point) => sum + point.x, 0) /
        palmKnuckles.length,
      y:
        palmKnuckles.reduce((sum, point) => sum + point.y, 0) /
        palmKnuckles.length,
    },
    trackedHands: 1,
  };
}
