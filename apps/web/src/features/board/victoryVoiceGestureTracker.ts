/**
 * One-shot voice activation from Airboard's landmark-defined Victory pose.
 *
 * The caller supplies the Victory geometry score and palm anchor only
 * when exactly one hand is present. This tracker owns the temporal contract:
 * the pose must remain stable for a short hold, fires once, and cannot re-arm
 * until the pose has been released and the cooldown has elapsed.
 */

export type VictoryVoiceGestureTrackerConfig = {
  /** Victory landmark score at or above which a new hold may begin. */
  engageScore: number;
  /** Below this pose score, an active pose begins its release countdown. */
  releaseScore: number;
  /** Duration of a stable Victory pose before voice activation. */
  holdMs: number;
  /** Sustained pose loss required before another activation can be armed. */
  releaseMs: number;
  /** Brief pose-score dropout tolerance while the same hand remains tracked. */
  dropoutGraceMs: number;
  /** Normalized camera-space drift allowed during the hold. */
  stillnessRadius: number;
  /** Minimum time between successive activation events. */
  cooldownMs: number;
};

export const defaultVictoryVoiceGestureTrackerConfig: VictoryVoiceGestureTrackerConfig = {
  engageScore: 0.72,
  releaseScore: 0.45,
  holdMs: 400,
  releaseMs: 220,
  dropoutGraceMs: 120,
  stillnessRadius: 0.06,
  cooldownMs: 900,
};

export type VictoryVoiceGestureFrame = {
  /** Airboard Victory landmark score in the range 0..1. */
  score: number;
  /**
   * Anchor for the one detected hand, or null unless exactly one hand is
   * eligible. Using null for zero/two hands prevents ambiguous activation.
   */
  point: { x: number; y: number } | null;
  timestampMs: number;
  /** True while a higher-priority gesture or interaction owns the hand stream. */
  suppressed: boolean;
};

export type VictoryVoiceGestureEvent = "activate" | "release" | null;

export class VictoryVoiceGestureTracker {
  private readonly config: VictoryVoiceGestureTrackerConfig;
  private candidateSince: number | null = null;
  private anchor: { x: number; y: number } | null = null;
  private latched = false;
  private releaseSince: number | null = null;
  private lastPoseSeenAt: number | null = null;
  private cooldownUntil = 0;

  constructor(config: Partial<VictoryVoiceGestureTrackerConfig> = {}) {
    this.config = {
      ...defaultVictoryVoiceGestureTrackerConfig,
      ...config,
    };
  }

  /**
   * True from the first qualifying Victory frame until the hold is cancelled
   * or the fired pose is released. Other one-hand gestures should yield while
   * this tracker reserves the stream.
   */
  get reserving(): boolean {
    return this.candidateSince !== null || this.latched;
  }

  /** True after activation and until a sustained release. */
  get engaged(): boolean {
    return this.latched;
  }

  update(frame: VictoryVoiceGestureFrame): VictoryVoiceGestureEvent {
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
    const poseReleased = suppressed || !posePresent;

    if (this.latched) {
      this.candidateSince = null;
      this.anchor = null;
      if (!poseReleased) {
        this.releaseSince = null;
        return null;
      }
      if (this.releaseSince === null) {
        this.releaseSince =
          suppressed || this.lastPoseSeenAt === null
            ? timestampMs
            : this.lastPoseSeenAt + this.config.dropoutGraceMs;
      }
      if (timestampMs - this.releaseSince >= this.config.releaseMs) {
        this.latched = false;
        this.releaseSince = null;
        this.lastPoseSeenAt = null;
        return "release";
      }
      return null;
    }

    this.releaseSince = null;
    if (suppressed || timestampMs < this.cooldownUntil || poseReleased) {
      this.clearCandidate();
      if (suppressed || poseReleased) {
        this.lastPoseSeenAt = null;
      }
      return null;
    }

    if (this.candidateSince === null || this.anchor === null) {
      if (score < this.config.engageScore || !point) {
        return null;
      }
      this.candidateSince = timestampMs;
      this.anchor = point;
      return null;
    }

    if (!point) {
      this.clearCandidate();
      return null;
    }
    const drift = Math.hypot(point.x - this.anchor.x, point.y - this.anchor.y);
    if (drift > this.config.stillnessRadius) {
      this.clearCandidate();
      if (score >= this.config.engageScore) {
        this.candidateSince = timestampMs;
        this.anchor = point;
      }
      return null;
    }

    // A score in the hysteresis band preserves an existing hold but cannot
    // complete it. This absorbs a weak frame without activating on a weak pose.
    if (score < this.config.engageScore) {
      return null;
    }
    if (timestampMs - this.candidateSince < this.config.holdMs) {
      return null;
    }

    this.clearCandidate();
    this.latched = true;
    this.cooldownUntil = timestampMs + this.config.cooldownMs;
    return "activate";
  }

  reset(): void {
    this.clearCandidate();
    this.latched = false;
    this.releaseSince = null;
    this.lastPoseSeenAt = null;
    this.cooldownUntil = 0;
  }

  private clearCandidate(): void {
    this.candidateSince = null;
    this.anchor = null;
  }
}
