import { DeepgramFluxProvider } from "./deepgramFlux";
import type { RealtimeTranscriptionProvider, TranscriptionRuntimeConfig } from "./types";

export function createTranscriptionProvider(
  config: TranscriptionRuntimeConfig,
): RealtimeTranscriptionProvider | null {
  if (config.provider === "deepgram" && config.apiKey) {
    return new DeepgramFluxProvider(config);
  }
  return null;
}
