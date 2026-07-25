import type { TranscriptionRuntimeConfig } from "./transcription/types";
import type { SemanticIntentRuntimeConfig } from "./semanticIntent/types";

const DEEPGRAM_FLUX_MODELS = new Set(["flux-general-en", "flux-general-multi"]);

export type ApiConfig = {
  host: string;
  port: number;
  appUrl: string;
  ownerGraceSeconds: number;
  localEntitlements: boolean;
  allowedOrigins: string[];
  sessionSigningSecret: string;
  /** Optional shared token guarding provider-spending endpoints. */
  apiToken?: string;
  rateLimits: {
    intentPerMinute: number;
    sessionStartPerMinute: number;
    voiceTracePerMinute: number;
  };
  supabaseUrl?: string;
  supabaseServiceRoleKey?: string;
  stripe: {
    enabled: boolean;
    secretKey?: string;
    webhookSecret?: string;
    personalPriceId?: string;
    teamPriceId?: string;
  };
  email: {
    resendApiKey?: string;
    from: string;
  };
  cronSecret?: string;
  transcription: TranscriptionRuntimeConfig;
  semanticIntent: SemanticIntentRuntimeConfig;
};

export function loadConfig(env: NodeJS.ProcessEnv = process.env): ApiConfig {
  const isProduction = env.NODE_ENV === "production";
  const sessionSigningSecret =
    env.AIRBOARD_SESSION_SIGNING_SECRET?.trim() || "airboard-local-development-signing-key";
  if (isProduction && sessionSigningSecret === "airboard-local-development-signing-key") {
    throw new Error("AIRBOARD_SESSION_SIGNING_SECRET is required in production.");
  }
  return {
    host: env.HOST ?? "127.0.0.1",
    port: Number(env.PORT ?? 4000),
    appUrl: env.AIRBOARD_APP_URL?.trim() || "http://localhost:3000",
    ownerGraceSeconds: Number(env.AIRBOARD_OWNER_GRACE_SECONDS ?? 180),
    localEntitlements: !isProduction && env.AIRBOARD_LOCAL_ENTITLEMENTS !== "false",
    sessionSigningSecret,
    allowedOrigins: (env.AIRBOARD_ALLOWED_ORIGINS ?? "http://localhost:3000")
      .split(",")
      .map((origin) => origin.trim())
      .filter(Boolean),
    ...(env.AIRBOARD_API_TOKEN?.trim() ? { apiToken: env.AIRBOARD_API_TOKEN.trim() } : {}),
    rateLimits: {
      intentPerMinute: parseNumber(
        env.AIRBOARD_RATE_LIMIT_INTENT_PER_MINUTE,
        30,
        1,
        10_000,
        "AIRBOARD_RATE_LIMIT_INTENT_PER_MINUTE",
      ),
      sessionStartPerMinute: parseNumber(
        env.AIRBOARD_RATE_LIMIT_SESSION_START_PER_MINUTE,
        10,
        1,
        10_000,
        "AIRBOARD_RATE_LIMIT_SESSION_START_PER_MINUTE",
      ),
      voiceTracePerMinute: parseNumber(
        env.AIRBOARD_RATE_LIMIT_VOICE_TRACE_PER_MINUTE,
        240,
        1,
        100_000,
        "AIRBOARD_RATE_LIMIT_VOICE_TRACE_PER_MINUTE",
      ),
    },
    ...(env.SUPABASE_URL ? { supabaseUrl: env.SUPABASE_URL } : {}),
    ...(env.SUPABASE_SERVICE_ROLE_KEY
      ? { supabaseServiceRoleKey: env.SUPABASE_SERVICE_ROLE_KEY }
      : {}),
    stripe: {
      enabled: env.AIRBOARD_BILLING_ENABLED === "true",
      ...(env.STRIPE_SECRET_KEY?.trim() ? { secretKey: env.STRIPE_SECRET_KEY.trim() } : {}),
      ...(env.STRIPE_WEBHOOK_SECRET?.trim()
        ? { webhookSecret: env.STRIPE_WEBHOOK_SECRET.trim() }
        : {}),
      ...(env.STRIPE_PERSONAL_PRICE_ID?.trim()
        ? { personalPriceId: env.STRIPE_PERSONAL_PRICE_ID.trim() }
        : {}),
      ...(env.STRIPE_TEAM_PRICE_ID?.trim()
        ? { teamPriceId: env.STRIPE_TEAM_PRICE_ID.trim() }
        : {}),
    },
    email: {
      from: env.AIRBOARD_EMAIL_FROM?.trim() || "Airboard <hello@airboard.app>",
      ...(env.RESEND_API_KEY?.trim() ? { resendApiKey: env.RESEND_API_KEY.trim() } : {}),
    },
    ...(env.AIRBOARD_CRON_SECRET?.trim() ? { cronSecret: env.AIRBOARD_CRON_SECRET.trim() } : {}),
    transcription: loadTranscriptionConfig(env),
    semanticIntent: loadSemanticIntentConfig(env),
  };
}

export function loadSemanticIntentConfig(
  env: NodeJS.ProcessEnv = process.env,
): SemanticIntentRuntimeConfig {
  const provider = (env.AIRBOARD_INTENT_PROVIDER ?? "openai").trim().toLowerCase();
  const explicitAllowedModels = splitList(env.AIRBOARD_INTENT_ALLOWED_MODELS);
  const allowedModels = explicitAllowedModels.length
    ? explicitAllowedModels
    : ["gpt-5.6-terra", "gpt-5.6-luna", "gpt-5.4-mini"];
  const defaultModel = (env.AIRBOARD_INTENT_MODEL ?? allowedModels[0])?.trim();
  if (!defaultModel || !allowedModels.includes(defaultModel)) {
    throw new Error("AIRBOARD_INTENT_MODEL must be included in AIRBOARD_INTENT_ALLOWED_MODELS.");
  }
  const endpoint = validateHttpUrl(
    env.OPENAI_RESPONSES_URL?.trim() || "https://api.openai.com/v1/responses",
    "OPENAI_RESPONSES_URL",
  );
  const reasoningEffort = parseChoice(
    env.AIRBOARD_INTENT_REASONING_EFFORT,
    "none",
    ["none", "minimal", "low", "medium"] as const,
    "AIRBOARD_INTENT_REASONING_EFFORT",
  );
  const apiKey = (env.AIRBOARD_INTENT_API_KEY ?? env.OPENAI_API_KEY)?.trim();

  return {
    provider,
    defaultModel,
    allowedModels,
    endpoint,
    reasoningEffort,
    timeoutMs: parseNumber(
      env.AIRBOARD_INTENT_TIMEOUT_MS,
      5_000,
      250,
      15_000,
      "AIRBOARD_INTENT_TIMEOUT_MS",
    ),
    maxConcurrentRequests: parseNumber(
      env.AIRBOARD_INTENT_MAX_CONCURRENT_REQUESTS,
      8,
      1,
      100,
      "AIRBOARD_INTENT_MAX_CONCURRENT_REQUESTS",
    ),
    maxTranscriptCharacters: parseNumber(
      env.AIRBOARD_INTENT_MAX_TRANSCRIPT_CHARACTERS,
      500,
      64,
      2_000,
      "AIRBOARD_INTENT_MAX_TRANSCRIPT_CHARACTERS",
    ),
    ...(apiKey ? { apiKey } : {}),
  };
}

export function loadTranscriptionConfig(
  env: NodeJS.ProcessEnv = process.env,
): TranscriptionRuntimeConfig {
  const provider = (env.AIRBOARD_TRANSCRIPTION_PROVIDER ?? "deepgram").trim().toLowerCase();
  const explicitAllowedModels = splitList(env.AIRBOARD_TRANSCRIPTION_ALLOWED_MODELS);
  const allowedModels = explicitAllowedModels.length
    ? explicitAllowedModels
    : ["flux-general-en", "flux-general-multi"];
  const defaultModel = (env.AIRBOARD_TRANSCRIPTION_MODEL ?? allowedModels[0])?.trim();
  if (!defaultModel || !allowedModels.includes(defaultModel)) {
    throw new Error(
      "AIRBOARD_TRANSCRIPTION_MODEL must be included in AIRBOARD_TRANSCRIPTION_ALLOWED_MODELS.",
    );
  }
  if (
    provider === "deepgram" &&
    allowedModels.some((model) => !DEEPGRAM_FLUX_MODELS.has(model))
  ) {
    throw new Error(
      "The Deepgram Flux adapter only supports flux-general-en and flux-general-multi.",
    );
  }

  const apiKey = env.DEEPGRAM_API_KEY?.trim();
  const eotThreshold = parseNumber(
    env.AIRBOARD_TRANSCRIPTION_EOT_THRESHOLD,
    0.7,
    0.5,
    0.9,
    "AIRBOARD_TRANSCRIPTION_EOT_THRESHOLD",
  );
  const eagerEotThreshold = env.AIRBOARD_TRANSCRIPTION_EAGER_EOT_THRESHOLD
    ? parseNumber(
        env.AIRBOARD_TRANSCRIPTION_EAGER_EOT_THRESHOLD,
        0.4,
        0.3,
        0.9,
        "AIRBOARD_TRANSCRIPTION_EAGER_EOT_THRESHOLD",
      )
    : undefined;
  if (eagerEotThreshold !== undefined && eagerEotThreshold > eotThreshold) {
    throw new Error(
      "AIRBOARD_TRANSCRIPTION_EAGER_EOT_THRESHOLD must be less than or equal to AIRBOARD_TRANSCRIPTION_EOT_THRESHOLD.",
    );
  }
  return {
    provider,
    defaultModel,
    allowedModels,
    defaultKeyterms: splitList(
      env.AIRBOARD_TRANSCRIPTION_KEYTERMS ??
        "Airo,Airboard,Hey Airo,Airo add a circle here,Airo add a user here,Airo connect User to API,Airo confirm,Airo cancel,add a circle here,add a user here,add an API here,add a database here,add a service here,add a queue here,connect User to API,API,database,queue,connector,service,circle,user,payment",
    ).slice(0, 100),
    providerWebSocketUrl:
      env.DEEPGRAM_WEBSOCKET_URL?.trim() || "wss://api.deepgram.com/v2/listen",
    connectTimeoutMs: parseNumber(
      env.AIRBOARD_TRANSCRIPTION_CONNECT_TIMEOUT_MS,
      10_000,
      1_000,
      30_000,
      "AIRBOARD_TRANSCRIPTION_CONNECT_TIMEOUT_MS",
    ),
    eotThreshold,
    eotTimeoutMs: parseNumber(
      env.AIRBOARD_TRANSCRIPTION_EOT_TIMEOUT_MS,
      1_200,
      500,
      10_000,
      "AIRBOARD_TRANSCRIPTION_EOT_TIMEOUT_MS",
    ),
    maxConcurrentStreams: parseNumber(
      env.AIRBOARD_TRANSCRIPTION_MAX_CONCURRENT_STREAMS,
      4,
      1,
      100,
      "AIRBOARD_TRANSCRIPTION_MAX_CONCURRENT_STREAMS",
    ),
    maxSessionMs: parseNumber(
      env.AIRBOARD_TRANSCRIPTION_MAX_SESSION_MS,
      30 * 60 * 1_000,
      10_000,
      4 * 60 * 60 * 1_000,
      "AIRBOARD_TRANSCRIPTION_MAX_SESSION_MS",
    ),
    maxAudioBytesPerSecond: parseNumber(
      env.AIRBOARD_TRANSCRIPTION_MAX_AUDIO_BYTES_PER_SECOND,
      128 * 1_024,
      32 * 1_024,
      1_024 * 1_024,
      "AIRBOARD_TRANSCRIPTION_MAX_AUDIO_BYTES_PER_SECOND",
    ),
    ...(eagerEotThreshold !== undefined ? { eagerEotThreshold } : {}),
    ...(apiKey ? { apiKey } : {}),
  };
}

function splitList(input: string | undefined): string[] {
  return (input ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function parseNumber(
  input: string | undefined,
  fallback: number,
  minimum: number,
  maximum: number,
  name: string,
): number {
  const parsed = input === undefined ? fallback : Number(input);
  if (!Number.isFinite(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(`${name} must be between ${minimum} and ${maximum}.`);
  }
  return parsed;
}

function parseChoice<const T extends readonly string[]>(
  input: string | undefined,
  fallback: T[number],
  allowed: T,
  name: string,
): T[number] {
  const value = (input ?? fallback).trim().toLowerCase();
  if (!(allowed as readonly string[]).includes(value)) {
    throw new Error(`${name} must be one of: ${allowed.join(", ")}.`);
  }
  return value as T[number];
}

function validateHttpUrl(input: string, name: string): string {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new Error(`${name} must be a valid HTTP(S) URL.`);
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error(`${name} must use HTTP or HTTPS.`);
  }
  return url.toString();
}
