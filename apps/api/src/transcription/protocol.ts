import type {
  TranscriptionControlMessage,
  TranscriptionRuntimeConfig,
  TranscriptionSessionOptions,
  TranscriptionStartMessage,
} from "./types";

const SUPPORTED_PCM16_SAMPLE_RATES = new Set([8000, 16000, 24000, 44100, 48000]);
const MAX_KEYTERMS = 100;
const MAX_KEYTERM_LENGTH = 100;
// Conservatively stay below Deepgram's aggregate 500-token keyterm budget
// without coupling the provider-neutral API to a provider tokenizer.
const MAX_KEYTERM_TOTAL_CHARACTERS = 1_000;

export type TranscriptionProtocolError = {
  code: string;
  message: string;
};

export type TranscriptionProtocolResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: TranscriptionProtocolError };

/**
 * Parses the provider-neutral client control protocol. The canonical message
 * names are transcription.*, while the compact aliases keep older clients
 * from breaking during migration to the realtime gateway.
 */
export function parseTranscriptionControlMessage(
  input: string,
): TranscriptionProtocolResult<TranscriptionControlMessage> {
  let decoded: unknown;
  try {
    decoded = JSON.parse(input);
  } catch {
    return protocolError("INVALID_JSON", "Control messages must be valid JSON.");
  }

  if (!isRecord(decoded) || typeof decoded.type !== "string") {
    return protocolError("INVALID_MESSAGE", "A transcription message type is required.");
  }

  if (decoded.type === "transcription.stop" || decoded.type === "stop") {
    return { ok: true, value: { type: "transcription.stop" } };
  }
  if (decoded.type === "transcription.abort" || decoded.type === "abort") {
    return { ok: true, value: { type: "transcription.abort" } };
  }

  if (decoded.type !== "transcription.start" && decoded.type !== "start") {
    return protocolError("UNKNOWN_MESSAGE", `Unsupported message type: ${decoded.type}`);
  }

  const legacyConfig = isRecord(decoded.config) ? decoded.config : {};
  const sampleRate = decoded.sampleRate ?? legacyConfig.sampleRateHz ?? legacyConfig.sampleRate;
  if (
    typeof sampleRate !== "number" ||
    !Number.isInteger(sampleRate) ||
    !SUPPORTED_PCM16_SAMPLE_RATES.has(sampleRate)
  ) {
    return protocolError(
      "INVALID_SAMPLE_RATE",
      "sampleRate must be one of 8000, 16000, 24000, 44100, or 48000 Hz.",
    );
  }

  const language = optionalTrimmedString(decoded.language ?? legacyConfig.language);
  if (language === null) {
    return protocolError("INVALID_LANGUAGE", "language must be a non-empty language tag.");
  }

  const model = optionalTrimmedString(decoded.model ?? legacyConfig.model);
  if (model === null) {
    return protocolError("INVALID_MODEL", "model must be a non-empty string.");
  }

  const keytermsResult = parseKeyterms(decoded.keyterms ?? legacyConfig.keyterms);
  if (!keytermsResult.ok) {
    return keytermsResult;
  }

  const value: TranscriptionStartMessage = {
    type: "transcription.start",
    sampleRate,
    ...(language ? { language } : {}),
    ...(model ? { model } : {}),
    ...(keytermsResult.value ? { keyterms: keytermsResult.value } : {}),
  };
  return { ok: true, value };
}

export function resolveTranscriptionStart(
  message: TranscriptionStartMessage,
  config: TranscriptionRuntimeConfig,
): TranscriptionProtocolResult<TranscriptionSessionOptions> {
  const model = message.model ?? config.defaultModel;
  if (!config.allowedModels.includes(model)) {
    return protocolError(
      "MODEL_NOT_ALLOWED",
      `Model ${model} is not enabled. Choose one returned by /transcription/config.`,
    );
  }

  const mergedKeyterms = uniqueKeyterms([
    ...config.defaultKeyterms,
    ...(message.keyterms ?? []),
  ]).slice(0, MAX_KEYTERMS);
  if (totalKeytermCharacters(mergedKeyterms) > MAX_KEYTERM_TOTAL_CHARACTERS) {
    return protocolError(
      "KEYTERM_BUDGET_EXCEEDED",
      "The combined transcription vocabulary is too large for a realtime session.",
    );
  }
  return {
    ok: true,
    value: {
      sampleRate: message.sampleRate,
      model,
      keyterms: mergedKeyterms,
      ...(message.language ? { language: message.language } : {}),
    },
  };
}

function parseKeyterms(value: unknown): TranscriptionProtocolResult<string[] | undefined> {
  if (value === undefined) {
    return { ok: true, value: undefined };
  }
  if (!Array.isArray(value) || value.length > MAX_KEYTERMS) {
    return protocolError("INVALID_KEYTERMS", `keyterms must contain at most ${MAX_KEYTERMS} strings.`);
  }

  const keyterms: string[] = [];
  for (const entry of value) {
    if (typeof entry !== "string") {
      return protocolError("INVALID_KEYTERMS", "Every keyterm must be a string.");
    }
    const term = entry.trim();
    if (!term || term.length > MAX_KEYTERM_LENGTH || /[\r\n]/.test(term)) {
      return protocolError(
        "INVALID_KEYTERMS",
        `Keyterms must be 1-${MAX_KEYTERM_LENGTH} characters and remain on one line.`,
      );
    }
    keyterms.push(term);
  }
  if (totalKeytermCharacters(keyterms) > MAX_KEYTERM_TOTAL_CHARACTERS) {
    return protocolError(
      "KEYTERM_BUDGET_EXCEEDED",
      "The combined keyterms are too large for a realtime session.",
    );
  }
  return { ok: true, value: uniqueKeyterms(keyterms) };
}

function totalKeytermCharacters(keyterms: string[]): number {
  return keyterms.reduce((total, term) => total + term.length, 0);
}

function uniqueKeyterms(keyterms: string[]): string[] {
  const seen = new Set<string>();
  return keyterms.filter((term) => {
    const normalized = term.toLocaleLowerCase();
    if (seen.has(normalized)) {
      return false;
    }
    seen.add(normalized);
    return true;
  });
}

function optionalTrimmedString(value: unknown): string | undefined | null {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "string" || !value.trim()) {
    return null;
  }
  return value.trim();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function protocolError<T = never>(code: string, message: string): TranscriptionProtocolResult<T> {
  return { ok: false, error: { code, message } };
}
