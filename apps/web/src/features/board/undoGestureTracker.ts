/**
 * Conflict-safe undo gesture recognizer.
 *
 * A single, presented open palm swiped left triggers one undo. The existing
 * push-to-talk gesture deliberately requires the same palm to hold still, so
 * motion makes these two intents mutually exclusive. The tracker latches after
 * firing and requires a palm release before it can fire again.
 */

export type UndoGestureTrackerConfig = {
  engageScore: number;
  releaseScore: number;
  /** Leftward travel that reserves the palm for undo instead of push-to-talk. */
  intentDistance: number;
  /** Horizontal travel must dominate vertical drift by at least this ratio. */
  minHorizontalDominance: number;
  minDistance: number;
  maxVerticalDrift: number;
  minDurationMs: number;
  maxDurationMs: number;
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
  private cooldownUntil = 0;

  constructor(config: Partial<UndoGestureTrackerConfig> = {}) {
    this.config = { ...defaultUndoGestureTrackerConfig, ...config };
  }

  update(frame: UndoGestureFrame): UndoGestureEvent {
    const { score, point, timestampMs, suppressed } = frame;

    if (suppressed || !point || score < this.config.releaseScore) {
      this.samples = [];
      if (!this.latched) {
        this.releaseSince = null;
        return null;
      }
      if (this.releaseSince === null) {
        this.releaseSince = timestampMs;
        return null;
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
    if (score < this.config.engageScore) {
      this.samples = [];
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

    this.samples = [];
    this.latched = true;
    this.cooldownUntil = timestampMs + this.config.cooldownMs;
    return "undo";
  }

  reset(): void {
    this.samples = [];
    this.latched = false;
    this.releaseSince = null;
    this.cooldownUntil = 0;
  }
}
