import type {
  GestureTraceEvent,
  GestureTraceStage,
} from "./gestureFrameCoordinator.ts";
import type { VoiceTraceStage } from "./voiceTrace.ts";

export const DURABLE_GESTURE_TRACE_STAGE: Readonly<
  Record<GestureTraceStage, VoiceTraceStage>
> = {
  perception_health: "gesture_perception_health",
  candidate_scores: "gesture_candidate_scores",
  arbitration_owner: "gesture_arbitration_owner",
  suppression: "gesture_suppression",
  transition: "gesture_transition",
  target: "gesture_target",
  action: "gesture_action",
  cancellation: "gesture_cancellation",
};

export type GestureTraceReporterOptions = {
  observe: (event: GestureTraceEvent) => void;
  post: (
    interactionId: string,
    stage: VoiceTraceStage,
    data?: Record<string, unknown>,
  ) => void;
  sampleIntervalMs?: number;
};

/**
 * Records every content-free gesture stage locally while durably posting only
 * state changes and bounded health samples. This preserves useful production
 * perception diagnostics without issuing network requests at camera FPS.
 */
export function createGestureTraceReporter(
  options: GestureTraceReporterOptions,
): (event: GestureTraceEvent) => void {
  const lastSignature = new Map<GestureTraceStage, string>();
  const lastPostedAt = new Map<GestureTraceStage, number>();
  const sampleIntervalMs = Math.max(250, options.sampleIntervalMs ?? 5_000);

  return (event) => {
    options.observe(event);
    const signature = stableSignature(event.data);
    const previousSignature = lastSignature.get(event.stage);
    const previousAt = lastPostedAt.get(event.stage) ?? Number.NEGATIVE_INFINITY;
    const alwaysPost =
      event.stage === "action" ||
      event.stage === "transition" ||
      event.stage === "cancellation";
    const stateChanged = signature !== previousSignature;
    const sampleDue = event.frameAtMs - previousAt >= sampleIntervalMs;
    lastSignature.set(event.stage, signature);
    if (!alwaysPost && !stateChanged && !sampleDue) {
      return;
    }
    lastPostedAt.set(event.stage, event.frameAtMs);
    options.post(event.interactionId, DURABLE_GESTURE_TRACE_STAGE[event.stage], {
      frameAtMs: event.frameAtMs,
      ...event.data,
    });
  };
}

function stableSignature(data: Record<string, unknown>): string {
  return JSON.stringify(sortValue(data));
}

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortValue);
  }
  if (typeof value === "object" && value !== null) {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, nested]) => [key, sortValue(nested)]),
    );
  }
  return value;
}
