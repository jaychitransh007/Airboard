import { classifyGesture } from "./classifier";
import { mapLandmarkToCanvas } from "./mapper";
import { PhysicalMarkerTracker } from "./physicalMarker";
import { GestureSmoother } from "./smoothing";
import { GestureStateMachine } from "./stateMachine";
import { VirtualSurfaceFrictionEngine } from "./virtualSurfaceFrictionEngine";
import type {
  CanvasMapping,
  DetectedHand,
  FrictionEngineOutput,
  FrictionPreset,
  GestureClassifierOutput,
  GestureConfig,
  GestureMode,
  GestureResult,
  MarkerInputMode,
  MarkerUserProfile,
  PhysicalMarkerModeConfig,
  SmoothedPoint,
  VirtualSurfaceFrictionConfig,
} from "./types";
import { defaultGestureConfig } from "./types";

export class GesturePipeline {
  private readonly stateMachine = new GestureStateMachine();
  private readonly markerSmoother = new GestureSmoother();
  private readonly dusterSmoother = new GestureSmoother();
  private readonly frictionEngine = new VirtualSurfaceFrictionEngine();
  private readonly physicalMarkerTracker = new PhysicalMarkerTracker();
  private lastDominantGesture: string | null = null;

  process(input: {
    hands: DetectedHand[];
    mapping: CanvasMapping;
    timestampMs: number;
    config?: Partial<GestureConfig>;
    frictionConfig?: Partial<VirtualSurfaceFrictionConfig>;
    frictionPreset?: FrictionPreset;
    markerInputMode?: MarkerInputMode;
    physicalMarkerConfig?: Partial<PhysicalMarkerModeConfig> | undefined;
    markerProfile?: MarkerUserProfile | undefined;
    paused?: boolean;
  }): GestureResult | null {
    const config = { ...defaultGestureConfig, ...input.config };
    const markerInputMode = input.markerInputMode ?? "hand_marker";
    if (markerInputMode !== "physical_marker") {
      this.physicalMarkerTracker.reset();
    }
    this.frictionEngine.setConfig({
      minMarkerConfidence: config.markerGestureConfidenceThreshold,
      minHandednessConfidence: config.minTrackingConfidence,
      activationDurationMs: config.activationDurationMs,
      ...input.frictionConfig,
    });

    const classified = input.hands
      .map((hand) => classifyGesture(hand, config, input.timestampMs))
      .sort((a, b) => priorityScore(b) - priorityScore(a));

    if (input.paused) {
      this.stateMachine.reset();
      this.markerSmoother.reset();
      this.dusterSmoother.reset();
      this.physicalMarkerTracker.reset();
      const frictionOutput = this.frictionEngine.update({
        timestampMs: input.timestampMs,
        paused: true,
      });
      return buildFrictionGestureResult({
        frictionOutput,
        gesture: "unknown",
        confidence: 0,
        frictionPreset: input.frictionPreset,
      });
    }

    const handMarkerCandidate = findMarkerCandidate(classified, config);
    const physicalMarkerCandidate =
      markerInputMode === "physical_marker"
        ? this.findPhysicalMarkerCandidate({
            hands: input.hands,
            config,
            timestampMs: input.timestampMs,
            physicalMarkerConfig: input.physicalMarkerConfig,
            markerProfile: input.markerProfile,
          })
        : undefined;
    const markerCandidate = chooseMarkerCandidate({
      markerInputMode,
      handMarkerCandidate,
      physicalMarkerCandidate,
      fallbackToHandGesture: input.physicalMarkerConfig?.fallbackToHandGesture,
    });
    const markerFrame = markerCandidate
      ? buildMarkerFrame(markerCandidate, input.mapping, input.timestampMs)
      : undefined;
    const dusterCandidate = classified.find(
      (result) =>
        result.gesture === "duster" &&
        result.confidence >= config.dusterGestureConfidenceThreshold,
    );

    if (dusterCandidate) {
      const frictionOutput = this.frictionEngine.update({
        timestampMs: input.timestampMs,
        ...(markerFrame
          ? {
              marker: buildFrictionMarkerInput({
                frame: markerFrame,
                cursorPoint: markerFrame.smoothedPoint,
              }),
            }
          : {}),
        leftDusterActive: true,
      });
      const mappedPoint = mapLandmarkToCanvas(
        dusterCandidate.cursorPoint,
        input.mapping,
        input.timestampMs,
      );
      const state = this.stateMachine.update(
        { ...dusterCandidate, cursorPoint: mappedPoint },
        config,
      );
      const smoothedPoint = this.dusterSmoother.smooth({
        point: mappedPoint,
        confidence: dusterCandidate.confidence,
        config,
        gestureJustChanged: state.justChanged,
      });
      this.markerSmoother.reset();
      this.lastDominantGesture = `${dusterCandidate.hand}:${dusterCandidate.gesture}:${state.mode}`;

      return buildDusterGestureResult({
        result: dusterCandidate,
        cursorPoint: smoothedPoint,
        mode: state.mode,
        frictionOutput,
        frictionPreset: input.frictionPreset,
      });
    }

    this.stateMachine.reset();
    this.dusterSmoother.reset();

    if (!markerFrame) {
      this.markerSmoother.reset();
      this.lastDominantGesture = null;
      const frictionOutput = this.frictionEngine.update({ timestampMs: input.timestampMs });
      return frictionOutput.shouldCommitStroke
        ? buildFrictionGestureResult({
            frictionOutput,
            gesture: "unknown",
            confidence: 0,
            frictionPreset: input.frictionPreset,
          })
        : null;
    }

    const gestureKey = `${markerFrame.result.hand}:${markerFrame.result.gesture}`;
    const gestureJustChanged = gestureKey !== this.lastDominantGesture;
    const smoothedPoint = this.markerSmoother.smooth({
      point: markerFrame.mappedPoint,
      confidence: markerFrame.result.confidence,
      config,
      gestureJustChanged,
    });
    this.lastDominantGesture = gestureKey;
    const frictionOutput = this.frictionEngine.update({
      timestampMs: input.timestampMs,
      marker: buildFrictionMarkerInput({
        frame: markerFrame,
        cursorPoint: smoothedPoint,
      }),
    });

    return buildFrictionGestureResult({
      frictionOutput,
      result: markerFrame.result,
      rawCursorPoint: markerFrame.mappedPoint,
      gesture: markerFrame.result.gesture,
      confidence: markerFrame.result.confidence,
      frictionPreset: input.frictionPreset,
    });
  }

  private findPhysicalMarkerCandidate(input: {
    hands: DetectedHand[];
    config: GestureConfig;
    timestampMs: number;
    physicalMarkerConfig?: Partial<PhysicalMarkerModeConfig> | undefined;
    markerProfile?: MarkerUserProfile | undefined;
  }): GestureClassifierOutput | undefined {
    const candidates = input.hands
      .filter(
        (hand) =>
          hand.handedness !== input.config.dusterHand &&
          (input.config.markerHand === "either" || hand.handedness === input.config.markerHand),
      )
      .flatMap((hand) => {
        const detection = this.physicalMarkerTracker.detect({
          hand,
          timestampMs: input.timestampMs,
          config: input.physicalMarkerConfig,
          profile: input.markerProfile,
        });
        return detection ? [detection] : [];
      })
      .sort((a, b) => b.classifierOutput.confidence - a.classifierOutput.confidence);

    return candidates[0]?.classifierOutput;
  }
}

function chooseMarkerCandidate(input: {
  markerInputMode: MarkerInputMode;
  handMarkerCandidate?: GestureClassifierOutput | undefined;
  physicalMarkerCandidate?: GestureClassifierOutput | undefined;
  fallbackToHandGesture?: boolean | undefined;
}): GestureClassifierOutput | undefined {
  if (input.markerInputMode !== "physical_marker") {
    return markHandGestureCandidate(input.handMarkerCandidate);
  }

  if (
    input.physicalMarkerCandidate &&
    (input.physicalMarkerCandidate.gesture === "marker" ||
      input.physicalMarkerCandidate.confidence >= 0.2)
  ) {
    return input.physicalMarkerCandidate;
  }

  if (input.fallbackToHandGesture !== false && input.handMarkerCandidate) {
    return {
      ...input.handMarkerCandidate,
      inputSource: "hand_gesture",
      trackingSource: "finger_heuristic",
      fallbackToHandGesture: true,
    };
  }

  return input.physicalMarkerCandidate;
}

function markHandGestureCandidate(
  candidate: GestureClassifierOutput | undefined,
): GestureClassifierOutput | undefined {
  if (!candidate) {
    return undefined;
  }

  return {
    ...candidate,
    inputSource: "hand_gesture",
    trackingSource: "finger_heuristic",
  };
}

function findMarkerCandidate(
  classified: readonly GestureClassifierOutput[],
  config: GestureConfig,
): GestureClassifierOutput | undefined {
  return (
    classified.find(
      (result) =>
        result.hand !== config.dusterHand &&
        (config.markerHand === "either" || result.hand === config.markerHand),
    ) ??
    classified.find(
      (result) => config.markerHand === "either" || result.hand === config.markerHand,
    )
  );
}

function buildMarkerFrame(
  result: GestureClassifierOutput,
  mapping: CanvasMapping,
  timestampMs: number,
): {
  result: GestureClassifierOutput;
  mappedPoint: SmoothedPoint;
  smoothedPoint: SmoothedPoint;
  rawTipPoint?: SmoothedPoint;
  gripCenter?: SmoothedPoint;
} {
  const mappedPoint = buildMappedPoint(result.cursorPoint, mapping, timestampMs);
  const frame: {
    result: GestureClassifierOutput;
    mappedPoint: SmoothedPoint;
    smoothedPoint: SmoothedPoint;
    rawTipPoint?: SmoothedPoint;
    gripCenter?: SmoothedPoint;
  } = {
    result,
    mappedPoint,
    smoothedPoint: mappedPoint,
  };
  if (result.rawTipPoint) {
    frame.rawTipPoint = buildMappedPoint(result.rawTipPoint, mapping, timestampMs);
  }
  if (result.gripCenter) {
    frame.gripCenter = buildMappedPoint(result.gripCenter, mapping, timestampMs);
  }
  return frame;
}

function buildMappedPoint(
  point: GestureClassifierOutput["cursorPoint"],
  mapping: CanvasMapping,
  timestampMs: number,
): SmoothedPoint {
  const mappedPoint = mapLandmarkToCanvas(point, mapping, timestampMs) as SmoothedPoint;
  mappedPoint.rawX = mappedPoint.x;
  mappedPoint.rawY = mappedPoint.y;
  mappedPoint.predicted = false;
  return mappedPoint;
}

type PipelineFrictionMarkerInput = {
  detected: true;
  hand: GestureClassifierOutput["hand"];
  handednessConfidence: number;
  gesture: GestureClassifierOutput["gesture"];
  gestureConfidence: number;
  cursorPoint: SmoothedPoint;
  inputSource?: NonNullable<GestureClassifierOutput["inputSource"]>;
  trackingSource?: NonNullable<GestureClassifierOutput["trackingSource"]>;
  gripConfidence?: number;
  tipConfidence?: number;
  contactScore?: number;
  rawTipPoint?: SmoothedPoint;
  gripCenter?: SmoothedPoint;
  shaftVector?: NonNullable<GestureClassifierOutput["shaftVector"]>;
  fallbackToHandGesture?: boolean;
};

function buildFrictionMarkerInput(input: {
  frame: ReturnType<typeof buildMarkerFrame>;
  cursorPoint: SmoothedPoint;
}): PipelineFrictionMarkerInput {
  const marker: PipelineFrictionMarkerInput = {
    detected: true,
    hand: input.frame.result.hand,
    handednessConfidence: input.frame.result.handednessConfidence,
    gesture: input.frame.result.gesture,
    gestureConfidence: input.frame.result.confidence,
    cursorPoint: input.cursorPoint,
  };

  if (input.frame.result.inputSource) {
    marker.inputSource = input.frame.result.inputSource;
  }
  if (input.frame.result.trackingSource) {
    marker.trackingSource = input.frame.result.trackingSource;
  }
  if (input.frame.result.gripConfidence !== undefined) {
    marker.gripConfidence = input.frame.result.gripConfidence;
  }
  if (input.frame.result.tipConfidence !== undefined) {
    marker.tipConfidence = input.frame.result.tipConfidence;
  }
  if (input.frame.result.contactScore !== undefined) {
    marker.contactScore = input.frame.result.contactScore;
  }
  if (input.frame.rawTipPoint) {
    marker.rawTipPoint = input.frame.rawTipPoint;
  }
  if (input.frame.gripCenter) {
    marker.gripCenter = input.frame.gripCenter;
  }
  if (input.frame.result.shaftVector) {
    marker.shaftVector = input.frame.result.shaftVector;
  }
  if (input.frame.result.fallbackToHandGesture !== undefined) {
    marker.fallbackToHandGesture = input.frame.result.fallbackToHandGesture;
  }

  return marker;
}

function buildFrictionGestureResult(input: {
  frictionOutput: FrictionEngineOutput;
  result?: GestureClassifierOutput;
  rawCursorPoint?: SmoothedPoint;
  gesture: GestureResult["gesture"];
  confidence: number;
  frictionPreset?: FrictionPreset | undefined;
}): GestureResult {
  const cursorPoint =
    input.frictionOutput.virtualMarkerPoint ??
    input.frictionOutput.rawHandPoint ??
    input.rawCursorPoint ?? {
      x: 0,
      y: 0,
      t: 0,
    };
  const result: GestureResult = {
    gesture: input.gesture,
    confidence: input.confidence,
    cursorPoint,
    mode: cursorStyleToMode(input.frictionOutput.cursorStyle),
    markerState: input.frictionOutput.markerState,
    cursorStyle: input.frictionOutput.cursorStyle,
    shouldDraw: input.frictionOutput.shouldDraw,
    shouldCommitStroke: input.frictionOutput.shouldCommitStroke,
    diagnostics: input.frictionOutput.diagnostics,
  };

  if (input.result) {
    result.hand = input.result.hand;
  }
  if (input.rawCursorPoint) {
    result.rawCursorPoint = input.rawCursorPoint;
  }
  if (input.frictionOutput.strokePoint) {
    result.strokePoint = input.frictionOutput.strokePoint;
  }
  if (input.frictionOutput.cleanedStrokePoints) {
    result.cleanedStrokePoints = input.frictionOutput.cleanedStrokePoints;
  }
  if (input.frictionOutput.shouldDiscardStroke !== undefined) {
    result.shouldDiscardStroke = input.frictionOutput.shouldDiscardStroke;
  }
  if (input.frictionOutput.cleanupApplied !== undefined) {
    result.cleanupApplied = input.frictionOutput.cleanupApplied;
  }
  if (input.frictionOutput.lineSnapApplied !== undefined) {
    result.lineSnapApplied = input.frictionOutput.lineSnapApplied;
  }
  if (input.frictionPreset) {
    result.frictionPreset = input.frictionPreset;
  }

  return result;
}

function buildDusterGestureResult(input: {
  result: GestureClassifierOutput;
  cursorPoint: SmoothedPoint;
  mode: GestureMode;
  frictionOutput: FrictionEngineOutput;
  frictionPreset?: FrictionPreset | undefined;
}): GestureResult {
  const result: GestureResult = {
    hand: input.result.hand,
    gesture: input.result.gesture,
    confidence: input.result.confidence,
    cursorPoint: input.cursorPoint,
    mode: input.mode,
    shouldDraw: false,
    shouldCommitStroke: input.frictionOutput.shouldCommitStroke,
    diagnostics: input.frictionOutput.diagnostics,
  };

  if (input.frictionOutput.cleanedStrokePoints) {
    result.cleanedStrokePoints = input.frictionOutput.cleanedStrokePoints;
  }
  if (input.frictionOutput.shouldDiscardStroke !== undefined) {
    result.shouldDiscardStroke = input.frictionOutput.shouldDiscardStroke;
  }
  if (input.frictionOutput.cleanupApplied !== undefined) {
    result.cleanupApplied = input.frictionOutput.cleanupApplied;
  }
  if (input.frictionOutput.lineSnapApplied !== undefined) {
    result.lineSnapApplied = input.frictionOutput.lineSnapApplied;
  }
  if (input.frictionPreset) {
    result.frictionPreset = input.frictionPreset;
  }

  return result;
}

function cursorStyleToMode(cursorStyle: FrictionEngineOutput["cursorStyle"]): GestureMode {
  switch (cursorStyle) {
    case "hidden":
      return "idle";
    case "hand_detected":
      return "hand_detected";
    case "hover":
      return "marker_hover";
    case "contact_ready":
      return "contact_ready";
    case "writing":
      return "writing";
    case "repositioning":
      return "repositioning";
    case "paused":
      return "paused";
    case "low_confidence":
      return "low_confidence";
  }
}

function priorityScore(result: { gesture: string; confidence: number }): number {
  if (result.gesture === "duster") {
    return 10 + result.confidence;
  }

  if (result.gesture === "marker") {
    return 5 + result.confidence;
  }

  return result.confidence;
}
