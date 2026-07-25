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

export type UndoGestureEvent = "undo" | null;

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
    if (duration < this.config.minDurationMs) {
      return null;
    }
    const horizontalDistance = sample.x - start.x;
    const verticalDistance = Math.abs(sample.y - start.y);
    if (
      horizontalDistance > -this.config.minDistance ||
      verticalDistance > this.config.maxVerticalDrift
    ) {
      return null;
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
