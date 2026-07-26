/**
 * Conflict-safe undo gesture recognizer.
 *
 * A single landmark-defined open palm swiped left triggers one Undo. Voice
 * uses the mutually exclusive Victory pose, so this tracker owns only
 * directional palm motion. It latches after firing and requires a palm release
 * before it can fire again.
 */

export type UndoGestureTrackerConfig = {
  engageScore: number;
  releaseScore: number;
  /** Leftward travel that reserves the palm stream for Undo. */
  intentDistance: number;
  /** Horizontal travel must dominate vertical drift by at least this ratio. */
  minHorizontalDominance: number;
  minDistance: number;
  maxVerticalDrift: number;
  minDurationMs: number;
  maxDurationMs: number;
  /** Brief pose-score dropout tolerance while the same hand remains tracked. */
  dropoutGraceMs: number;
  releaseMs: number;
  cooldownMs: number;
  mirrorX: boolean;
};

export const defaultUndoGestureTrackerConfig: UndoGestureTrackerConfig = {
  engageScore: 0.68,
  releaseScore: 0.42,
  intentDistance: 0.055,
  minHorizontalDominance: 1.35,
  minDistance: 0.18,
  maxVerticalDrift: 0.12,
  minDurationMs: 90,
  maxDurationMs: 650,
  dropoutGraceMs: 120,
  releaseMs: 180,
  cooldownMs: 1_200,
  mirrorX: true,
};

export type UndoGestureFrame = {
  score: number;
  point: { x: number; y: number } | null;
  timestampMs: number;
  suppressed: boolean;
};

export type UndoGestureEvent = "tracking" | "undo" | null;

type Sample = {
  x: number;
  y: number;
  timestampMs: number;
};

export class UndoGestureTracker {
  private readonly config: UndoGestureTrackerConfig;
  private samples: Sample[] = [];
  private latched = false;
  private releaseSince: number | null = null;
  private lastPoseSeenAt: number | null = null;
  private cooldownUntil = 0;

  constructor(config: Partial<UndoGestureTrackerConfig> = {}) {
    this.config = { ...defaultUndoGestureTrackerConfig, ...config };
  }

  update(frame: UndoGestureFrame): UndoGestureEvent {
    const { score, point, timestampMs, suppressed } = frame;

    const posePresent = point !== null && score >= this.config.releaseScore;
    if (posePresent) {
      this.lastPoseSeenAt = timestampMs;
    }
    const withinDropoutGrace =
      !suppressed &&
      !posePresent &&
      this.lastPoseSeenAt !== null &&
      timestampMs - this.lastPoseSeenAt <= this.config.dropoutGraceMs;
    if (withinDropoutGrace) {
      return null;
    }

    if (suppressed || !posePresent) {
      this.samples = [];
      const lastPoseSeenAt = this.lastPoseSeenAt;
      this.lastPoseSeenAt = null;
      if (!this.latched) {
        this.releaseSince = null;
        return null;
      }
      if (this.releaseSince === null) {
        this.releaseSince =
          suppressed || lastPoseSeenAt === null
            ? timestampMs
            : lastPoseSeenAt + this.config.dropoutGraceMs;
      }
      if (timestampMs - this.releaseSince >= this.config.releaseMs) {
        this.latched = false;
        this.releaseSince = null;
      }
      return null;
    }

    this.releaseSince = null;
    if (this.latched || timestampMs < this.cooldownUntil) {
      return null;
    }
    if (score < this.config.engageScore && this.samples.length === 0) {
      return null;
    }

    const sample: Sample = {
      x: this.config.mirrorX ? 1 - point.x : point.x,
      y: point.y,
      timestampMs,
    };
    this.samples.push(sample);
    this.samples = this.samples.filter(
      (candidate) => timestampMs - candidate.timestampMs <= this.config.maxDurationMs,
    );

    const start = this.samples[0];
    if (!start) {
      return null;
    }
    const duration = timestampMs - start.timestampMs;
    const horizontalDistance = sample.x - start.x;
    const verticalDistance = Math.abs(sample.y - start.y);
    const horizontalDominant =
      Math.abs(horizontalDistance) >=
      Math.max(verticalDistance * this.config.minHorizontalDominance, 0.001);
    const hasUndoIntent =
      horizontalDistance <= -this.config.intentDistance &&
      horizontalDominant &&
      verticalDistance <= this.config.maxVerticalDrift;

    // A clear wrong-way or vertical sweep starts a fresh candidate. This keeps
    // ordinary presenter motion from leaving a stale origin that later turns a
    // small correction into an undo.
    if (
      horizontalDistance >= this.config.intentDistance ||
      verticalDistance > this.config.maxVerticalDrift
    ) {
      this.samples = [sample];
      return null;
    }
    if (duration < this.config.minDurationMs) {
      return hasUndoIntent ? "tracking" : null;
    }
    if (
      horizontalDistance > -this.config.minDistance ||
      !horizontalDominant
    ) {
      return hasUndoIntent ? "tracking" : null;
    }
    if (score < this.config.engageScore) {
      return "tracking";
    }

    this.samples = [];
    this.latched = true;
    this.cooldownUntil = timestampMs + this.config.cooldownMs;
    return "undo";
  }

  reset(): void {
    this.samples = [];
    this.latched = false;
    this.releaseSince = null;
    this.lastPoseSeenAt = null;
    this.cooldownUntil = 0;
  }
}
