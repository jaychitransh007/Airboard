import { clamp } from "./math.js";

export type PinchPhase = "open" | "closing" | "closed" | "opening";

export type PinchHysteresisConfig = {
  /** Pinch strength at which a possible grab starts. */
  engageThreshold: number;
  /** Lower strength at which a possible release starts. */
  releaseThreshold: number;
  /** Time above engageThreshold required before a grab is emitted. */
  engageDebounceMs: number;
  /** Time below releaseThreshold required before a release is emitted. */
  releaseDebounceMs: number;
};

export type PinchHysteresisOutput = {
  phase: PinchPhase;
  strength: number;
  engaged: boolean;
  released: boolean;
};

export const defaultPinchHysteresisConfig: PinchHysteresisConfig = {
  engageThreshold: 0.72,
  releaseThreshold: 0.45,
  engageDebounceMs: 80,
  releaseDebounceMs: 70,
};

/**
 * Turns a noisy 0..1 pinch signal into debounced engage/release edges.
 * Separate thresholds make the closed state resistant to hand jitter.
 */
export class PinchHysteresis {
  private readonly config: PinchHysteresisConfig;
  private active = false;
  private pendingSince: number | null = null;
  private pendingKind: "engage" | "release" | null = null;
  private lastTimestampMs: number | null = null;
  private lastStrength = 0;

  constructor(config: Partial<PinchHysteresisConfig> = {}) {
    this.config = { ...defaultPinchHysteresisConfig, ...config };
    validateConfig(this.config);
  }

  update(strength: number, timestampMs: number): PinchHysteresisOutput {
    const safeStrength = clamp(Number.isFinite(strength) ? strength : 0);
    const now = this.monotonicTimestamp(timestampMs);
    this.lastStrength = safeStrength;

    if (!this.active) {
      if (safeStrength < this.config.engageThreshold) {
        this.clearPending();
        return this.output("open");
      }

      const elapsed = this.startOrContinue("engage", now);
      if (elapsed >= this.config.engageDebounceMs) {
        this.active = true;
        this.clearPending();
        return this.output("closed", true, false);
      }

      return this.output("closing");
    }

    if (safeStrength > this.config.releaseThreshold) {
      this.clearPending();
      return this.output("closed");
    }

    const elapsed = this.startOrContinue("release", now);
    if (elapsed >= this.config.releaseDebounceMs) {
      this.active = false;
      this.clearPending();
      return this.output("open", false, true);
    }

    return this.output("opening");
  }

  snapshot(): PinchHysteresisOutput {
    const phase: PinchPhase = this.active
      ? this.pendingKind === "release"
        ? "opening"
        : "closed"
      : this.pendingKind === "engage"
        ? "closing"
        : "open";
    return this.output(phase);
  }

  reset(): void {
    this.active = false;
    this.pendingSince = null;
    this.pendingKind = null;
    this.lastTimestampMs = null;
    this.lastStrength = 0;
  }

  private monotonicTimestamp(timestampMs: number): number {
    const safeTimestamp = Number.isFinite(timestampMs) ? timestampMs : (this.lastTimestampMs ?? 0);
    const result = Math.max(safeTimestamp, this.lastTimestampMs ?? safeTimestamp);
    this.lastTimestampMs = result;
    return result;
  }

  private startOrContinue(kind: "engage" | "release", timestampMs: number): number {
    if (this.pendingKind !== kind || this.pendingSince === null) {
      this.pendingKind = kind;
      this.pendingSince = timestampMs;
    }
    return timestampMs - this.pendingSince;
  }

  private clearPending(): void {
    this.pendingSince = null;
    this.pendingKind = null;
  }

  private output(
    phase: PinchPhase,
    engaged = false,
    released = false,
  ): PinchHysteresisOutput {
    return {
      phase,
      strength: this.lastStrength,
      engaged,
      released,
    };
  }
}

/**
 * Converts a normalized thumb/index distance into a 0..1 pinch strength.
 * Distances at or below closedDistance yield 1; distances at or above
 * openDistance yield 0. Callers should normalize distance by hand scale.
 */
export function pinchStrengthFromDistance(
  normalizedDistance: number,
  closedDistance = 0.2,
  openDistance = 0.75,
): number {
  if (!(openDistance > closedDistance)) {
    throw new Error("openDistance must be greater than closedDistance");
  }
  return clamp((openDistance - normalizedDistance) / (openDistance - closedDistance));
}

function validateConfig(config: PinchHysteresisConfig): void {
  if (
    !Number.isFinite(config.engageThreshold) ||
    !Number.isFinite(config.releaseThreshold) ||
    config.engageThreshold <= config.releaseThreshold ||
    config.engageThreshold > 1 ||
    config.releaseThreshold < 0
  ) {
    throw new Error("pinch thresholds must satisfy 0 <= release < engage <= 1");
  }
  if (config.engageDebounceMs < 0 || config.releaseDebounceMs < 0) {
    throw new Error("pinch debounce durations must be non-negative");
  }
}
