export const VOICE_TRACE_STAGES = [
  "capture_metadata",
  "stt_final",
  "wake_classification",
  "parser_outcome",
  "semantic_request",
  "semantic_result",
  "semantic_failure",
  "preview",
  "clarification",
  "action_applied",
  "action_failed",
  "action_undone",
  "turn_completed",
] as const;

export type VoiceTraceStage = (typeof VOICE_TRACE_STAGES)[number];

export type VoiceTraceEvent = {
  voiceTurnId: string;
  stage: VoiceTraceStage;
  occurredAt: string;
  data: Record<string, unknown>;
};

export type PostVoiceTraceOptions = {
  apiBaseUrl: string;
  accessToken?: string;
  voiceTurnId: string;
  stage: VoiceTraceStage;
  data?: Record<string, unknown>;
  occurredAt?: string;
};

const MAX_TRACE_JSON_CHARACTERS = 8_000;
const MAX_TRACE_STRING_CHARACTERS = 1_000;
const MAX_TRACE_ARRAY_ITEMS = 20;
const MAX_TRACE_OBJECT_KEYS = 20;
const MAX_TRACE_DEPTH = 3;
const FORBIDDEN_TRACE_KEYS = /^(?:raw_?audio|audio(?:_?(?:bytes|blob|buffer|data))?|pcm|media_?blob|blob|bytes|buffer|api_?key|authorization|access_?token|refresh_?token|token|secret|password)$/iu;

/**
 * Sends diagnostic metadata for one voice turn. Tracing is deliberately
 * best-effort and never blocks or changes a board action.
 */
export async function postVoiceTrace(
  options: PostVoiceTraceOptions,
  fetchImpl: typeof fetch = fetch,
): Promise<void> {
  const voiceTurnId = options.voiceTurnId.trim();
  if (voiceTurnId.length < 8 || voiceTurnId.length > 128 || !/^[\x21-\x7E]+$/u.test(voiceTurnId)) {
    throw new Error("voiceTurnId must be a bounded non-empty identifier.");
  }
  if (!(VOICE_TRACE_STAGES as readonly string[]).includes(options.stage)) {
    throw new Error("Unsupported voice trace stage.");
  }
  const occurredAt = options.occurredAt ?? new Date().toISOString();
  if (!Number.isFinite(Date.parse(occurredAt))) {
    throw new Error("occurredAt must be an ISO timestamp.");
  }
  const data = sanitizeTraceValue(options.data ?? {}, 0);
  if (!isRecord(data)) {
    throw new Error("Voice trace data must be an object.");
  }
  const payload: VoiceTraceEvent = {
    voiceTurnId,
    stage: options.stage,
    occurredAt,
    data,
  };
  const body = JSON.stringify(payload);
  if (body.length > MAX_TRACE_JSON_CHARACTERS) {
    throw new Error("Voice trace payload is too large.");
  }
  const response = await fetchImpl(new URL("/voice/trace", options.apiBaseUrl), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(options.accessToken ? { Authorization: `Bearer ${options.accessToken}` } : {}),
    },
    body,
    keepalive: true,
  });
  if (!response.ok) {
    throw new Error(`Voice trace request failed (${response.status}).`);
  }
}

export function createVoiceTraceReporter(
  apiBaseUrl: string,
  fetchImpl: typeof fetch = fetch,
  accessToken?: string,
): (voiceTurnId: string, stage: VoiceTraceStage, data?: Record<string, unknown>) => void {
  const pendingByTurn = new Map<string, Promise<void>>();
  return (voiceTurnId, stage, data = {}) => {
    const previous = pendingByTurn.get(voiceTurnId) ?? Promise.resolve();
    const next = previous
      .catch(() => undefined)
      .then(() =>
        postVoiceTrace(
          {
            apiBaseUrl,
            voiceTurnId,
            stage,
            data,
            ...(accessToken ? { accessToken } : {}),
          },
          fetchImpl,
        ),
      )
      .catch(() => {
        // Observability must never make the voice agent fail.
      })
      .finally(() => {
        if (pendingByTurn.get(voiceTurnId) === next) {
          pendingByTurn.delete(voiceTurnId);
        }
      });
    pendingByTurn.set(voiceTurnId, next);
  };
}

function sanitizeTraceValue(value: unknown, depth: number): unknown {
  if (depth > MAX_TRACE_DEPTH) {
    return "[depth-limited]";
  }
  if (value === null || typeof value === "boolean") {
    return value;
  }
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : String(value);
  }
  if (typeof value === "string") {
    return value.slice(0, MAX_TRACE_STRING_CHARACTERS);
  }
  if (depth >= MAX_TRACE_DEPTH && (Array.isArray(value) || isRecord(value))) {
    return "[depth-limited]";
  }
  if (Array.isArray(value)) {
    return value
      .slice(0, MAX_TRACE_ARRAY_ITEMS)
      .map((entry) => sanitizeTraceValue(entry, depth + 1));
  }
  if (isRecord(value)) {
    const entries = Object.entries(value).slice(0, MAX_TRACE_OBJECT_KEYS);
    const result: Record<string, unknown> = {};
    for (const [key, entry] of entries) {
      if (FORBIDDEN_TRACE_KEYS.test(key)) {
        continue;
      }
      result[key.slice(0, 80)] = sanitizeTraceValue(entry, depth + 1);
    }
    return result;
  }
  return String(value).slice(0, MAX_TRACE_STRING_CHARACTERS);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
