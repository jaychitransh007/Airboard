/**
 * Push-to-talk pose gate: a debounced, hysteresis-guarded state machine over
 * the palm-presentation score stream. Pure and clock-free (timestamps are
 * inputs), so the engage/release timing rules are unit-testable without a
 * camera. The caller supplies the per-frame best pose score/point (from
 * estimatePalmPresentation) and current gate context; the tracker answers
 * with the transition to perform, never performing it itself.
 */

export type PalmGateTrackerConfig = {
  /** Pose score at or above which the pose is an engage candidate. */
  engageScore: number;
  /** Below this score an engaged gate starts its release countdown. */
  releaseScore: number;
  /** The candidate pose must hold still this long before engaging. */
  engageMs: number;
  /** The score must stay below releaseScore this long before releasing. */
  releaseMs: number;
  /** Normalized camera-space drift allowed while the pose "holds still". */
  stillnessRadius: number;
};

export const defaultPalmGateTrackerConfig: PalmGateTrackerConfig = {
  engageScore: 0.62,
  releaseScore: 0.45,
  engageMs: 280,
  releaseMs: 240,
  stillnessRadius: 0.06,
};

export type PalmGateFrame = {
  /** Best palm-presentation score across detected hands this frame. */
  score: number;
  /** Anchor point (normalized camera space) of the best-scoring hand. */
  point: { x: number; y: number } | null;
  timestampMs: number;
  /** Whether the push-to-talk gate is currently open. */
  gateOpen: boolean;
  /** True while another gate (e.g. scoped hold-to-edit) outranks engagement. */
  suppressed: boolean;
};

export type PalmGateEvent = "engage" | "release" | null;

export class PalmGateTracker {
  private readonly config: PalmGateTrackerConfig;
  private candidateSince: number | null = null;
  private anchor: { x: number; y: number } | null = null;
  private belowSince: number | null = null;

  constructor(config: Partial<PalmGateTrackerConfig> = {}) {
    this.config = { ...defaultPalmGateTrackerConfig, ...config };
  }

  update(frame: PalmGateFrame): PalmGateEvent {
    const { score, point, timestampMs, gateOpen, suppressed } = frame;

    if (score >= this.config.engageScore && point) {
      this.belowSince = null;
      const drifted =
        this.anchor !== null &&
        Math.hypot(point.x - this.anchor.x, point.y - this.anchor.y) >
          this.config.stillnessRadius;
      if (this.candidateSince === null || this.anchor === null || drifted) {
        this.candidateSince = timestampMs;
        this.anchor = point;
        return null;
      }
      if (
        !gateOpen &&
        !suppressed &&
        timestampMs - this.candidateSince >= this.config.engageMs
      ) {
        return "engage";
      }
      return null;
    }

    this.candidateSince = null;
    this.anchor = null;
    if (!gateOpen) {
      this.belowSince = null;
      return null;
    }
    if (score >= this.config.releaseScore) {
      // Hysteresis band: an engaged gate survives a briefly weaker pose.
      this.belowSince = null;
      return null;
    }
    if (this.belowSince === null) {
      this.belowSince = timestampMs;
      return null;
    }
    if (timestampMs - this.belowSince >= this.config.releaseMs) {
      this.belowSince = null;
      return "release";
    }
    return null;
  }

  reset(): void {
    this.candidateSince = null;
    this.anchor = null;
    this.belowSince = null;
  }
}
