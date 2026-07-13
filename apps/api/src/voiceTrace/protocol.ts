import type { VoiceTraceAppend, VoiceTraceData, VoiceTraceValue } from "./types";

const VOICE_TURN_ID_PATTERN = /^[\x21-\x7E]{8,128}$/u;
const STAGE_PATTERN = /^[a-z][a-z0-9._-]{0,79}$/u;
const CONTROL_CHARACTERS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/u;
const FORBIDDEN_DATA_KEY =
  /^(?:raw[_-]?audio|audio(?:[_-]?(?:bytes|blob|buffer|data))?|pcm|blob|bytes|buffer|api[_-]?key|authorization|access[_-]?token|refresh[_-]?token|token|secret|password)$/iu;

const MAX_BODY_CHARACTERS = 8_192;
const MAX_DATA_KEYS = 20;
const MAX_ARRAY_ITEMS = 20;
const MAX_DEPTH = 3;
const MAX_STRING_CHARACTERS = 1_000;

export type VoiceTraceProtocolError = {
  code: string;
  message: string;
};

export type VoiceTraceParseResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: VoiceTraceProtocolError };

export function parseVoiceTraceAppend(input: unknown): VoiceTraceParseResult<VoiceTraceAppend> {
  if (!isRecord(input)) {
    return error("INVALID_VOICE_TRACE", "The voice trace stage must be a JSON object.");
  }
  let serialized: string;
  try {
    serialized = JSON.stringify(input);
  } catch {
    return error("INVALID_VOICE_TRACE", "The voice trace stage must be serializable JSON.");
  }
  if (serialized.length > MAX_BODY_CHARACTERS) {
    return error("VOICE_TRACE_TOO_LARGE", "The voice trace stage exceeds the diagnostic size limit.");
  }

  const voiceTurnId = parseVoiceTurnId(input.voiceTurnId);
  if (!voiceTurnId) {
    return error(
      "INVALID_VOICE_TURN_ID",
      "voiceTurnId must be an 8 to 128 character safe diagnostic identifier.",
    );
  }
  if (typeof input.stage !== "string" || !STAGE_PATTERN.test(input.stage)) {
    return error(
      "INVALID_VOICE_TRACE_STAGE",
      "stage must be a lowercase diagnostic token up to 80 characters.",
    );
  }

  let occurredAt: string | undefined;
  if (input.occurredAt !== undefined) {
    if (
      typeof input.occurredAt !== "string" ||
      input.occurredAt.length > 40 ||
      !Number.isFinite(Date.parse(input.occurredAt))
    ) {
      return error(
        "INVALID_VOICE_TRACE_TIMESTAMP",
        "occurredAt must be a valid ISO date string.",
      );
    }
    occurredAt = new Date(input.occurredAt).toISOString();
  }

  let data: VoiceTraceData | undefined;
  if (input.data !== undefined) {
    const parsedData = parseDataObject(input.data, 0);
    if (!parsedData.ok) {
      return parsedData;
    }
    data = parsedData.value;
  }

  return {
    ok: true,
    value: {
      voiceTurnId,
      stage: input.stage,
      ...(occurredAt ? { occurredAt } : {}),
      ...(data ? { data } : {}),
    },
  };
}

export function parseVoiceTurnId(input: unknown): string | null {
  return typeof input === "string" && VOICE_TURN_ID_PATTERN.test(input) ? input : null;
}

function parseDataObject(input: unknown, depth: number): VoiceTraceParseResult<VoiceTraceData> {
  if (!isRecord(input)) {
    return error("INVALID_VOICE_TRACE_DATA", "data must be a bounded JSON object.");
  }
  const entries = Object.entries(input);
  if (entries.length > MAX_DATA_KEYS) {
    return error("INVALID_VOICE_TRACE_DATA", `data may contain at most ${MAX_DATA_KEYS} keys.`);
  }
  const result: VoiceTraceData = {};
  for (const [key, value] of entries) {
    if (
      !key ||
      key.length > 80 ||
      CONTROL_CHARACTERS.test(key) ||
      FORBIDDEN_DATA_KEY.test(key)
    ) {
      return error(
        "VOICE_TRACE_SENSITIVE_DATA_REJECTED",
        "Voice traces cannot contain raw audio, credentials, tokens, or secret fields.",
      );
    }
    const parsed = parseValue(value, depth + 1);
    if (!parsed.ok) {
      return parsed;
    }
    result[key] = parsed.value;
  }
  return { ok: true, value: result };
}

function parseValue(input: unknown, depth: number): VoiceTraceParseResult<VoiceTraceValue> {
  if (depth > MAX_DEPTH) {
    return error("INVALID_VOICE_TRACE_DATA", "Voice trace data is nested too deeply.");
  }
  if (input === null || typeof input === "boolean") {
    return { ok: true, value: input };
  }
  if (typeof input === "number") {
    return Number.isFinite(input)
      ? { ok: true, value: input }
      : error("INVALID_VOICE_TRACE_DATA", "Voice trace numbers must be finite.");
  }
  if (typeof input === "string") {
    if (input.length > MAX_STRING_CHARACTERS || CONTROL_CHARACTERS.test(input)) {
      return error("INVALID_VOICE_TRACE_DATA", "A voice trace string is invalid or too long.");
    }
    return { ok: true, value: input };
  }
  if (Array.isArray(input)) {
    if (input.length > MAX_ARRAY_ITEMS) {
      return error(
        "INVALID_VOICE_TRACE_DATA",
        `Voice trace arrays may contain at most ${MAX_ARRAY_ITEMS} entries.`,
      );
    }
    const result: VoiceTraceValue[] = [];
    for (const value of input) {
      const parsed = parseValue(value, depth + 1);
      if (!parsed.ok) {
        return parsed;
      }
      result.push(parsed.value);
    }
    return { ok: true, value: result };
  }
  if (isRecord(input)) {
    return parseDataObject(input, depth);
  }
  return error("INVALID_VOICE_TRACE_DATA", "Voice trace data must contain only JSON values.");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function error(code: string, message: string): VoiceTraceParseResult<never> {
  return { ok: false, error: { code, message } };
}
