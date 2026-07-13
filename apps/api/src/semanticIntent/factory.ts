import { OpenAiResponsesSemanticIntentProvider } from "./openaiResponses";
import type { SemanticIntentProvider, SemanticIntentRuntimeConfig } from "./types";

export function createSemanticIntentProvider(
  config: SemanticIntentRuntimeConfig,
): SemanticIntentProvider | null {
  if (config.provider === "openai" && config.apiKey) {
    return new OpenAiResponsesSemanticIntentProvider(config);
  }
  return null;
}

