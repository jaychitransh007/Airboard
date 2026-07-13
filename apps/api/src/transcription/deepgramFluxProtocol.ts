import type {
  TranscriptionProviderEvent,
  TranscriptionRuntimeConfig,
  TranscriptionSessionOptions,
} from "./types";

export type DeepgramFluxMessageTranslation = {
  connected: boolean;
  configured: boolean;
  finalDedupeKey?: string;
  events: TranscriptionProviderEvent[];
};

/** Builds the direct Flux V2 URL without exposing credentials in its query string. */
export function buildDeepgramFluxUrl(
  endpoint: string,
  options: TranscriptionSessionOptions,
  config: Pick<
    TranscriptionRuntimeConfig,
    "eotThreshold" | "eagerEotThreshold" | "eotTimeoutMs"
  >,
): string {
  const url = new URL(endpoint);
  if (url.protocol !== "wss:" && url.protocol !== "ws:") {
    throw new Error("Deepgram WebSocket URL must use ws:// or wss://.");
  }
  if (url.pathname === "/" || !url.pathname) {
    url.pathname = "/v2/listen";
  }

  url.searchParams.set("model", options.model);
  url.searchParams.set("encoding", "linear16");
  url.searchParams.set("sample_rate", String(options.sampleRate));
  url.searchParams.set("eot_threshold", String(config.eotThreshold));
  url.searchParams.set("eot_timeout_ms", String(config.eotTimeoutMs));
  if (config.eagerEotThreshold !== undefined) {
    url.searchParams.set("eager_eot_threshold", String(config.eagerEotThreshold));
  }
  for (const keyterm of options.keyterms) {
    url.searchParams.append("keyterm", keyterm);
  }
  if (options.language && options.model === "flux-general-multi") {
    url.searchParams.append("language_hint", options.language);
  }
  return url.toString();
}

export function buildDeepgramFluxConfigureMessage(
  options: TranscriptionSessionOptions,
  config: Pick<
    TranscriptionRuntimeConfig,
    "eotThreshold" | "eagerEotThreshold" | "eotTimeoutMs"
  >,
) {
  return {
    type: "Configure",
    thresholds: {
      eot_threshold: config.eotThreshold,
      eot_timeout_ms: config.eotTimeoutMs,
      ...(config.eagerEotThreshold !== undefined
        ? { eager_eot_threshold: config.eagerEotThreshold }
        : {}),
    },
    keyterms: options.keyterms,
    ...(options.language && options.model === "flux-general-multi"
      ? { language_hints: [options.language] }
      : {}),
  };
}

/** Translates Deepgram's Flux state machine into provider-neutral events. */
export function translateDeepgramFluxMessage(input: string): DeepgramFluxMessageTranslation {
  let message: unknown;
  try {
    message = JSON.parse(input);
  } catch {
    return {
      connected: false,
      configured: false,
      events: [
        {
          type: "error",
          code: "INVALID_PROVIDER_RESPONSE",
          message: "The transcription provider returned malformed JSON.",
          fatal: true,
        },
      ],
    };
  }

  if (!isRecord(message) || typeof message.type !== "string") {
    return { connected: false, configured: false, events: [] };
  }

  if (message.type === "Connected") {
    return {
      connected: true,
      configured: false,
      events: [
        {
          type: "status",
          status: "connected",
          ...(typeof message.request_id === "string" ? { requestId: message.request_id } : {}),
        },
      ],
    };
  }
  if (message.type === "ConfigureSuccess") {
    return { connected: false, configured: true, events: [] };
  }
  if (message.type === "Error") {
    return {
      connected: false,
      configured: false,
      events: [
        {
          type: "error",
          code: stringOr(message.code, "PROVIDER_ERROR"),
          message: stringOr(message.description, "The transcription provider reported an error."),
          fatal: true,
        },
      ],
    };
  }
  if (message.type === "ConfigureFailure") {
    return {
      connected: false,
      configured: false,
      events: [
        {
          type: "error",
          code: stringOr(message.code, "PROVIDER_CONFIGURATION_REJECTED"),
          message: stringOr(
            message.description,
            "The transcription provider rejected a configuration update.",
          ),
          fatal: false,
        },
      ],
    };
  }
  if (message.type !== "TurnInfo") {
    return { connected: false, configured: false, events: [] };
  }

  const transcript = typeof message.transcript === "string" ? message.transcript.trim() : "";
  if (!transcript) {
    return { connected: false, configured: false, events: [] };
  }

  const providerEvent = typeof message.event === "string" ? message.event : undefined;
  const confidence = readConfidence(message);
  const turnIndex =
    typeof message.turn_index === "number" && Number.isFinite(message.turn_index)
      ? message.turn_index
      : undefined;
  const common = {
    transcript,
    ...(turnIndex !== undefined ? { turnIndex } : {}),
    ...(confidence !== undefined ? { confidence } : {}),
    ...(providerEvent ? { providerEvent } : {}),
  };
  return {
    connected: false,
    configured: false,
    ...(providerEvent === "EndOfTurn"
      ? { finalDedupeKey: deepgramFinalDedupeKey(message, transcript) }
      : {}),
    events: [
      providerEvent === "EndOfTurn"
        ? { type: "final", ...common }
        : { type: "partial", ...common },
    ],
  };
}

export function acceptDeepgramFinal(seen: Set<string>, dedupeKey: string): boolean {
  if (seen.has(dedupeKey)) {
    return false;
  }
  seen.add(dedupeKey);
  return true;
}

function deepgramFinalDedupeKey(message: Record<string, unknown>, transcript: string): string {
  if (typeof message.turn_index === "number" || typeof message.turn_index === "string") {
    return `turn:${String(message.turn_index)}`;
  }
  if (typeof message.sequence_id === "number" || typeof message.sequence_id === "string") {
    return `sequence:${String(message.sequence_id)}`;
  }
  return `transcript:${transcript}`;
}

function readConfidence(message: Record<string, unknown>): number | undefined {
  if (
    typeof message.end_of_turn_confidence === "number" &&
    Number.isFinite(message.end_of_turn_confidence)
  ) {
    return message.end_of_turn_confidence;
  }
  if (!Array.isArray(message.words)) {
    return undefined;
  }
  const confidences = message.words
    .filter(isRecord)
    .map((word) => word.confidence)
    .filter(
      (confidence): confidence is number =>
        typeof confidence === "number" && Number.isFinite(confidence),
    );
  if (!confidences.length) {
    return undefined;
  }
  return confidences.reduce((total, confidence) => total + confidence, 0) / confidences.length;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringOr(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}
