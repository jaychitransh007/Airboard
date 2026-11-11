import {
  estimateGrabStrength,
  estimatePalmPresentation,
  mapLandmarkToFittedCanvas,
  type CanvasMapping,
  type DetectedHand,
  type GestureResult,
} from "@airboard/gesture-engine";

const PALM_ANCHOR_INDEXES = [5, 9, 13, 17] as const;
const OPEN_PALM_POINTER_MIN_SCORE = 0.38;
const CLOSED_HAND_POINTER_MIN_STRENGTH = 0.56;

export type LandmarkManipulationSignal = {
  point: { x: number; y: number };
  trackingConfidence: number;
  grabStrength: number;
  grabConfidence: number;
  /**
   * True for a partial pose (neither a presented palm nor a closed hand) that
   * is only accepted because a grab or carry is in progress.
   */
  loose?: boolean;
};

export type LandmarkManipulationOptions = {
  /** A grab or carry is in progress: a loosened fist keeps the pointer. */
  holding?: boolean;
  /**
   * The previous signal point while holding. With two hands in frame the hand
   * nearest it keeps the grab, so a second hand can't take a carry over.
   */
  anchor?: { x: number; y: number } | null;
};

/**
 * Selects one HandLandmarker hand for Move/Place/Erase and derives its cursor
 * and grab evidence. A presented open palm owns hover; a closed hand owns grab.
 * Partial finger poses own neither and therefore cannot drive the pointer.
 */
export function selectLandmarkManipulationSignal(
  hands: readonly DetectedHand[],
  preferredHand: GestureResult["hand"],
  mapping: CanvasMapping,
  options: LandmarkManipulationOptions = {},
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
  const normalizedPalm = (candidate: DetectedHand) => {
    const palmKnuckles = PALM_ANCHOR_INDEXES.map(
      (index) => candidate.landmarks[index]!,
    );
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
    // The HybridGestureController owns selfie mirroring and its compact
    // control zone. Feed it crop-correct normalized camera coordinates.
    return { x: fitted.x / mapping.canvasWidth, y: fitted.y / mapping.canvasHeight };
  };
  const anchor = options.holding ? options.anchor : null;
  const hand =
    anchor && eligibleHands.length > 1
      ? [...eligibleHands]
          .map((candidate) => {
            const point = normalizedPalm(candidate);
            return { candidate, distance: Math.hypot(point.x - anchor.x, point.y - anchor.y) };
          })
          .sort((left, right) => left.distance - right.distance)[0]?.candidate
      : eligibleHands.find((candidate) => candidate.handedness === preferredHand) ??
        [...eligibleHands].sort(
          (left, right) => right.handednessScore - left.handednessScore,
        )[0];
  if (!hand) {
    return null;
  }

  const palm = estimatePalmPresentation(hand.landmarks);
  const grab = estimateGrabStrength(hand.landmarks);
  const partialPose =
    palm.score < OPEN_PALM_POINTER_MIN_SCORE &&
    grab.strength < CLOSED_HAND_POINTER_MIN_STRENGTH;
  if (partialPose && !options.holding) {
    return null;
  }
  return {
    point: normalizedPalm(hand),
    // HandLandmarker has already applied its detection, presence, and tracking
    // thresholds before returning this complete, finite hand. Its category
    // score only measures certainty that the hand is labelled left vs right;
    // a front-facing open palm can have a low category score while its
    // landmarks remain excellent. Treating that label certainty as tracking
    // quality made Voice recognize the palm while the pointer stayed at the
    // last mouse position.
    trackingConfidence: 1,
    grabStrength: grab.strength,
    grabConfidence: grab.confidence,
    ...(partialPose ? { loose: true } : {}),
  };
}

/** How long a loosened fist keeps a grab or carry before it drops. */
export const LOOSE_GRAB_GRACE_MS = 1_000;
/** Strength reported while the grace runs: above the controller's release. */
const LOOSE_GRAB_HOLD_STRENGTH = 0.62;

/**
 * A grab survives a loosened fist for about a second (gap 7 of the hands-free
 * audit). While holding, a partial pose keeps reporting a closed hand until
 * the grace runs out; a presented open palm still releases at once, because
 * opening the hand is how a presenter drops on purpose.
 */
export class LooseGrabHold {
  private readonly graceMs: number;
  private looseSince: number | null = null;

  constructor(graceMs = LOOSE_GRAB_GRACE_MS) {
    this.graceMs = graceMs;
  }

  /** True while a loose pose is being held through its grace window. */
  get bridging(): boolean {
    return this.looseSince !== null;
  }

  apply(
    signal: LandmarkManipulationSignal | null,
    input: { holding: boolean; timestampMs: number },
  ): LandmarkManipulationSignal | null {
    if (!input.holding || !signal?.loose) {
      this.looseSince = null;
      return signal;
    }
    this.looseSince ??= input.timestampMs;
    if (input.timestampMs - this.looseSince >= this.graceMs) {
      return signal;
    }
    return {
      ...signal,
      grabStrength: Math.max(signal.grabStrength, LOOSE_GRAB_HOLD_STRENGTH),
      grabConfidence: Math.max(signal.grabConfidence, 0.6),
    };
  }

  reset(): void {
    this.looseSince = null;
  }
}
