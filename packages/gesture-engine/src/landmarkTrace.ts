import { estimateGrabStrength } from "./grabStrength.ts";
import { estimatePalmPresentation } from "./palmPresentation.ts";
import { PinchHysteresis } from "./pinchHysteresis.ts";
import type { HandLandmark } from "./types.ts";

/**
 * Landmark-trace replay: the ground-truth harness for pose thresholds.
 *
 * The web app's "Record 5s landmark trace" button captures real MediaPipe
 * frames into this JSON shape; fixtures replayed in tests turn every
 * threshold change from a gamble validated by one person waving at one
 * laptop into a measurable diff over recorded reality.
 */

export type LandmarkTraceFrame = {
  /** Milliseconds since recording start. */
  t: number;
  hands: {
    handedness: string;
    score: number;
    /** 21 landmarks as [x, y, z] in normalized image coordinates. */
    landmarks: [number, number, number][];
  }[];
};

export type LandmarkTrace = {
  schemaVersion: "1.0";
  recordedAt?: string;
  description?: string;
  frames: LandmarkTraceFrame[];
};

export type ReplaySample = {
  t: number;
  /** Best palm-presentation score across hands in the frame. */
  palmScore: number;
  /** Best grab strength across hands in the frame. */
  grabStrength: number;
};

export function replayLandmarkTrace(trace: LandmarkTrace): ReplaySample[] {
  return trace.frames.map((frame) => {
    let palmScore = 0;
    let grabStrength = 0;
    for (const hand of frame.hands) {
      const landmarks: HandLandmark[] = hand.landmarks.map(([x, y, z]) => ({ x, y, z }));
      palmScore = Math.max(palmScore, estimatePalmPresentation(landmarks).score);
      grabStrength = Math.max(grabStrength, estimateGrabStrength(landmarks).strength);
    }
    return { t: frame.t, palmScore, grabStrength };
  });
}

/**
 * Offline-only replay diagnostics. These are deliberately kept out of the
 * runtime gesture pipeline: the evaluator observes the same estimators and
 * production thresholds without becoming another production control path.
 */
export type LandmarkTraceReplayOwner = "palm" | "grab" | "none";

export type LandmarkTraceReplayStage =
  | "input"
  | "validation"
  | "estimation"
  | "ownership"
  | "temporal_gate";

export type LandmarkTraceReplayStageStatus =
  | "passed"
  | "degraded"
  | "skipped";

export type LandmarkTraceReplayStageDiagnostic = {
  status: LandmarkTraceReplayStageStatus;
  codes: string[];
};

export type LandmarkTraceReplaySuppressionReason =
  | "no_hand"
  | "multiple_hands"
  | "invalid_hand"
  | "low_estimator_confidence"
  | "below_engage_threshold"
  | "owned_by_grab"
  | "owned_by_palm";

export type LandmarkTraceReplayGatePhase =
  | "idle"
  | "acquiring"
  | "active"
  | "releasing";

export type LandmarkTraceReplayTransition<T extends string> = {
  from: T;
  to: T;
};

export type LandmarkTraceReplayHandDiagnostic = {
  handIndex: number;
  handedness: string;
  handednessScore: number | null;
  landmarkCount: number;
  finiteLandmarkCount: number;
  valid: boolean;
  issues: string[];
  palm: ReturnType<typeof estimatePalmPresentation>;
  grab: ReturnType<typeof estimateGrabStrength>;
  anchor: { x: number; y: number } | null;
};

export type LandmarkTraceReplayActionType =
  | "palm_acquire"
  | "palm_release"
  | "grab_acquire"
  | "grab_release";

export type LandmarkTraceReplayAction = {
  sequence: number;
  frameIndex: number;
  t: number;
  gesture: "palm" | "grab";
  kind: "acquire" | "release";
  type: LandmarkTraceReplayActionType;
  /** The raw-signal owner on the frame where the action was emitted. */
  frameOwner: LandmarkTraceReplayOwner;
  /** Time spent continuously satisfying the acquire/release gate. */
  latencyMs: number;
  signalSinceMs: number;
};

export type LandmarkTraceReplayFrame = ReplaySample & {
  frameIndex: number;
  sourceT: number | null;
  deltaMs: number | null;
  handCount: number;
  validHandCount: number;
  selectedHandIndex: number | null;
  hands: LandmarkTraceReplayHandDiagnostic[];
  palmConfidence: number;
  grabConfidence: number;
  owner: LandmarkTraceReplayOwner;
  suppression: {
    palm: LandmarkTraceReplaySuppressionReason[];
    grab: LandmarkTraceReplaySuppressionReason[];
  };
  phase: {
    palm: LandmarkTraceReplayGatePhase;
    grab: LandmarkTraceReplayGatePhase;
  };
  transition: {
    owner: LandmarkTraceReplayTransition<LandmarkTraceReplayOwner> | null;
    palm: LandmarkTraceReplayTransition<LandmarkTraceReplayGatePhase> | null;
    grab: LandmarkTraceReplayTransition<LandmarkTraceReplayGatePhase> | null;
  };
  actions: LandmarkTraceReplayAction[];
  stages: Record<
    LandmarkTraceReplayStage,
    LandmarkTraceReplayStageDiagnostic
  >;
};

export type LandmarkTracePalmReplayConfig = {
  /** Matches PalmVoiceGestureTracker's production engage score. */
  engageScore: number;
  /** Matches PalmVoiceGestureTracker's production release score. */
  releaseScore: number;
  holdMs: number;
  releaseMs: number;
  dropoutGraceMs: number;
  stillnessRadius: number;
  cooldownMs: number;
  minimumConfidence: number;
};

export type LandmarkTraceGrabReplayConfig = {
  /** Matches the board's closed-hand HybridGestureController engage score. */
  engageStrength: number;
  /** Matches the board's closed-hand HybridGestureController release score. */
  releaseStrength: number;
  engageMs: number;
  releaseMs: number;
  minimumConfidence: number;
  trackingLossGraceMs: number;
};

export type LandmarkTraceReplayConfig = {
  expectedFrameIntervalMs: number;
  palm: LandmarkTracePalmReplayConfig;
  grab: LandmarkTraceGrabReplayConfig;
};

export type LandmarkTraceReplayOptions = {
  expectedFrameIntervalMs?: number;
  palm?: Partial<LandmarkTracePalmReplayConfig>;
  grab?: Partial<LandmarkTraceGrabReplayConfig>;
};

export const defaultLandmarkTraceReplayConfig: LandmarkTraceReplayConfig = {
  expectedFrameIntervalMs: 1000 / 30,
  palm: {
    engageScore: 0.68,
    releaseScore: 0.42,
    holdMs: 400,
    releaseMs: 220,
    dropoutGraceMs: 120,
    stillnessRadius: 0.06,
    cooldownMs: 900,
    minimumConfidence: 1,
  },
  grab: {
    engageStrength: 0.6,
    releaseStrength: 0.3,
    engageMs: 55,
    releaseMs: 80,
    minimumConfidence: 0.55,
    trackingLossGraceMs: 420,
  },
};

export type LandmarkTraceReplayTimingMetrics = {
  samplesMs: number[];
  minMs: number | null;
  maxMs: number | null;
  meanMs: number | null;
  p50Ms: number | null;
  p95Ms: number | null;
};

export type LandmarkTraceReplayGestureMetrics = {
  acquireCount: number;
  releaseCount: number;
  duplicateAcquireCount: number;
  orphanReleaseCount: number;
  unpairedAcquireCount: number;
  activeDurationMs: number;
  acquireTiming: LandmarkTraceReplayTimingMetrics;
  releaseTiming: LandmarkTraceReplayTimingMetrics;
};

export type LandmarkTraceReplayMetrics = {
  actionCount: number;
  duplicateActionCount: number;
  unpairedActionCount: number;
  palm: LandmarkTraceReplayGestureMetrics;
  grab: LandmarkTraceReplayGestureMetrics;
};

export type LandmarkTraceReplaySummary = {
  frameCount: number;
  durationMs: number;
  framesWithHands: number;
  framesWithInvalidHands: number;
  nonMonotonicTimestampFrames: number;
  stageCounts: Record<
    LandmarkTraceReplayStage,
    Record<LandmarkTraceReplayStageStatus, number>
  >;
};

export type LandmarkTraceReplayReport = {
  schemaVersion: "1.0";
  traceSchemaVersion: LandmarkTrace["schemaVersion"];
  config: LandmarkTraceReplayConfig;
  frames: LandmarkTraceReplayFrame[];
  actions: LandmarkTraceReplayAction[];
  metrics: LandmarkTraceReplayMetrics;
  summary: LandmarkTraceReplaySummary;
};

/**
 * Replays a trace through an offline temporal/routing layer and returns
 * per-frame stage diagnostics plus action-level metrics.
 *
 * The score-only replay above remains unchanged for threshold fixtures. This
 * richer form is for corpus evaluation: it makes input degradation, ownership,
 * suppression, state transitions, duplicate actions, and gate timing visible
 * without mutating production controller state.
 */
export function replayLandmarkTraceWithDiagnostics(
  trace: LandmarkTrace,
  options: LandmarkTraceReplayOptions = {},
): LandmarkTraceReplayReport {
  const config = resolveReplayConfig(options);
  const palmGate = new PalmReplayGate(config.palm);
  const grabGate = new GrabReplayGate(config.grab);
  const frames: LandmarkTraceReplayFrame[] = [];
  const actions: LandmarkTraceReplayAction[] = [];
  let previousTimestamp: number | null = null;
  let previousOwner: LandmarkTraceReplayOwner = "none";
  let lastGrabEvidenceAt: number | null = null;

  for (const [frameIndex, frame] of trace.frames.entries()) {
    const sourceT = Number.isFinite(frame.t) ? frame.t : null;
    const fallbackTimestamp =
      previousTimestamp === null
        ? 0
        : previousTimestamp + config.expectedFrameIntervalMs;
    const timestamp = Math.max(
      sourceT ?? fallbackTimestamp,
      previousTimestamp ?? Number.NEGATIVE_INFINITY,
    );
    const inputCodes: string[] = [];
    if (sourceT === null) {
      inputCodes.push("timestamp_non_finite");
    } else if (previousTimestamp !== null && sourceT < previousTimestamp) {
      inputCodes.push("timestamp_regression");
    } else if (previousTimestamp !== null && sourceT === previousTimestamp) {
      inputCodes.push("timestamp_duplicate");
    }
    const deltaMs =
      previousTimestamp === null ? null : timestamp - previousTimestamp;

    const rawHands = Array.isArray(frame.hands) ? frame.hands : [];
    const hands = rawHands.map((hand, handIndex) =>
      diagnoseReplayHand(hand, handIndex),
    );
    const validHands = hands.filter((hand) => hand.valid);
    const selectedHand =
      rawHands.length === 1 && validHands.length === 1
        ? validHands[0] ?? null
        : null;
    const palmBest = bestHandBy(hands, (hand) => hand.palm.score);
    const grabBest = bestHandBy(hands, (hand) => hand.grab.strength);
    const palmScore = palmBest?.palm.score ?? 0;
    const grabStrength = grabBest?.grab.strength ?? 0;
    const palmConfidence = palmBest?.palm.confidence ?? 0;
    const grabConfidence = grabBest?.grab.confidence ?? 0;

    const palmEligible =
      selectedHand !== null &&
      selectedHand.palm.confidence >= config.palm.minimumConfidence;
    const grabEligible =
      selectedHand !== null &&
      selectedHand.grab.confidence >= config.grab.minimumConfidence;
    const grabClaimsOwnership =
      grabGate.active ||
      (grabEligible &&
        selectedHand.grab.strength >= config.grab.engageStrength);
    const palmClaimsOwnership =
      palmGate.active ||
      (palmEligible &&
        selectedHand.palm.score >= config.palm.engageScore);
    const owner: LandmarkTraceReplayOwner = grabClaimsOwnership
      ? "grab"
      : palmClaimsOwnership
        ? "palm"
        : "none";

    const suppression = replaySuppression({
      rawHandCount: rawHands.length,
      selectedHand,
      owner,
      config,
    });

    const palmUpdate = palmGate.update({
      score: selectedHand?.palm.score ?? 0,
      point: selectedHand?.anchor ?? null,
      timestampMs: timestamp,
      suppressed: selectedHand === null || owner === "grab",
    });

    let effectiveGrabStrength = 0;
    if (grabEligible && selectedHand) {
      lastGrabEvidenceAt = timestamp;
      effectiveGrabStrength = selectedHand.grab.strength;
    } else if (
      grabGate.active &&
      lastGrabEvidenceAt !== null &&
      timestamp - lastGrabEvidenceAt <= config.grab.trackingLossGraceMs
    ) {
      // This mirrors the production controller's frozen-grab behavior during
      // short uncertain/tracking-loss windows.
      effectiveGrabStrength = config.grab.releaseStrength + 0.01;
    }
    const grabUpdate = grabGate.update(effectiveGrabStrength, timestamp);

    const frameActions: LandmarkTraceReplayAction[] = [];
    for (const event of [palmUpdate.event, grabUpdate.event]) {
      if (!event) {
        continue;
      }
      const action: LandmarkTraceReplayAction = {
        sequence: actions.length,
        frameIndex,
        t: timestamp,
        gesture: event.gesture,
        kind: event.kind,
        type: `${event.gesture}_${event.kind}` as LandmarkTraceReplayActionType,
        frameOwner: owner,
        latencyMs: event.latencyMs,
        signalSinceMs: event.signalSinceMs,
      };
      actions.push(action);
      frameActions.push(action);
    }

    const ownerTransition =
      owner === previousOwner
        ? null
        : { from: previousOwner, to: owner };
    const invalidHands = hands.filter((hand) => !hand.valid);
    const validationCodes =
      rawHands.length === 0
        ? ["no_hands"]
        : invalidHands.flatMap((hand) =>
            hand.issues.map((issue) => `hand_${hand.handIndex}:${issue}`),
          );
    const estimationCodes: string[] = [];
    if (rawHands.length === 0) {
      estimationCodes.push("no_hands");
    } else if (validHands.length === 0) {
      estimationCodes.push("no_valid_hands");
    } else if (invalidHands.length > 0) {
      estimationCodes.push("partial_frame_estimation");
    }
    const ownershipCodes =
      owner === "none" ? ["no_gesture_owner"] : [`owner:${owner}`];
    const temporalCodes = [
      ...(palmUpdate.code ? [`palm:${palmUpdate.code}`] : []),
      ...(grabUpdate.code ? [`grab:${grabUpdate.code}`] : []),
      ...frameActions.map((action) => `action:${action.type}`),
    ];

    frames.push({
      frameIndex,
      t: timestamp,
      sourceT,
      deltaMs,
      handCount: rawHands.length,
      validHandCount: validHands.length,
      selectedHandIndex: selectedHand?.handIndex ?? null,
      hands,
      palmScore,
      grabStrength,
      palmConfidence,
      grabConfidence,
      owner,
      suppression,
      phase: {
        palm: palmUpdate.phase,
        grab: grabUpdate.phase,
      },
      transition: {
        owner: ownerTransition,
        palm: palmUpdate.transition,
        grab: grabUpdate.transition,
      },
      actions: frameActions,
      stages: {
        input: {
          status: inputCodes.length === 0 ? "passed" : "degraded",
          codes: inputCodes,
        },
        validation: {
          status:
            rawHands.length === 0
              ? "skipped"
              : invalidHands.length > 0
                ? "degraded"
                : "passed",
          codes: validationCodes,
        },
        estimation: {
          status:
            rawHands.length === 0 || validHands.length === 0
              ? "skipped"
              : invalidHands.length > 0
                ? "degraded"
                : "passed",
          codes: estimationCodes,
        },
        ownership: {
          status: owner === "none" ? "skipped" : "passed",
          codes: ownershipCodes,
        },
        temporal_gate: {
          status:
            selectedHand === null && (palmGate.active || grabGate.active)
              ? "degraded"
              : "passed",
          codes: temporalCodes,
        },
      },
    });

    previousTimestamp = timestamp;
    previousOwner = owner;
  }

  return {
    schemaVersion: "1.0",
    traceSchemaVersion: trace.schemaVersion,
    config,
    frames,
    actions,
    metrics: buildReplayMetrics(actions, frames.at(-1)?.t ?? 0),
    summary: buildReplaySummary(frames),
  };
}

type ReplayGateEvent = {
  gesture: "palm" | "grab";
  kind: "acquire" | "release";
  latencyMs: number;
  signalSinceMs: number;
};

type ReplayGateUpdate = {
  phase: LandmarkTraceReplayGatePhase;
  transition: LandmarkTraceReplayTransition<LandmarkTraceReplayGatePhase> | null;
  event: ReplayGateEvent | null;
  code: string | null;
};

class PalmReplayGate {
  private readonly config: LandmarkTracePalmReplayConfig;
  private candidateSince: number | null = null;
  private anchor: { x: number; y: number } | null = null;
  private latched = false;
  private releaseSince: number | null = null;
  private lastPoseSeenAt: number | null = null;
  private cooldownUntil = 0;
  private phase: LandmarkTraceReplayGatePhase = "idle";

  constructor(config: LandmarkTracePalmReplayConfig) {
    this.config = config;
  }

  get active(): boolean {
    return this.latched;
  }

  update(input: {
    score: number;
    point: { x: number; y: number } | null;
    timestampMs: number;
    suppressed: boolean;
  }): ReplayGateUpdate {
    const previousPhase = this.phase;
    const { score, point, timestampMs, suppressed } = input;
    let event: ReplayGateEvent | null = null;
    let code: string | null = null;
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
      code = "dropout_grace";
      return this.output(previousPhase, event, code);
    }

    const poseReleased = suppressed || !posePresent;
    if (this.latched) {
      this.candidateSince = null;
      this.anchor = null;
      if (!poseReleased) {
        this.releaseSince = null;
      } else {
        if (this.releaseSince === null) {
          this.releaseSince =
            suppressed || this.lastPoseSeenAt === null
              ? timestampMs
              : this.lastPoseSeenAt + this.config.dropoutGraceMs;
        }
        if (timestampMs - this.releaseSince >= this.config.releaseMs) {
          const signalSinceMs = this.releaseSince;
          this.latched = false;
          this.releaseSince = null;
          this.lastPoseSeenAt = null;
          event = {
            gesture: "palm",
            kind: "release",
            latencyMs: timestampMs - signalSinceMs,
            signalSinceMs,
          };
        }
      }
      return this.output(previousPhase, event, code);
    }

    this.releaseSince = null;
    if (
      suppressed ||
      timestampMs < this.cooldownUntil ||
      poseReleased
    ) {
      this.clearCandidate();
      if (suppressed || poseReleased) {
        this.lastPoseSeenAt = null;
      }
      code =
        timestampMs < this.cooldownUntil
          ? "cooldown"
          : suppressed
            ? "suppressed"
            : "pose_absent";
      return this.output(previousPhase, event, code);
    }

    if (this.candidateSince === null || this.anchor === null) {
      if (score < this.config.engageScore || !point) {
        code = "below_engage";
        return this.output(previousPhase, event, code);
      }
      this.candidateSince = timestampMs;
      this.anchor = point;
      code = "candidate_started";
      return this.output(previousPhase, event, code);
    }

    if (!point) {
      this.clearCandidate();
      code = "candidate_lost";
      return this.output(previousPhase, event, code);
    }

    const drift = Math.hypot(
      point.x - this.anchor.x,
      point.y - this.anchor.y,
    );
    if (drift > this.config.stillnessRadius) {
      this.clearCandidate();
      if (score >= this.config.engageScore) {
        this.candidateSince = timestampMs;
        this.anchor = point;
      }
      code = "candidate_restarted_motion";
      return this.output(previousPhase, event, code);
    }

    if (score < this.config.engageScore) {
      code = "hysteresis_hold";
      return this.output(previousPhase, event, code);
    }
    if (timestampMs - this.candidateSince < this.config.holdMs) {
      code = "acquire_pending";
      return this.output(previousPhase, event, code);
    }

    const signalSinceMs = this.candidateSince;
    this.clearCandidate();
    this.latched = true;
    this.cooldownUntil = timestampMs + this.config.cooldownMs;
    event = {
      gesture: "palm",
      kind: "acquire",
      latencyMs: timestampMs - signalSinceMs,
      signalSinceMs,
    };
    return this.output(previousPhase, event, code);
  }

  private output(
    previousPhase: LandmarkTraceReplayGatePhase,
    event: ReplayGateEvent | null,
    code: string | null,
  ): ReplayGateUpdate {
    this.phase = this.latched
      ? this.releaseSince === null
        ? "active"
        : "releasing"
      : this.candidateSince === null
        ? "idle"
        : "acquiring";
    return {
      phase: this.phase,
      transition:
        previousPhase === this.phase
          ? null
          : { from: previousPhase, to: this.phase },
      event,
      code,
    };
  }

  private clearCandidate(): void {
    this.candidateSince = null;
    this.anchor = null;
  }
}

class GrabReplayGate {
  private readonly config: LandmarkTraceGrabReplayConfig;
  private readonly gate: PinchHysteresis;
  private latched = false;
  private candidateSince: number | null = null;
  private releaseSince: number | null = null;
  private phase: LandmarkTraceReplayGatePhase = "idle";

  constructor(config: LandmarkTraceGrabReplayConfig) {
    this.config = config;
    this.gate = new PinchHysteresis({
      engageThreshold: config.engageStrength,
      releaseThreshold: config.releaseStrength,
      engageDebounceMs: config.engageMs,
      releaseDebounceMs: config.releaseMs,
    });
  }

  get active(): boolean {
    return this.latched;
  }

  update(strength: number, timestampMs: number): ReplayGateUpdate {
    const previousPhase = this.phase;
    const safeStrength = Number.isFinite(strength) ? strength : 0;
    if (!this.latched) {
      if (safeStrength >= this.config.engageStrength) {
        this.candidateSince ??= timestampMs;
      } else {
        this.candidateSince = null;
      }
      this.releaseSince = null;
    } else {
      this.candidateSince = null;
      if (safeStrength <= this.config.releaseStrength) {
        this.releaseSince ??= timestampMs;
      } else {
        this.releaseSince = null;
      }
    }

    const result = this.gate.update(safeStrength, timestampMs);
    let event: ReplayGateEvent | null = null;
    if (result.engaged) {
      const signalSinceMs = this.candidateSince ?? timestampMs;
      this.latched = true;
      this.candidateSince = null;
      event = {
        gesture: "grab",
        kind: "acquire",
        latencyMs: timestampMs - signalSinceMs,
        signalSinceMs,
      };
    } else if (result.released) {
      const signalSinceMs = this.releaseSince ?? timestampMs;
      this.latched = false;
      this.releaseSince = null;
      event = {
        gesture: "grab",
        kind: "release",
        latencyMs: timestampMs - signalSinceMs,
        signalSinceMs,
      };
    }

    this.phase =
      result.phase === "closing"
        ? "acquiring"
        : result.phase === "closed"
          ? "active"
          : result.phase === "opening"
            ? "releasing"
            : "idle";
    return {
      phase: this.phase,
      transition:
        previousPhase === this.phase
          ? null
          : { from: previousPhase, to: this.phase },
      event,
      code: event
        ? event.kind
        : this.phase === "idle" || this.phase === "active"
          ? null
          : `${this.phase}_pending`,
    };
  }
}

function resolveReplayConfig(
  options: LandmarkTraceReplayOptions,
): LandmarkTraceReplayConfig {
  const config: LandmarkTraceReplayConfig = {
    expectedFrameIntervalMs:
      options.expectedFrameIntervalMs ??
      defaultLandmarkTraceReplayConfig.expectedFrameIntervalMs,
    palm: {
      ...defaultLandmarkTraceReplayConfig.palm,
      ...options.palm,
    },
    grab: {
      ...defaultLandmarkTraceReplayConfig.grab,
      ...options.grab,
    },
  };
  if (
    !Number.isFinite(config.expectedFrameIntervalMs) ||
    config.expectedFrameIntervalMs <= 0
  ) {
    throw new Error("expectedFrameIntervalMs must be positive");
  }
  if (
    config.palm.engageScore <= config.palm.releaseScore ||
    config.palm.engageScore > 1 ||
    config.palm.releaseScore < 0
  ) {
    throw new Error("palm thresholds must satisfy 0 <= release < engage <= 1");
  }
  if (
    config.grab.engageStrength <= config.grab.releaseStrength ||
    config.grab.engageStrength > 1 ||
    config.grab.releaseStrength < 0
  ) {
    throw new Error("grab thresholds must satisfy 0 <= release < engage <= 1");
  }
  for (const duration of [
    config.palm.holdMs,
    config.palm.releaseMs,
    config.palm.dropoutGraceMs,
    config.palm.cooldownMs,
    config.grab.engageMs,
    config.grab.releaseMs,
    config.grab.trackingLossGraceMs,
  ]) {
    if (!Number.isFinite(duration) || duration < 0) {
      throw new Error("gesture replay durations must be non-negative");
    }
  }
  return config;
}

function diagnoseReplayHand(
  rawHand: LandmarkTraceFrame["hands"][number],
  handIndex: number,
): LandmarkTraceReplayHandDiagnostic {
  const hand = rawHand as unknown as {
    handedness?: unknown;
    score?: unknown;
    landmarks?: unknown;
  };
  const rawLandmarks = Array.isArray(hand?.landmarks)
    ? hand.landmarks
    : [];
  const landmarks: (HandLandmark | null)[] = [];
  let finiteLandmarkCount = 0;
  for (const rawLandmark of rawLandmarks) {
    if (
      Array.isArray(rawLandmark) &&
      Number.isFinite(rawLandmark[0]) &&
      Number.isFinite(rawLandmark[1]) &&
      (rawLandmark[2] === undefined || Number.isFinite(rawLandmark[2]))
    ) {
      finiteLandmarkCount += 1;
      landmarks.push({
        x: Number(rawLandmark[0]),
        y: Number(rawLandmark[1]),
        z: rawLandmark[2] === undefined ? 0 : Number(rawLandmark[2]),
      });
    } else {
      landmarks.push(null);
    }
  }

  const issues: string[] = [];
  if (typeof hand?.handedness !== "string" || hand.handedness.length === 0) {
    issues.push("invalid_handedness");
  }
  if (!Number.isFinite(hand?.score)) {
    issues.push("invalid_handedness_score");
  }
  if (!Array.isArray(hand?.landmarks)) {
    issues.push("landmarks_not_array");
  } else {
    if (rawLandmarks.length !== 21) {
      issues.push("landmark_count");
    }
    if (finiteLandmarkCount !== rawLandmarks.length) {
      issues.push("non_finite_landmark");
    }
  }

  return {
    handIndex,
    handedness:
      typeof hand?.handedness === "string" ? hand.handedness : "unknown",
    handednessScore: Number.isFinite(hand?.score)
      ? Number(hand.score)
      : null,
    landmarkCount: rawLandmarks.length,
    finiteLandmarkCount,
    valid: issues.length === 0,
    issues,
    palm: estimatePalmPresentation(landmarks),
    grab: estimateGrabStrength(landmarks),
    anchor: palmAnchor(landmarks),
  };
}

function palmAnchor(
  landmarks: readonly (HandLandmark | null | undefined)[],
): { x: number; y: number } | null {
  const points = [5, 9, 13, 17].map((index) => landmarks[index]);
  if (
    points.some(
      (point) =>
        !point ||
        !Number.isFinite(point.x) ||
        !Number.isFinite(point.y),
    )
  ) {
    return null;
  }
  const complete = points as HandLandmark[];
  return {
    x: complete.reduce((sum, point) => sum + point.x, 0) / complete.length,
    y: complete.reduce((sum, point) => sum + point.y, 0) / complete.length,
  };
}

function bestHandBy(
  hands: readonly LandmarkTraceReplayHandDiagnostic[],
  select: (hand: LandmarkTraceReplayHandDiagnostic) => number,
): LandmarkTraceReplayHandDiagnostic | null {
  let best: LandmarkTraceReplayHandDiagnostic | null = null;
  let bestValue = Number.NEGATIVE_INFINITY;
  for (const hand of hands) {
    const value = select(hand);
    if (value > bestValue) {
      best = hand;
      bestValue = value;
    }
  }
  return best;
}

function replaySuppression(input: {
  rawHandCount: number;
  selectedHand: LandmarkTraceReplayHandDiagnostic | null;
  owner: LandmarkTraceReplayOwner;
  config: LandmarkTraceReplayConfig;
}): {
  palm: LandmarkTraceReplaySuppressionReason[];
  grab: LandmarkTraceReplaySuppressionReason[];
} {
  if (input.rawHandCount === 0) {
    return { palm: ["no_hand"], grab: ["no_hand"] };
  }
  if (input.rawHandCount > 1) {
    return {
      palm: ["multiple_hands"],
      grab: ["multiple_hands"],
    };
  }
  if (!input.selectedHand) {
    return { palm: ["invalid_hand"], grab: ["invalid_hand"] };
  }

  const palm: LandmarkTraceReplaySuppressionReason[] = [];
  const grab: LandmarkTraceReplaySuppressionReason[] = [];
  if (
    input.selectedHand.palm.confidence <
    input.config.palm.minimumConfidence
  ) {
    palm.push("low_estimator_confidence");
  } else if (
    input.selectedHand.palm.score < input.config.palm.engageScore
  ) {
    palm.push("below_engage_threshold");
  }
  if (
    input.selectedHand.grab.confidence <
    input.config.grab.minimumConfidence
  ) {
    grab.push("low_estimator_confidence");
  } else if (
    input.selectedHand.grab.strength < input.config.grab.engageStrength
  ) {
    grab.push("below_engage_threshold");
  }
  if (input.owner === "grab") {
    palm.push("owned_by_grab");
  } else if (input.owner === "palm") {
    grab.push("owned_by_palm");
  }
  return { palm, grab };
}

function buildReplayMetrics(
  actions: readonly LandmarkTraceReplayAction[],
  endTimestampMs: number,
): LandmarkTraceReplayMetrics {
  const palm = buildGestureMetrics(actions, "palm", endTimestampMs);
  const grab = buildGestureMetrics(actions, "grab", endTimestampMs);
  return {
    actionCount: actions.length,
    duplicateActionCount:
      palm.duplicateAcquireCount +
      palm.orphanReleaseCount +
      grab.duplicateAcquireCount +
      grab.orphanReleaseCount,
    unpairedActionCount:
      palm.unpairedAcquireCount +
      palm.orphanReleaseCount +
      grab.unpairedAcquireCount +
      grab.orphanReleaseCount,
    palm,
    grab,
  };
}

function buildGestureMetrics(
  actions: readonly LandmarkTraceReplayAction[],
  gesture: "palm" | "grab",
  endTimestampMs: number,
): LandmarkTraceReplayGestureMetrics {
  const gestureActions = actions.filter((action) => action.gesture === gesture);
  let activeSince: number | null = null;
  let duplicateAcquireCount = 0;
  let orphanReleaseCount = 0;
  let activeDurationMs = 0;
  const acquireLatencies: number[] = [];
  const releaseLatencies: number[] = [];

  for (const action of gestureActions) {
    if (action.kind === "acquire") {
      acquireLatencies.push(action.latencyMs);
      if (activeSince !== null) {
        duplicateAcquireCount += 1;
      } else {
        activeSince = action.t;
      }
    } else {
      releaseLatencies.push(action.latencyMs);
      if (activeSince === null) {
        orphanReleaseCount += 1;
      } else {
        activeDurationMs += Math.max(0, action.t - activeSince);
        activeSince = null;
      }
    }
  }
  const unpairedAcquireCount = activeSince === null ? 0 : 1;
  if (activeSince !== null) {
    activeDurationMs += Math.max(0, endTimestampMs - activeSince);
  }

  return {
    acquireCount: gestureActions.filter((action) => action.kind === "acquire")
      .length,
    releaseCount: gestureActions.filter((action) => action.kind === "release")
      .length,
    duplicateAcquireCount,
    orphanReleaseCount,
    unpairedAcquireCount,
    activeDurationMs,
    acquireTiming: summarizeTiming(acquireLatencies),
    releaseTiming: summarizeTiming(releaseLatencies),
  };
}

function summarizeTiming(
  samplesMs: readonly number[],
): LandmarkTraceReplayTimingMetrics {
  if (samplesMs.length === 0) {
    return {
      samplesMs: [],
      minMs: null,
      maxMs: null,
      meanMs: null,
      p50Ms: null,
      p95Ms: null,
    };
  }
  const sorted = [...samplesMs].sort((left, right) => left - right);
  return {
    samplesMs: [...samplesMs],
    minMs: sorted[0] ?? null,
    maxMs: sorted.at(-1) ?? null,
    meanMs:
      samplesMs.reduce((sum, value) => sum + value, 0) / samplesMs.length,
    p50Ms: timingPercentile(sorted, 0.5),
    p95Ms: timingPercentile(sorted, 0.95),
  };
}

function timingPercentile(
  sorted: readonly number[],
  percentile: number,
): number | null {
  if (sorted.length === 0) {
    return null;
  }
  const index = Math.ceil(percentile * sorted.length) - 1;
  return sorted[Math.max(0, Math.min(sorted.length - 1, index))] ?? null;
}

function buildReplaySummary(
  frames: readonly LandmarkTraceReplayFrame[],
): LandmarkTraceReplaySummary {
  const stages: LandmarkTraceReplayStage[] = [
    "input",
    "validation",
    "estimation",
    "ownership",
    "temporal_gate",
  ];
  const stageCounts = Object.fromEntries(
    stages.map((stage) => [
      stage,
      { passed: 0, degraded: 0, skipped: 0 },
    ]),
  ) as LandmarkTraceReplaySummary["stageCounts"];
  for (const frame of frames) {
    for (const stage of stages) {
      stageCounts[stage][frame.stages[stage].status] += 1;
    }
  }
  const firstTimestamp = frames[0]?.t ?? 0;
  const lastTimestamp = frames.at(-1)?.t ?? firstTimestamp;
  return {
    frameCount: frames.length,
    durationMs: Math.max(0, lastTimestamp - firstTimestamp),
    framesWithHands: frames.filter((frame) => frame.handCount > 0).length,
    framesWithInvalidHands: frames.filter((frame) =>
      frame.hands.some((hand) => !hand.valid),
    ).length,
    nonMonotonicTimestampFrames: frames.filter(
      (frame) => frame.stages.input.status === "degraded",
    ).length,
    stageCounts,
  };
}

export type TraceSegment = { fromMs: number; toMs: number };

/**
 * Contiguous time ranges where a per-frame value stays at/above a threshold.
 * Used to assert "the palm pose is detected from ~1s to ~2s and nowhere else".
 */
export function segmentsAbove(
  samples: readonly ReplaySample[],
  select: (sample: ReplaySample) => number,
  threshold: number,
): TraceSegment[] {
  const segments: TraceSegment[] = [];
  let start: number | null = null;
  let last = 0;
  for (const sample of samples) {
    const active = select(sample) >= threshold;
    if (active && start === null) {
      start = sample.t;
    } else if (!active && start !== null) {
      segments.push({ fromMs: start, toMs: last });
      start = null;
    }
    last = sample.t;
  }
  if (start !== null) {
    segments.push({ fromMs: start, toMs: last });
  }
  return segments;
}

export function parseLandmarkTrace(raw: unknown): LandmarkTrace {
  const trace = raw as LandmarkTrace;
  if (
    !trace ||
    trace.schemaVersion !== "1.0" ||
    !Array.isArray(trace.frames) ||
    trace.frames.some(
      (frame) =>
        typeof frame?.t !== "number" ||
        !Array.isArray(frame.hands) ||
        frame.hands.some((hand) => !Array.isArray(hand?.landmarks)),
    )
  ) {
    throw new Error("Not a schemaVersion 1.0 landmark trace");
  }
  return trace;
}
