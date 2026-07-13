import { average, clamp, distance, midpoint } from "./math";
import type {
  DetectedHand,
  GestureClassifierOutput,
  GestureConfig,
  HandLandmark,
} from "./types";

const WRIST = 0;
const THUMB_TIP = 4;
const INDEX_MCP = 5;
const INDEX_PIP = 6;
const INDEX_TIP = 8;
const MIDDLE_MCP = 9;
const MIDDLE_PIP = 10;
const MIDDLE_TIP = 12;
const RING_MCP = 13;
const RING_PIP = 14;
const RING_TIP = 16;
const PINKY_MCP = 17;
const PINKY_PIP = 18;
const PINKY_TIP = 20;

export function classifyGesture(
  hand: DetectedHand,
  config: GestureConfig,
  timestampMs: number,
): GestureClassifierOutput {
  const fallback = unknown(hand, timestampMs);

  if (hand.landmarks.length < 21 || hand.handednessScore < config.minTrackingConfidence) {
    return fallback;
  }

  if (hand.handedness === config.dusterHand) {
    const duster = classifyDuster(hand, timestampMs);
    if (duster.confidence >= Math.max(0.35, config.dusterGestureConfidenceThreshold * 0.65)) {
      return duster;
    }
  }

  if (config.markerHand === "either" || hand.handedness === config.markerHand) {
    return classifyMarker(hand, timestampMs);
  }

  if (hand.handedness === config.dusterHand) {
    return classifyDuster(hand, timestampMs);
  }

  return fallback;
}

function classifyMarker(hand: DetectedHand, timestampMs: number): GestureClassifierOutput {
  const landmarks = hand.landmarks;
  const thumbTip = landmarks[THUMB_TIP];
  const indexMcp = landmarks[INDEX_MCP];
  const indexPip = landmarks[INDEX_PIP];
  const indexTip = landmarks[INDEX_TIP];

  if (!thumbTip || !indexMcp || !indexPip || !indexTip) {
    return unknown(hand, timestampMs);
  }

  const indexLength = Math.max(distance(indexMcp, indexTip), 0.001);
  const pinchDistance = distance(thumbTip, indexTip);
  const pinchScore = clamp(1 - pinchDistance / (indexLength * 1.25));
  const indexStableScore = clamp(distance(indexPip, indexTip) / (indexLength * 0.55));
  const curlScore = averageFingerCurlScore(landmarks, [
    [MIDDLE_MCP, MIDDLE_PIP, MIDDLE_TIP],
    [RING_MCP, RING_PIP, RING_TIP],
    [PINKY_MCP, PINKY_PIP, PINKY_TIP],
  ]);
  const pinchMarkerScore = clamp(
    pinchScore * 0.58 + indexStableScore * 0.3 + curlScore * 0.12,
  );
  const pointingMarkerScore = clamp(
    indexStableScore * 0.58 + thumbIndexSideScore(landmarks) * 0.26 + curlScore * 0.16,
  );
  const confidence = Math.max(pinchMarkerScore, pointingMarkerScore);

  return {
    hand: hand.handedness,
    handednessConfidence: hand.handednessScore,
    gesture: confidence > 0.3 ? "marker" : "unknown",
    confidence,
    cursorPoint: {
      x: indexTip.x,
      y: indexTip.y,
      t: timestampMs,
    },
  };
}

function thumbIndexSideScore(landmarks: readonly HandLandmark[]): number {
  const thumbTip = landmarks[THUMB_TIP];
  const indexMcp = landmarks[INDEX_MCP];
  const indexPip = landmarks[INDEX_PIP];
  const indexTip = landmarks[INDEX_TIP];
  if (!thumbTip || !indexMcp || !indexPip || !indexTip) {
    return 0;
  }

  const indexLength = Math.max(distance(indexMcp, indexTip), 0.001);
  const thumbToIndexTip = distance(thumbTip, indexTip);
  const thumbToIndexPip = distance(thumbTip, indexPip);
  return clamp(1 - Math.min(thumbToIndexTip, thumbToIndexPip) / (indexLength * 1.35));
}

function classifyDuster(hand: DetectedHand, timestampMs: number): GestureClassifierOutput {
  const landmarks = hand.landmarks;
  const palmCenter = averageRequired(landmarks, [WRIST, INDEX_MCP, MIDDLE_MCP, RING_MCP, PINKY_MCP]);
  if (!palmCenter) {
    return unknown(hand, timestampMs);
  }

  const fistScore = averageFingerCurlScore(landmarks, [
    [INDEX_MCP, INDEX_PIP, INDEX_TIP],
    [MIDDLE_MCP, MIDDLE_PIP, MIDDLE_TIP],
    [RING_MCP, RING_PIP, RING_TIP],
    [PINKY_MCP, PINKY_PIP, PINKY_TIP],
  ]);
  const openPalmScore = averageFingerExtensionScore(landmarks, [
    [INDEX_MCP, INDEX_PIP, INDEX_TIP],
    [MIDDLE_MCP, MIDDLE_PIP, MIDDLE_TIP],
    [RING_MCP, RING_PIP, RING_TIP],
    [PINKY_MCP, PINKY_PIP, PINKY_TIP],
  ]);
  const spreadScore = fingerSpreadScore(landmarks);
  const fistDusterScore = clamp(fistScore * 0.85 + hand.handednessScore * 0.15);
  const openPalmDusterScore = clamp(
    openPalmScore * 0.72 + spreadScore * 0.16 + hand.handednessScore * 0.12,
  );
  const confidence = Math.max(fistDusterScore, openPalmDusterScore);

  return {
    hand: hand.handedness,
    handednessConfidence: hand.handednessScore,
    gesture: confidence > 0.45 ? "duster" : "unknown",
    confidence,
    cursorPoint: {
      x: palmCenter.x,
      y: palmCenter.y,
      t: timestampMs,
    },
  };
}

function averageFingerExtensionScore(
  landmarks: readonly HandLandmark[],
  fingers: readonly [number, number, number][],
): number {
  const wrist = landmarks[WRIST];
  if (!wrist) {
    return 0;
  }

  const scores = fingers.map(([mcpIndex, pipIndex, tipIndex]) => {
    const mcp = landmarks[mcpIndex];
    const pip = landmarks[pipIndex];
    const tip = landmarks[tipIndex];
    if (!mcp || !pip || !tip) {
      return 0;
    }

    const wristToMcp = Math.max(distance(wrist, mcp), 0.001);
    const pipAdvance = distance(wrist, pip) - distance(wrist, mcp);
    const tipAdvance = distance(wrist, tip) - distance(wrist, pip);
    const radialExtension = clamp((tipAdvance + pipAdvance * 0.35) / (wristToMcp * 0.85));
    const straightness = clamp(distance(mcp, tip) / Math.max(distance(mcp, pip) * 1.65, 0.001));
    return clamp(radialExtension * 0.55 + straightness * 0.45);
  });

  return scores.reduce((sum, score) => sum + score, 0) / scores.length;
}

function fingerSpreadScore(landmarks: readonly HandLandmark[]): number {
  const indexTip = landmarks[INDEX_TIP];
  const pinkyTip = landmarks[PINKY_TIP];
  const indexMcp = landmarks[INDEX_MCP];
  const pinkyMcp = landmarks[PINKY_MCP];
  if (!indexTip || !pinkyTip || !indexMcp || !pinkyMcp) {
    return 0;
  }

  const palmWidth = Math.max(distance(indexMcp, pinkyMcp), 0.001);
  return clamp((distance(indexTip, pinkyTip) / palmWidth - 0.85) / 1.2);
}

function averageFingerCurlScore(
  landmarks: readonly HandLandmark[],
  fingers: readonly [number, number, number][],
): number {
  const scores = fingers.map(([mcpIndex, pipIndex, tipIndex]) => {
    const mcp = landmarks[mcpIndex];
    const pip = landmarks[pipIndex];
    const tip = landmarks[tipIndex];
    if (!mcp || !pip || !tip) {
      return 0;
    }

    const baseToTip = distance(mcp, tip);
    const baseToPip = Math.max(distance(mcp, pip), 0.001);
    const compactness = clamp(1 - baseToTip / (baseToPip * 1.85));
    const verticalCurl = clamp((tip.y - pip.y + 0.04) / 0.12);
    return clamp(compactness * 0.6 + verticalCurl * 0.4);
  });

  return scores.reduce((sum, score) => sum + score, 0) / scores.length;
}

function averageRequired(
  landmarks: readonly HandLandmark[],
  indexes: readonly number[],
): HandLandmark | null {
  const points = indexes.map((index) => landmarks[index]).filter(Boolean) as HandLandmark[];
  return points.length === indexes.length ? average(points) : null;
}

function unknown(hand: DetectedHand, timestampMs: number): GestureClassifierOutput {
  const indexTip = hand.landmarks[INDEX_TIP];
  const wrist = hand.landmarks[WRIST];
  const fallback = indexTip && wrist ? midpoint(indexTip, wrist) : { x: 0.5, y: 0.5, z: 0 };

  return {
    hand: hand.handedness,
    handednessConfidence: hand.handednessScore,
    gesture: "unknown",
    confidence: 0,
    cursorPoint: {
      x: fallback.x,
      y: fallback.y,
      t: timestampMs,
    },
  };
}
