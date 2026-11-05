/**
 * Production gesture-frame coordinator.
 *
 * Perception stays provider-specific, but every detected landmark frame enters
 * this pure coordinator before it can affect the board. Evals inject the same
 * stage adapters and clock values as production and observe the same
 * content-free vocabulary.
 */

import {
  arbitrateGestureFrame,
  type GestureFrameArbitrationInput,
  type GestureFrameOwner,
} from "./gestureFrameArbitration.ts";
import type { CanvasMapping } from "@airboard/gesture-engine";

export const GESTURE_TRACE_STAGES = [
  "perception_health",
  "candidate_scores",
  "arbitration_owner",
  "suppression",
  "transition",
  "target",
  "action",
  "cancellation",
] as const;

export type GestureTraceStage = (typeof GESTURE_TRACE_STAGES)[number];

export type GestureTraceEvent = {
  interactionId: string;
  frameAtMs: number;
  stage: GestureTraceStage;
  data: Record<string, unknown>;
};

export type GestureTraceSummary = {
  totalEvents: number;
  retainedEvents: number;
  droppedEvents: number;
  stageCounts: Partial<Record<GestureTraceStage, number>>;
  observedOwners: string[];
  appliedActionCounts: Record<string, number>;
  targetedGestureCounts: Record<string, number>;
  inferenceSampleCount: number;
  inferenceP95Ms: number | null;
};

export type GestureFrameCoordinatorInput = {
  interactionId: string;
  timestampMs: number;
  handsDetected: number;
  inferenceMs?: number;
  frameSource?: RawLandmarkFrameSource;
  stages: GestureFrameArbitrationInput;
  report?: (event: GestureTraceEvent) => void;
};

export type GestureFrameCoordinatorResult = {
  owner: GestureFrameOwner;
  timestampMs: number;
};

export type RawLandmarkFrameSource =
  | "live_hand_landmarker"
  | "eval_landmark_injection";

export type RawLandmarkFrameGeometry = {
  canvasWidth: number;
  canvasHeight: number;
  sourceWidth: number;
  sourceHeight: number;
  sensitivity: number;
  fitMode?: CanvasMapping["fitMode"];
  mirrorInput?: boolean;
};

export type RawLandmarkFrameDisposition =
  | "pipeline_only"
  | "diagram_hidden"
  | "arbitrated";

type RawLandmarkFrameContext<THand, TPipelineResult> = {
  hands: readonly THand[];
  timestampMs: number;
  mapping: CanvasMapping;
  pipelineResult: TPipelineResult;
};

type RawLandmarkGestureContext<
  THand,
  TPipelineResult,
  TGestureContext,
  TManipulationResult,
> = RawLandmarkFrameContext<THand, TPipelineResult> & {
  gestureContext: TGestureContext;
  setManipulationResult: (result: TManipulationResult) => void;
};

export type RawLandmarkFrameApplication<
  TPipelineResult,
  TManipulationResult,
> = {
  disposition: RawLandmarkFrameDisposition;
  owner: GestureFrameOwner | null;
  timestampMs: number;
  pipelineResult: TPipelineResult;
  manipulationResult: TManipulationResult | undefined;
};

export type RawLandmarkFrameCoordinatorInput<
  THand,
  TPipelineResult,
  TGestureContext,
  TManipulationResult,
> = {
  interactionId: string;
  source: RawLandmarkFrameSource;
  timestampMs: number;
  inferenceMs?: number;
  hands: readonly THand[];
  geometry: RawLandmarkFrameGeometry;
  gestureModeEnabled: boolean;
  diagramVisible: boolean;
  processPipeline: (
    context: Omit<
      RawLandmarkFrameContext<THand, TPipelineResult>,
      "pipelineResult"
    >,
  ) => TPipelineResult;
  observeFrame?: (
    context: RawLandmarkFrameContext<THand, TPipelineResult>,
  ) => void;
  prepareGesture: (
    context: RawLandmarkFrameContext<THand, TPipelineResult>,
  ) => TGestureContext;
  processHiddenFrame: (
    context: RawLandmarkFrameContext<THand, TPipelineResult> & {
      gestureContext: TGestureContext;
    },
  ) => void;
  createStages: (
    context: RawLandmarkGestureContext<
      THand,
      TPipelineResult,
      TGestureContext,
      TManipulationResult
    >,
  ) => GestureFrameArbitrationInput;
  applyFrame: (
    result: RawLandmarkFrameApplication<
      TPipelineResult,
      TManipulationResult
    >,
  ) => void;
  report?: (event: GestureTraceEvent) => void;
};

export type RawLandmarkFrameCoordinatorResult<
  TPipelineResult,
  TManipulationResult,
> = RawLandmarkFrameApplication<TPipelineResult, TManipulationResult> & {
  mapping: CanvasMapping;
};

/**
 * One provider-neutral production seam for raw hand-landmark frames.
 *
 * MediaPipe and recorded-video replay supply the live frame source, while the
 * browser eval hook supplies an injected source. Both then execute this exact
 * mapping → pipeline → gesture preparation → arbitration → application order.
 * The callbacks keep React state and concrete gesture-engine classes outside
 * this pure coordinator while still preventing either caller from bypassing a
 * production stage.
 */
export function coordinateRawLandmarkFrame<
  THand,
  TPipelineResult,
  TGestureContext,
  TManipulationResult,
>(
  input: RawLandmarkFrameCoordinatorInput<
    THand,
    TPipelineResult,
    TGestureContext,
    TManipulationResult
  >,
): RawLandmarkFrameCoordinatorResult<
  TPipelineResult,
  TManipulationResult
> {
  const mapping = createRawLandmarkCanvasMapping(input.geometry);
  const baseContext = {
    hands: input.hands,
    timestampMs: input.timestampMs,
    mapping,
  };
  const pipelineResult = input.processPipeline(baseContext);
  const context = { ...baseContext, pipelineResult };

  if (!input.gestureModeEnabled) {
    const result = {
      disposition: "pipeline_only" as const,
      owner: null,
      timestampMs: input.timestampMs,
      pipelineResult,
      manipulationResult: undefined,
    };
    input.applyFrame(result);
    return { ...result, mapping };
  }

  input.observeFrame?.(context);
  const gestureContext = input.prepareGesture(context);

  if (!input.diagramVisible) {
    input.processHiddenFrame({ ...context, gestureContext });
    const result = {
      disposition: "diagram_hidden" as const,
      owner: null,
      timestampMs: input.timestampMs,
      pipelineResult,
      manipulationResult: undefined,
    };
    input.applyFrame(result);
    return { ...result, mapping };
  }

  let manipulationResult: TManipulationResult | undefined;
  const stages = input.createStages({
    ...context,
    gestureContext,
    setManipulationResult: (result) => {
      manipulationResult = result;
    },
  });
  const { owner } = coordinateGestureFrame({
    interactionId: input.interactionId,
    timestampMs: input.timestampMs,
    handsDetected: input.hands.length,
    ...(input.inferenceMs === undefined
      ? {}
      : { inferenceMs: input.inferenceMs }),
    frameSource: input.source,
    stages,
    ...(input.report ? { report: input.report } : {}),
  });
  const result = {
    disposition: "arbitrated" as const,
    owner,
    timestampMs: input.timestampMs,
    pipelineResult,
    manipulationResult,
  };
  input.applyFrame(result);
  return { ...result, mapping };
}

export function createRawLandmarkCanvasMapping(
  geometry: RawLandmarkFrameGeometry,
): CanvasMapping {
  const canvasWidth = finiteDimension(geometry.canvasWidth, 1);
  const canvasHeight = finiteDimension(geometry.canvasHeight, 1);
  return {
    canvasWidth,
    canvasHeight,
    sourceWidth: finiteDimension(geometry.sourceWidth, canvasWidth),
    sourceHeight: finiteDimension(geometry.sourceHeight, canvasHeight),
    fitMode: geometry.fitMode ?? "cover",
    mirrorInput: geometry.mirrorInput ?? true,
    sensitivity: Number.isFinite(geometry.sensitivity)
      ? geometry.sensitivity
      : 1,
  };
}

export function coordinateGestureFrame(
  input: GestureFrameCoordinatorInput,
): GestureFrameCoordinatorResult {
  report(input, "perception_health", {
    status: "ok",
    handsDetected: Math.max(0, Math.trunc(input.handsDetected)),
    ...(input.frameSource ? { frameSource: input.frameSource } : {}),
    ...(Number.isFinite(input.inferenceMs)
      ? { inferenceMs: Math.max(0, input.inferenceMs!) }
      : {}),
  });
  const owner = arbitrateGestureFrame(input.stages);
  report(input, "arbitration_owner", { owner });
  return { owner, timestampMs: input.timestampMs };
}

export function reportGestureInferenceFailure(
  input: Pick<
    GestureFrameCoordinatorInput,
    "interactionId" | "timestampMs" | "report"
  >,
  error: unknown,
): void {
  report(input, "perception_health", {
    status: "error",
    code: "HAND_LANDMARK_INFERENCE_FAILED",
    errorName: error instanceof Error ? error.name : "UnknownError",
  });
  report(input, "cancellation", { reason: "inference_failure" });
}

function report(
  input: Pick<
    GestureFrameCoordinatorInput,
    "interactionId" | "timestampMs" | "report"
  >,
  stage: GestureTraceStage,
  data: Record<string, unknown>,
): void {
  input.report?.({
    interactionId: input.interactionId,
    frameAtMs: input.timestampMs,
    stage,
    data,
  });
}

/**
 * Small bounded journal used by diagnostics/test hooks. It contains no raw
 * video or landmark coordinates and is safe to expose in eval artifacts.
 */
export class GestureTraceJournal {
  private readonly events: GestureTraceEvent[] = [];
  private readonly maxEvents: number;
  private totalEvents = 0;
  private readonly stageCounts = new Map<GestureTraceStage, number>();
  private readonly owners = new Set<string>();
  private readonly appliedActions = new Map<string, number>();
  private readonly targetedGestures = new Map<string, number>();
  private readonly inferenceSamplesMs: number[] = [];

  constructor(maxEvents = 256) {
    this.maxEvents = maxEvents;
  }

  append = (event: GestureTraceEvent): void => {
    this.events.push(structuredClone(event));
    this.totalEvents += 1;
    this.stageCounts.set(
      event.stage,
      (this.stageCounts.get(event.stage) ?? 0) + 1,
    );
    if (
      event.stage === "arbitration_owner" &&
      typeof event.data.owner === "string"
    ) {
      this.owners.add(event.data.owner);
    }
    if (
      event.stage === "action" &&
      event.data.applied === true &&
      typeof event.data.gesture === "string"
    ) {
      this.appliedActions.set(
        event.data.gesture,
        (this.appliedActions.get(event.data.gesture) ?? 0) + 1,
      );
    }
    if (
      event.stage === "target" &&
      typeof event.data.gesture === "string"
    ) {
      this.targetedGestures.set(
        event.data.gesture,
        (this.targetedGestures.get(event.data.gesture) ?? 0) + 1,
      );
    }
    if (
      event.stage === "perception_health" &&
      typeof event.data.inferenceMs === "number" &&
      Number.isFinite(event.data.inferenceMs) &&
      event.data.inferenceMs >= 0
    ) {
      this.inferenceSamplesMs.push(event.data.inferenceMs);
    }
    if (this.events.length > this.maxEvents) {
      this.events.splice(0, this.events.length - this.maxEvents);
    }
  };

  snapshot(): GestureTraceEvent[] {
    return this.events.map((event) => structuredClone(event));
  }

  summary(): GestureTraceSummary {
    return {
      totalEvents: this.totalEvents,
      retainedEvents: this.events.length,
      droppedEvents: this.totalEvents - this.events.length,
      stageCounts: Object.fromEntries(this.stageCounts),
      observedOwners: [...this.owners].sort(),
      appliedActionCounts: Object.fromEntries(
        [...this.appliedActions.entries()].sort(([left], [right]) =>
          left.localeCompare(right),
        ),
      ),
      targetedGestureCounts: Object.fromEntries(
        [...this.targetedGestures.entries()].sort(([left], [right]) =>
          left.localeCompare(right),
        ),
      ),
      inferenceSampleCount: this.inferenceSamplesMs.length,
      inferenceP95Ms: percentile(this.inferenceSamplesMs, 0.95),
    };
  }

  clear(): void {
    this.events.length = 0;
    this.totalEvents = 0;
    this.stageCounts.clear();
    this.owners.clear();
    this.appliedActions.clear();
    this.targetedGestures.clear();
    this.inferenceSamplesMs.length = 0;
  }
}

function percentile(values: readonly number[], proportion: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[
    Math.max(0, Math.ceil(sorted.length * proportion) - 1)
  ] ?? null;
}

function finiteDimension(value: number, fallback: number): number {
  return Number.isFinite(value) && value > 0 ? value : fallback;
}
