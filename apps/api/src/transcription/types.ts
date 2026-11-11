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
  updateKeyterms(keyterms: string[]): void;
  /**
   * Holds the provider stream open while no audio is sent (the browser stops
   * sending during silence), so silence is neither streamed nor billed.
   */
  keepAlive?(): void;
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
  /** Per-account share of maxConcurrentStreams. */
  maxStreamsPerProfile: number;
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

export type TranscriptionConfigureMessage = {
  type: "transcription.configure";
  keyterms: string[];
};

export type TranscriptionControlMessage =
  | TranscriptionStartMessage
  | TranscriptionConfigureMessage
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
      type: "transcription.configured";
      keytermCount: number;
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
    }
  | {
      /**
       * The provider stream nears its time limit and a replacement is being
       * opened behind it. Audio keeps flowing and the switch loses nothing;
       * a client may use this moment to pause a long-quiet session instead.
       */
      type: "transcription.renewing";
    }
  | {
      /**
       * Today's voice minutes are running low: sent once as the remainder
       * falls to 15 minutes and once at 5 minutes. "service" means the
       * pilot-wide total, not the person's own allowance, is the nearer limit.
       */
      type: "transcription.allowance_warning";
      remainingMinutes: number;
      scope: "personal" | "service";
      message: string;
    };
