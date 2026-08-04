import type { TranscriptionRuntimeConfig } from "./types";

export function publicTranscriptionConfig(config: TranscriptionRuntimeConfig) {
  return {
    available: config.provider === "deepgram" && Boolean(config.apiKey),
    provider: config.provider,
    defaultModel: config.defaultModel,
    allowedModels: config.allowedModels,
    dynamicKeyterms: config.provider === "deepgram",
  };
}
