import type { SemanticIntentRuntimeConfig } from "./types";

export function publicSemanticIntentConfig(config: SemanticIntentRuntimeConfig) {
  return {
    available: config.provider === "openai" && Boolean(config.apiKey),
    provider: config.provider,
    defaultModel: config.defaultModel,
    allowedModels: config.allowedModels,
  };
}

