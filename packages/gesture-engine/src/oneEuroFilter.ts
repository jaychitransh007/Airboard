type LowPassState = {
  initialized: boolean;
  raw: number;
  filtered: number;
};

export type OneEuroFilterOptions = {
  minCutoff?: number;
  beta?: number;
  derivativeCutoff?: number;
};

export class OneEuroFilter {
  private readonly minCutoff: number;
  private readonly beta: number;
  private readonly derivativeCutoff: number;
  private valueState: LowPassState = { initialized: false, raw: 0, filtered: 0 };
  private derivativeState: LowPassState = { initialized: false, raw: 0, filtered: 0 };
  private lastTimestampMs: number | null = null;

  constructor(options: OneEuroFilterOptions = {}) {
    this.minCutoff = options.minCutoff ?? 1.15;
    this.beta = options.beta ?? 0.015;
    this.derivativeCutoff = options.derivativeCutoff ?? 1;
  }

  reset(): void {
    this.valueState = { initialized: false, raw: 0, filtered: 0 };
    this.derivativeState = { initialized: false, raw: 0, filtered: 0 };
    this.lastTimestampMs = null;
  }

  filter(value: number, timestampMs: number): number {
    const dtSeconds = this.getDeltaSeconds(timestampMs);
    const derivative = this.valueState.initialized
      ? (value - this.valueState.filtered) / dtSeconds
      : 0;
    const filteredDerivative = lowPass(
      this.derivativeState,
      derivative,
      alpha(this.derivativeCutoff, dtSeconds),
    );
    const cutoff = this.minCutoff + this.beta * Math.abs(filteredDerivative);
    return lowPass(this.valueState, value, alpha(cutoff, dtSeconds));
  }

  private getDeltaSeconds(timestampMs: number): number {
    if (this.lastTimestampMs === null) {
      this.lastTimestampMs = timestampMs;
      return 1 / 60;
    }

    const dtSeconds = Math.max((timestampMs - this.lastTimestampMs) / 1000, 1 / 240);
    this.lastTimestampMs = timestampMs;
    return dtSeconds;
  }
}

function alpha(cutoff: number, dtSeconds: number): number {
  const tau = 1 / (2 * Math.PI * cutoff);
  return 1 / (1 + tau / dtSeconds);
}

function lowPass(state: LowPassState, value: number, alphaValue: number): number {
  if (!state.initialized) {
    state.initialized = true;
    state.raw = value;
    state.filtered = value;
    return value;
  }

  state.raw = value;
  state.filtered = alphaValue * value + (1 - alphaValue) * state.filtered;
  return state.filtered;
}
