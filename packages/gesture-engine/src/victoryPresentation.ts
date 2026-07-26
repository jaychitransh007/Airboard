import { clamp, distance } from "./math.ts";
import { estimateGrabStrength } from "./grabStrength.ts";
import type { HandLandmark } from "./types.ts";

export type VictoryPresentationLandmarks = readonly (
  | HandLandmark
  | null
  | undefined
)[];

export type VictoryPresentationEstimate = {
  /** Normalized 0..1 evidence for index+middle extended, ring+pinky folded. */
  score: number;
  /** Evidence that both raised fingers are extended. */
  raisedFingerScore: number;
  /** Evidence that both lower fingers are folded. */
  foldedFingerScore: number;
  /** Scale-normalized separation between the two raised fingertips. */
  separationScore: number;
  /** Thumb/middle clearance that rejects a thumb-middle snap contact. */
  thumbClearanceScore: number;
  /** Landmark coverage and usable palm-scale evidence. */
  confidence: number;
};

const WRIST = 0;
const THUMB_TIP = 4;
const INDEX_MCP = 5;
const INDEX_TIP = 8;
const MIDDLE_MCP = 9;
const MIDDLE_TIP = 12;
const PINKY_MCP = 17;

const ZERO_ESTIMATE: VictoryPresentationEstimate = {
  score: 0,
  raisedFingerScore: 0,
  foldedFingerScore: 0,
  separationScore: 0,
  thumbClearanceScore: 0,
  confidence: 0,
};

/**
 * Estimates Airboard's Victory pose from the same HandLandmarker coordinates
 * used by every motion gesture.
 *
 * The definition is rotation-, mirror-, and scale-independent: index and
 * middle must be extended, ring and pinky must be folded, and the two raised
 * fingertips must be visibly separated. General thumb position is
 * intentionally unconstrained so different hand anatomy and comfortable
 * V-sign styles work, but thumb-middle contact is rejected because it belongs
 * to the higher-priority Snap gesture.
 */
export function estimateVictoryPresentation(
  landmarks: VictoryPresentationLandmarks,
): VictoryPresentationEstimate {
  const requiredIndexes = [
    WRIST,
    THUMB_TIP,
    INDEX_MCP,
    INDEX_TIP,
    MIDDLE_MCP,
    MIDDLE_TIP,
    PINKY_MCP,
  ] as const;
  if (!requiredIndexes.every((index) => validLandmark(landmarks[index]) !== null)) {
    return ZERO_ESTIMATE;
  }

  const grab = estimateGrabStrength(landmarks);
  const indexCurl = grab.fingerScores.index;
  const middleCurl = grab.fingerScores.middle;
  const ringCurl = grab.fingerScores.ring;
  const pinkyCurl = grab.fingerScores.pinky;
  if (
    indexCurl === undefined ||
    middleCurl === undefined ||
    ringCurl === undefined ||
    pinkyCurl === undefined ||
    !(grab.handScale > 1e-4)
  ) {
    return ZERO_ESTIMATE;
  }

  // Minima make every required finger individually authoritative: one raised
  // finger folding or one lower finger opening immediately weakens the pose.
  const raisedFingerScore = Math.min(1 - indexCurl, 1 - middleCurl);
  const foldedFingerScore = Math.min(ringCurl, pinkyCurl);
  const indexTip = validLandmark(landmarks[INDEX_TIP])!;
  const middleTip = validLandmark(landmarks[MIDDLE_TIP])!;
  const normalizedSeparation = distance(indexTip, middleTip) / grab.handScale;
  const separationScore = clamp((normalizedSeparation - 0.16) / 0.34);
  const thumbTip = validLandmark(landmarks[THUMB_TIP])!;
  const normalizedThumbClearance = distance(thumbTip, middleTip) / grab.handScale;
  const thumbClearanceScore = clamp((normalizedThumbClearance - 0.14) / 0.36);
  const confidence = clamp(
    grab.confidence * 0.8 +
      (requiredIndexes.filter((index) => validLandmark(landmarks[index])).length /
        requiredIndexes.length) *
        0.2,
  );

  // Fail closed before blending. This rejects an open palm, pointing finger,
  // fist, and transitional pose even if another component happens to be high.
  if (
    raisedFingerScore < 0.56 ||
    foldedFingerScore < 0.5 ||
    separationScore < 0.18 ||
    thumbClearanceScore < 0.15 ||
    confidence < 0.7
  ) {
    return {
      score: 0,
      raisedFingerScore,
      foldedFingerScore,
      separationScore,
      thumbClearanceScore,
      confidence,
    };
  }

  return {
    score: clamp(
      raisedFingerScore * 0.36 +
        foldedFingerScore * 0.36 +
        separationScore * 0.14 +
        thumbClearanceScore * 0.14,
    ),
    raisedFingerScore,
    foldedFingerScore,
    separationScore,
    thumbClearanceScore,
    confidence,
  };
}

function validLandmark(
  landmark: HandLandmark | null | undefined,
): HandLandmark | null {
  if (
    !landmark ||
    !Number.isFinite(landmark.x) ||
    !Number.isFinite(landmark.y) ||
    (landmark.z !== undefined && !Number.isFinite(landmark.z))
  ) {
    return null;
  }
  return landmark;
}
