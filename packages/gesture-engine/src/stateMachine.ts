import type {
  GestureClassifierOutput,
  GestureConfig,
  GestureMode,
  GestureName,
} from "./types";

type ActiveGesture = {
  gesture: GestureName;
  firstSeenAt: number;
};

export class GestureStateMachine {
  private activeGesture: ActiveGesture | null = null;
  private lastMode: GestureMode = "idle";

  update(result: GestureClassifierOutput, config: GestureConfig): {
    mode: GestureMode;
    justChanged: boolean;
  } {
    const threshold =
      result.gesture === "marker"
        ? config.markerGestureConfidenceThreshold
        : result.gesture === "duster"
          ? config.dusterGestureConfidenceThreshold
          : 1;
    const now = result.cursorPoint.t;
    const candidateActive = result.confidence >= threshold;

    if (!candidateActive) {
      this.activeGesture = null;
      return this.transition("idle");
    }

    if (!this.activeGesture || this.activeGesture.gesture !== result.gesture) {
      this.activeGesture = {
        gesture: result.gesture,
        firstSeenAt: now,
      };
      return this.transition(result.gesture === "marker" ? "marker_ready" : "duster_ready");
    }

    const activationReady = now - this.activeGesture.firstSeenAt >= config.activationDurationMs;
    if (!activationReady) {
      return this.transition(result.gesture === "marker" ? "marker_ready" : "duster_ready");
    }

    return this.transition(result.gesture === "marker" ? "writing" : "erasing");
  }

  reset(): void {
    this.activeGesture = null;
    this.lastMode = "idle";
  }

  private transition(mode: GestureMode): { mode: GestureMode; justChanged: boolean } {
    const justChanged = mode !== this.lastMode;
    this.lastMode = mode;
    return { mode, justChanged };
  }
}
