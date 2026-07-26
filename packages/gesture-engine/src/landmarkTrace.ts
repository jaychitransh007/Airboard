import { estimateGrabStrength } from "./grabStrength.ts";
import { estimatePalmPresentation } from "./palmPresentation.ts";
import { estimateVictoryPresentation } from "./victoryPresentation.ts";
import type { HandLandmark } from "./types.ts";

/**
 * Landmark-trace replay: the ground-truth harness for pose thresholds.
 *
 * The web app's "Record 5s landmark trace" button captures real MediaPipe
 * frames into this JSON shape; fixtures replayed in tests turn every
 * threshold change from a gamble validated by one person waving at one
 * laptop into a measurable diff over recorded reality.
 */

export type LandmarkTraceFrame = {
  /** Milliseconds since recording start. */
  t: number;
  hands: {
    handedness: string;
    score: number;
    /** 21 landmarks as [x, y, z] in normalized image coordinates. */
    landmarks: [number, number, number][];
  }[];
};

export type LandmarkTrace = {
  schemaVersion: "1.0";
  recordedAt?: string;
  description?: string;
  frames: LandmarkTraceFrame[];
};

export type ReplaySample = {
  t: number;
  /** Best palm-presentation score across hands in the frame. */
  palmScore: number;
  /** Best Victory-presentation score across hands in the frame. */
  victoryScore: number;
  /** Best grab strength across hands in the frame. */
  grabStrength: number;
};

export function replayLandmarkTrace(trace: LandmarkTrace): ReplaySample[] {
  return trace.frames.map((frame) => {
    let palmScore = 0;
    let victoryScore = 0;
    let grabStrength = 0;
    for (const hand of frame.hands) {
      const landmarks: HandLandmark[] = hand.landmarks.map(([x, y, z]) => ({ x, y, z }));
      palmScore = Math.max(palmScore, estimatePalmPresentation(landmarks).score);
      victoryScore = Math.max(
        victoryScore,
        estimateVictoryPresentation(landmarks).score,
      );
      grabStrength = Math.max(grabStrength, estimateGrabStrength(landmarks).strength);
    }
    return { t: frame.t, palmScore, victoryScore, grabStrength };
  });
}

export type TraceSegment = { fromMs: number; toMs: number };

/**
 * Contiguous time ranges where a per-frame value stays at/above a threshold.
 * Used to assert "the palm pose is detected from ~1s to ~2s and nowhere else".
 */
export function segmentsAbove(
  samples: readonly ReplaySample[],
  select: (sample: ReplaySample) => number,
  threshold: number,
): TraceSegment[] {
  const segments: TraceSegment[] = [];
  let start: number | null = null;
  let last = 0;
  for (const sample of samples) {
    const active = select(sample) >= threshold;
    if (active && start === null) {
      start = sample.t;
    } else if (!active && start !== null) {
      segments.push({ fromMs: start, toMs: last });
      start = null;
    }
    last = sample.t;
  }
  if (start !== null) {
    segments.push({ fromMs: start, toMs: last });
  }
  return segments;
}

export function parseLandmarkTrace(raw: unknown): LandmarkTrace {
  const trace = raw as LandmarkTrace;
  if (
    !trace ||
    trace.schemaVersion !== "1.0" ||
    !Array.isArray(trace.frames) ||
    trace.frames.some(
      (frame) =>
        typeof frame?.t !== "number" ||
        !Array.isArray(frame.hands) ||
        frame.hands.some((hand) => !Array.isArray(hand?.landmarks)),
    )
  ) {
    throw new Error("Not a schemaVersion 1.0 landmark trace");
  }
  return trace;
}
