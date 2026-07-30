import type { VoiceTraceSnapshot } from "./types";

/**
 * Aggregates buffered voice-trace turns into the product's headline metrics.
 * Pure over trace snapshots so the math is unit-testable; the route just
 * feeds it the live buffer.
 *
 * Definitions (kept deliberately explicit — these numbers drive decisions):
 *  - A "completed turn" has a `turn_completed` stage; its `outcome` buckets it.
 *  - successRate = clean applied / actionable attempts. An apply followed by
 *    an attributed Undo or correction inside the client window is retained as
 *    an attempt but is no longer counted as a clean success.
 *    Wake-only / clarification / cancelled turns are excluded: they are not
 *    attempts that could have succeeded or failed.
 *  - endToActionMs = occurredAt(action_applied) − occurredAt(stt_final),
 *    same client clock on both stages, so the delta is meaningful even when
 *    client and server clocks disagree.
 *  - semanticMs comes from the `semantic_result.totalLatencyMs` the client
 *    measured around the LLM round-trip.
 *  - channels counts routed commands by provenance (`wake_classification`'s
 *    wakePhrase): push-to-talk / hold-to-edit gestures vs. the wake word.
 *  - followUps counts content-free Undo/retry/correction attribution signals
 *    attached to the originating interaction.
 */

export type VoiceMetrics = {
  turns: number;
  completedTurns: number;
  outcomes: Record<string, number>;
  followUps: Record<string, number>;
  successRate: number | null;
  latency: {
    endToActionMs: LatencySummary;
    semanticMs: LatencySummary;
  };
  channels: Record<string, number>;
  droppedEvents: number;
};

export type LatencySummary = {
  samples: number;
  p50: number | null;
  p95: number | null;
};

const ATTEMPT_OUTCOMES = new Set([
  "applied",
  "applied_then_undone",
  "applied_then_corrected",
  "failed",
  "rejected",
  "stale_context",
]);
const VOICE_ACTIVITY_STAGES = new Set([
  "capture_started",
  "capture_metadata",
  "audio_dropped",
  "stt_connection",
  "stt_finalization",
  "stt_final",
  "routing",
  "wake_classification",
  "parser_outcome",
  "semantic_request",
  "semantic_result",
  "semantic_failure",
  "grounding",
  "clarification",
  "feedback",
  "retry",
  "correction",
  "turn_completed",
]);

export function computeVoiceMetrics(turns: readonly VoiceTraceSnapshot[]): VoiceMetrics {
  // Gesture health stages share the durable interaction-trace transport, but
  // must never inflate voice denominators.
  const voiceTurns = turns.filter((turn) =>
    turn.events.some((event) => VOICE_ACTIVITY_STAGES.has(event.stage)),
  );
  const outcomes: Record<string, number> = {};
  const followUps: Record<string, number> = {};
  const channels: Record<string, number> = {};
  const endToAction: number[] = [];
  const semantic: number[] = [];
  let completedTurns = 0;
  let droppedEvents = 0;

  for (const turn of voiceTurns) {
    droppedEvents += turn.droppedEvents;
    let sttFinalAt: number | null = null;
    let appliedAt: number | null = null;
    let completedOutcome: string | null = null;
    const attributedFollowUps = new Set<string>();

    for (const event of turn.events) {
      const data = (event.data ?? {}) as Record<string, unknown>;
      const attributionKind =
        typeof data.attributionKind === "string" ? data.attributionKind : null;
      if (
        attributionKind === "undo" ||
        attributionKind === "retry" ||
        attributionKind === "correction"
      ) {
        attributedFollowUps.add(attributionKind);
      }
      switch (event.stage) {
        case "stt_final":
          sttFinalAt = parseTime(event.occurredAt) ?? sttFinalAt;
          break;
        case "action_applied":
          appliedAt = parseTime(event.occurredAt) ?? appliedAt;
          break;
        case "turn_completed": {
          completedOutcome =
            typeof data.outcome === "string" ? data.outcome : "unknown";
          break;
        }
        case "wake_classification": {
          if (typeof data.wakePhrase === "string" && data.command !== undefined) {
            const channel =
              data.wakePhrase === "push-to-talk" || data.wakePhrase === "hold-to-edit"
                ? data.wakePhrase
                : "wake-word";
            channels[channel] = (channels[channel] ?? 0) + 1;
          }
          break;
        }
        case "semantic_result": {
          if (typeof data.totalLatencyMs === "number" && Number.isFinite(data.totalLatencyMs)) {
            semantic.push(data.totalLatencyMs);
          }
          break;
        }
        default:
          break;
      }
    }

    for (const kind of attributedFollowUps) {
      followUps[kind] = (followUps[kind] ?? 0) + 1;
    }
    if (completedOutcome !== null) {
      completedTurns += 1;
      const effectiveOutcome =
        completedOutcome === "applied" && attributedFollowUps.has("undo")
          ? "applied_then_undone"
          : completedOutcome === "applied" && attributedFollowUps.has("correction")
            ? "applied_then_corrected"
            : completedOutcome;
      outcomes[effectiveOutcome] = (outcomes[effectiveOutcome] ?? 0) + 1;
    }

    if (sttFinalAt !== null && appliedAt !== null && appliedAt >= sttFinalAt) {
      endToAction.push(appliedAt - sttFinalAt);
    }
  }

  const attempts = Object.entries(outcomes)
    .filter(([outcome]) => ATTEMPT_OUTCOMES.has(outcome))
    .reduce((sum, [, count]) => sum + count, 0);
  const successRate = attempts > 0 ? (outcomes.applied ?? 0) / attempts : null;

  return {
    turns: voiceTurns.length,
    completedTurns,
    outcomes,
    followUps,
    successRate,
    latency: {
      endToActionMs: summarize(endToAction),
      semanticMs: summarize(semantic),
    },
    channels,
    droppedEvents,
  };
}

function summarize(values: readonly number[]): LatencySummary {
  if (values.length === 0) {
    return { samples: 0, p50: null, p95: null };
  }
  return {
    samples: values.length,
    p50: percentile(values, 0.5),
    p95: percentile(values, 0.95),
  };
}

function percentile(values: readonly number[], proportion: number): number {
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.max(0, Math.ceil(sorted.length * proportion) - 1);
  return sorted[index] ?? 0;
}

function parseTime(value: string | undefined): number | null {
  if (!value) {
    return null;
  }
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}
