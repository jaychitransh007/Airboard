import { clamp, distance } from "./math.ts";
import type { DetectedHand, HandLandmark } from "./types.ts";

export type GrabFinger = "index" | "middle" | "ring" | "pinky";

export type GrabStrengthLandmarks = readonly (
  | HandLandmark
  | null
  | undefined
)[];

export type GrabStrengthEstimate = {
  /** Normalized 0..1 signal: 0 is an open hand and 1 is a closed grab. */
  strength: number;
  /** Landmark coverage and geometric evidence quality, independent of strength. */
  confidence: number;
  /** Palm-scale estimate in normalized camera coordinates. */
  handScale: number;
  /** Per-finger curl scores for fingers with enough usable evidence. */
  fingerScores: Partial<Record<GrabFinger, number>>;
  observedFingers: number;
};

type FingerDefinition = {
  name: GrabFinger;
  mcp: number;
  pip: number;
  dip: number;
  tip: number;
};

type WeightedEvidence = {
  score: number;
  weight: number;
};

const WRIST = 0;
const THUMB_TIP = 4;
const INDEX_MCP = 5;
const MIDDLE_MCP = 9;
const RING_MCP = 13;
const PINKY_MCP = 17;

const fingers: readonly FingerDefinition[] = [
  { name: "index", mcp: 5, pip: 6, dip: 7, tip: 8 },
  { name: "middle", mcp: 9, pip: 10, dip: 11, tip: 12 },
  { name: "ring", mcp: 13, pip: 14, dip: 15, tip: 16 },
  { name: "pinky", mcp: 17, pip: 18, dip: 19, tip: 20 },
];

/**
 * Derives a closed-hand grab signal from MediaPipe-style hand landmarks.
 *
 * Unlike thumb/index pinch distance, this combines curl, foreshortening and
 * fingertip-to-palm evidence across all four fingers. Every distance-based
 * feature is normalized by the detected palm, so moving toward the camera does
 * not by itself engage the grab. Missing or non-finite landmarks are ignored.
 */
export function estimateGrabStrength(
  landmarks: GrabStrengthLandmarks,
): GrabStrengthEstimate {
  const palm = estimatePalmGeometry(landmarks);
  const fingerScores: Partial<Record<GrabFinger, number>> = {};
  const scores: number[] = [];
  let evidenceWeight = 0;

  for (const finger of fingers) {
    const estimate = estimateFingerCurl(landmarks, finger, palm.center, palm.handScale);
    if (!estimate) {
      continue;
    }
    fingerScores[finger.name] = estimate.score;
    scores.push(estimate.score);
    evidenceWeight += estimate.evidenceWeight;
  }

  if (scores.length === 0) {
    return {
      strength: 0,
      confidence: 0,
      handScale: palm.handScale,
      fingerScores,
      observedFingers: 0,
    };
  }

  // Median resists one mistracked fingertip; the mean preserves gradual motion
  // when the user closes the fingers sequentially.
  const medianScore = median(scores);
  const meanScore = averageNumbers(scores);
  let strength = medianScore * 0.68 + meanScore * 0.32;

  // A folded thumb is useful corroboration, but never dominates the four-finger
  // evidence. This avoids accidental grabs from an ordinary thumb/index pinch.
  const thumbTip = validLandmark(landmarks[THUMB_TIP]);
  if (thumbTip && palm.center && palm.handScale > 0) {
    const thumbAcrossPalm = descendingRamp(
      distance(thumbTip, palm.center) / palm.handScale,
      0.38,
      1.05,
    );
    strength = strength * 0.92 + thumbAcrossPalm * 0.08;
  }

  // One isolated finger is not enough to claim a fist. Two good fingers can
  // still engage after hysteresis, while three or four retain full strength.
  const multiFingerGate = scores.length >= 3 ? 1 : scores.length === 2 ? 0.82 : 0.42;
  strength *= multiFingerGate;

  const fingerCoverage = scores.length / fingers.length;
  const evidenceCoverage = clamp(evidenceWeight / (fingers.length * 3.75));
  const palmConfidence = palm.center && palm.handScale > 0 ? 1 : 0.45;

  return {
    strength: clamp(strength),
    confidence: clamp(
      fingerCoverage * 0.62 + evidenceCoverage * 0.28 + palmConfidence * 0.1,
    ),
    handScale: palm.handScale,
    fingerScores,
    observedFingers: scores.length,
  };
}

/** Returns just the 0..1 grab signal for direct controller integration. */
export function grabStrengthFromLandmarks(
  landmarks: GrabStrengthLandmarks,
): number {
  return estimateGrabStrength(landmarks).strength;
}

/** Convenience wrapper for the gesture engine's MediaPipe-compatible hand. */
export function grabStrengthFromHand(
  hand: Pick<DetectedHand, "landmarks"> | null | undefined,
): number {
  return hand ? grabStrengthFromLandmarks(hand.landmarks) : 0;
}

function estimateFingerCurl(
  landmarks: GrabStrengthLandmarks,
  finger: FingerDefinition,
  palmCenter: HandLandmark | null,
  handScale: number,
): { score: number; evidenceWeight: number } | null {
  const wrist = validLandmark(landmarks[WRIST]);
  const mcp = validLandmark(landmarks[finger.mcp]);
  const pip = validLandmark(landmarks[finger.pip]);
  const dip = validLandmark(landmarks[finger.dip]);
  const tip = validLandmark(landmarks[finger.tip]);
  const evidence: WeightedEvidence[] = [];

  if (mcp && pip && tip) {
    const bendDegrees = angleDegrees(mcp, pip, tip);
    if (bendDegrees !== null) {
      evidence.push({ score: descendingRamp(bendDegrees, 92, 164), weight: 1.35 });
    }
  }

  if (mcp && pip && dip && tip) {
    const pathLength =
      distance(mcp, pip) + distance(pip, dip) + distance(dip, tip);
    if (pathLength > 1e-6) {
      const chordRatio = distance(mcp, tip) / pathLength;
      evidence.push({ score: descendingRamp(chordRatio, 0.49, 0.91), weight: 1.15 });
    }
  }

  if (tip && palmCenter && handScale > 0) {
    const tipPalmDistance = distance(tip, palmCenter) / handScale;
    evidence.push({ score: descendingRamp(tipPalmDistance, 0.52, 1.58), weight: 1 });
  }

  if (wrist && mcp && tip) {
    const wristToMcp = distance(wrist, mcp);
    if (wristToMcp > 1e-6) {
      const radialExtension = distance(wrist, tip) / wristToMcp;
      evidence.push({ score: descendingRamp(radialExtension, 1.02, 1.82), weight: 0.75 });
    }
  }

  if (evidence.length === 0) {
    return null;
  }

  // A weighted mean lets partial MediaPipe frames remain usable while the
  // stronger joint-angle and path-shape features carry more influence.
  const evidenceWeight = evidence.reduce((sum, item) => sum + item.weight, 0);
  const score = evidence.reduce(
    (sum, item) => sum + item.score * item.weight,
    0,
  ) / evidenceWeight;

  return { score: clamp(score), evidenceWeight };
}

function estimatePalmGeometry(landmarks: GrabStrengthLandmarks): {
  center: HandLandmark | null;
  handScale: number;
} {
  const wrist = validLandmark(landmarks[WRIST]);
  const knuckles = [INDEX_MCP, MIDDLE_MCP, RING_MCP, PINKY_MCP]
    .map((index) => validLandmark(landmarks[index]))
    .filter((landmark): landmark is HandLandmark => landmark !== null);

  const center = knuckles.length >= 2 ? averageLandmarks(knuckles) : wrist;
  const scaleCandidates: number[] = [];
  const indexMcp = validLandmark(landmarks[INDEX_MCP]);
  const middleMcp = validLandmark(landmarks[MIDDLE_MCP]);
  const pinkyMcp = validLandmark(landmarks[PINKY_MCP]);

  if (indexMcp && pinkyMcp) {
    scaleCandidates.push(distance(indexMcp, pinkyMcp));
  }
  if (wrist && middleMcp) {
    scaleCandidates.push(distance(wrist, middleMcp));
  }
  if (wrist && center) {
    scaleCandidates.push(distance(wrist, center));
  }

  const validScales = scaleCandidates.filter(
    (scale) => Number.isFinite(scale) && scale > 1e-6,
  );
  return {
    center,
    handScale: validScales.length > 0 ? median(validScales) : 0,
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

function averageLandmarks(landmarks: readonly HandLandmark[]): HandLandmark {
  const total = landmarks.reduce<{ x: number; y: number; z: number }>(
    (sum, point) => ({
      x: sum.x + point.x,
      y: sum.y + point.y,
      z: sum.z + (point.z ?? 0),
    }),
    { x: 0, y: 0, z: 0 },
  );
  return {
    x: total.x / landmarks.length,
    y: total.y / landmarks.length,
    z: total.z / landmarks.length,
  };
}

function angleDegrees(
  start: HandLandmark,
  vertex: HandLandmark,
  end: HandLandmark,
): number | null {
  const a = {
    x: start.x - vertex.x,
    y: start.y - vertex.y,
    z: (start.z ?? 0) - (vertex.z ?? 0),
  };
  const b = {
    x: end.x - vertex.x,
    y: end.y - vertex.y,
    z: (end.z ?? 0) - (vertex.z ?? 0),
  };
  const magnitudeA = Math.hypot(a.x, a.y, a.z);
  const magnitudeB = Math.hypot(b.x, b.y, b.z);
  if (magnitudeA <= 1e-6 || magnitudeB <= 1e-6) {
    return null;
  }
  const cosine = clamp(
    (a.x * b.x + a.y * b.y + a.z * b.z) / (magnitudeA * magnitudeB),
    -1,
    1,
  );
  return (Math.acos(cosine) * 180) / Math.PI;
}

function descendingRamp(value: number, fullAt: number, zeroAt: number): number {
  if (!Number.isFinite(value) || zeroAt <= fullAt) {
    return 0;
  }
  return clamp((zeroAt - value) / (zeroAt - fullAt));
}

function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  const upper = sorted[middle] ?? 0;
  if (sorted.length % 2 === 1) {
    return upper;
  }
  return ((sorted[middle - 1] ?? upper) + upper) / 2;
}

function averageNumbers(values: readonly number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}
