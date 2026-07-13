export type TranscriptionProviderStatus =
  | "connecting"
  | "connected"
  | "stopping"
  | "stopped";

export type TranscriptionSessionOptions = {
  sampleRate: number;
  language?: string;
  model: string;
  keyterms: string[];
};

export type TranscriptionProviderEvent =
  | {
      type: "status";
      status: TranscriptionProviderStatus;
      requestId?: string;
    }
  | {
      type: "partial";
      transcript: string;
      turnIndex?: number;
      confidence?: number;
      providerEvent?: string;
    }
  | {
      type: "final";
      transcript: string;
      turnIndex?: number;
      confidence?: number;
      providerEvent?: string;
    }
  | {
      type: "error";
      code: string;
      message: string;
      fatal: boolean;
    };

export type TranscriptionProviderEventHandler = (event: TranscriptionProviderEvent) => void;

export interface RealtimeTranscriptionSession {
  sendAudio(pcm16Frame: Uint8Array): void;
  stop(): void;
  abort(): void;
}

export interface RealtimeTranscriptionProvider {
  readonly id: string;
  open(
    options: TranscriptionSessionOptions,
    onEvent: TranscriptionProviderEventHandler,
    signal?: AbortSignal,
  ): Promise<RealtimeTranscriptionSession>;
}

export type TranscriptionRuntimeConfig = {
  provider: string;
  defaultModel: string;
  allowedModels: string[];
  defaultKeyterms: string[];
  providerWebSocketUrl: string;
  connectTimeoutMs: number;
  eotThreshold: number;
  eagerEotThreshold?: number;
  eotTimeoutMs: number;
  maxConcurrentStreams: number;
  maxSessionMs: number;
  maxAudioBytesPerSecond: number;
  apiKey?: string;
};

export type TranscriptionStartMessage = {
  type: "transcription.start";
  sampleRate: number;
  language?: string;
  model?: string;
  keyterms?: string[];
};

export type TranscriptionControlMessage =
  | TranscriptionStartMessage
  | { type: "transcription.stop" }
  | { type: "transcription.abort" };

export type TranscriptionServerMessage =
  | {
      type: "transcription.ready";
      provider: string;
      model: string;
      sampleRate: number;
    }
  | {
      type: "transcription.partial" | "transcription.final";
      transcript: string;
      turnIndex?: number;
      confidence?: number;
      providerEvent?: string;
    }
  | {
      type: "transcription.provider";
      provider: string;
      status: TranscriptionProviderStatus;
      requestId?: string;
    }
  | {
      type: "transcription.error";
      code: string;
      message: string;
      fatal?: boolean;
    }
  | {
      type: "transcription.stopped";
      reason: "completed" | "aborted" | "provider_closed";
    };
