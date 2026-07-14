/**
 * Two-hand canvas navigation: pan with two OPEN palms moving together, zoom
 * with two CLOSED hands spreading/converging. Hand count is the first-level
 * separator from every single-hand gesture (grab, palm push-to-talk, catalog
 * pinch), and pose keeps pan and zoom separate from each other: a session is
 * engaged as ONE mode and never morphs — switching poses releases (with
 * hysteresis) and re-engages, so a zoom can never smear into a pan.
 *
 * Pure over injected timestamps; all timing rules are unit-testable.
 */

export type NavHand = {
  /** Hand anchor in canvas pixels (already mirrored/mapped by the caller). */
  point: { x: number; y: number };
  /** 0..1 closed-hand signal from estimateGrabStrength. */
  grabStrength: number;
};

export type NavFrame = {
  hands: readonly NavHand[];
  timestampMs: number;
};

export type NavUpdate =
  | { mode: "idle" }
  | { mode: "pan"; dx: number; dy: number }
  | { mode: "zoom"; factor: number; anchor: { x: number; y: number } };

export type CanvasNavigationConfig = {
  /** At/below this grab strength a hand counts as open. */
  openMax: number;
  /** At/above this grab strength a hand counts as closed. */
  closedMin: number;
  /** A candidate pose must hold this long before navigation engages. */
  engageMs: number;
  /** Pose loss must persist this long before navigation releases. */
  releaseMs: number;
};

export const defaultCanvasNavigationConfig: CanvasNavigationConfig = {
  openMax: 0.35,
  closedMin: 0.68,
  engageMs: 150,
  releaseMs: 200,
};

type NavMode = "pan" | "zoom";

export class CanvasNavigationTracker {
  private readonly config: CanvasNavigationConfig;
  private candidateMode: NavMode | null = null;
  private candidateSince = 0;
  private engagedMode: NavMode | null = null;
  private mismatchSince: number | null = null;
  private baseline: { midpoint: { x: number; y: number }; distance: number } | null = null;

  constructor(config: Partial<CanvasNavigationConfig> = {}) {
    this.config = { ...defaultCanvasNavigationConfig, ...config };
  }

  /** True while a navigation session is active — single-hand gestures must yield. */
  get engaged(): boolean {
    return this.engagedMode !== null;
  }

  get mode(): NavMode | null {
    return this.engagedMode;
  }

  update(frame: NavFrame): NavUpdate {
    const pose = this.classify(frame.hands);

    if (this.engagedMode === null) {
      if (!pose) {
        this.candidateMode = null;
        return { mode: "idle" };
      }
      if (this.candidateMode !== pose.mode) {
        this.candidateMode = pose.mode;
        this.candidateSince = frame.timestampMs;
        return { mode: "idle" };
      }
      if (frame.timestampMs - this.candidateSince >= this.config.engageMs) {
        this.engagedMode = pose.mode;
        this.mismatchSince = null;
        this.baseline = { midpoint: pose.midpoint, distance: pose.distance };
      }
      return { mode: "idle" };
    }

    // Engaged. A frame in a different (or no) pose starts the release clock;
    // navigation freezes rather than jumping while the pose flickers.
    if (!pose || pose.mode !== this.engagedMode) {
      if (this.mismatchSince === null) {
        this.mismatchSince = frame.timestampMs;
      } else if (frame.timestampMs - this.mismatchSince >= this.config.releaseMs) {
        this.reset();
      }
      return { mode: "idle" };
    }

    if (this.mismatchSince !== null || this.baseline === null) {
      // Pose regained after a flicker: rebase so the freeze never becomes a jump.
      this.mismatchSince = null;
      this.baseline = { midpoint: pose.midpoint, distance: pose.distance };
      return { mode: "idle" };
    }

    const baseline = this.baseline;
    this.baseline = { midpoint: pose.midpoint, distance: pose.distance };

    if (this.engagedMode === "pan") {
      return {
        mode: "pan",
        dx: pose.midpoint.x - baseline.midpoint.x,
        dy: pose.midpoint.y - baseline.midpoint.y,
      };
    }
    const factor =
      baseline.distance > 1e-3 ? pose.distance / baseline.distance : 1;
    return { mode: "zoom", factor, anchor: pose.midpoint };
  }

  reset(): void {
    this.candidateMode = null;
    this.engagedMode = null;
    this.mismatchSince = null;
    this.baseline = null;
  }

  private classify(hands: readonly NavHand[]):
    | { mode: NavMode; midpoint: { x: number; y: number }; distance: number }
    | null {
    if (hands.length !== 2) {
      return null;
    }
    const [a, b] = hands as [NavHand, NavHand];
    const bothOpen =
      a.grabStrength <= this.config.openMax && b.grabStrength <= this.config.openMax;
    const bothClosed =
      a.grabStrength >= this.config.closedMin && b.grabStrength >= this.config.closedMin;
    if (!bothOpen && !bothClosed) {
      return null;
    }
    return {
      mode: bothOpen ? "pan" : "zoom",
      midpoint: { x: (a.point.x + b.point.x) / 2, y: (a.point.y + b.point.y) / 2 },
      distance: Math.hypot(a.point.x - b.point.x, a.point.y - b.point.y),
    };
  }
}
