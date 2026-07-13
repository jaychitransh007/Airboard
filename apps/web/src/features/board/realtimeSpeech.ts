export const DEFAULT_REALTIME_TRANSCRIPTION_SAMPLE_RATE = 16_000;
export const DEFAULT_REALTIME_TRANSCRIPTION_PATH = "/transcription/ws";
export const REALTIME_TRANSCRIPTION_FRAME_DURATION_MS = 80;
export const REALTIME_TRANSCRIPTION_FRAME_SAMPLES = 1_280;
// One second of 16 kHz mono PCM16. Anything beyond this is stale for an
// interactive board command and is dropped until the socket drains.
export const DEFAULT_REALTIME_TRANSCRIPTION_MAX_BUFFERED_BYTES = 32 * 1024;

const AUDIO_WORKLET_PROCESSOR_NAME = "airboard-pcm-capture";
const AUDIO_WORKLET_PROCESSOR_SOURCE = `
class AirboardPcmCaptureProcessor extends AudioWorkletProcessor {
  process(inputs) {
    const channel = inputs[0] && inputs[0][0];
    if (channel && channel.length) {
      this.port.postMessage(channel.slice(0));
    }
    return true;
  }
}
registerProcessor("${AUDIO_WORKLET_PROCESSOR_NAME}", AirboardPcmCaptureProcessor);
`;

export type RealtimeTranscriptionConfig = {
  available: boolean;
  provider: string | null;
  defaultModel: string | null;
  allowedModels: string[];
};

export type RealtimeSpeechMetadata = {
  provider: string;
  model: string;
  sampleRate: number;
};

export type RealtimeSpeechTranscriptEvent = {
  transcript: string;
  provider?: string;
  model?: string;
  confidence?: number;
  turnIndex?: number;
  providerEvent?: string;
};

export type RealtimeSpeechProviderEvent = {
  status: string;
  provider?: string;
  model?: string;
  message?: string;
};

export type RealtimeSpeechEndReason = "stopped" | "aborted" | "error" | "closed";

export type RealtimeSpeechCallbacks = {
  onReady?: (metadata: RealtimeSpeechMetadata) => void;
  onListening?: (listening: boolean) => void;
  onInterim?: (transcript: string, event: RealtimeSpeechTranscriptEvent) => void;
  onFinal: (transcript: string, event: RealtimeSpeechTranscriptEvent) => void;
  onProviderStatus?: (event: RealtimeSpeechProviderEvent) => void;
  onError?: (message: string, code?: string) => void;
  onEnd?: (reason: RealtimeSpeechEndReason) => void;
  /**
   * Fired once per sustained congestion episode when audio frames are being
   * dropped to keep latency bounded. Lets the UI warn that a command may be cut
   * off, rather than surfacing a generic "not recognized" failure.
   */
  onAudioDropped?: () => void;
};

export type RealtimeSpeechOptions = {
  /** HTTP(S) API origin, such as http://localhost:4000. */
  apiBaseUrl?: string;
  /** Explicit WebSocket URL. Takes precedence over apiBaseUrl. */
  url?: string;
  language?: string;
  /** Provider model identifier selected for this session. */
  model?: string | undefined;
  /** Domain vocabulary used by providers that support key-term biasing. */
  keyterms?: string[];
  sampleRate?: number;
  audioBufferSize?: number;
  /** Audio frames are dropped above this socket backlog to keep latency bounded. */
  maxBufferedBytes?: number;
  stopTimeoutMs?: number;
};

export type RealtimeSpeechSession = {
  start(): void;
  stop(): void;
  abort(): void;
  isListening(): boolean;
  getMetadata(): RealtimeSpeechMetadata | null;
  readonly requestedModel: string | null;
  readonly url: string;
};

type RealtimeWebSocketEventMap = {
  open: Event;
  message: MessageEvent;
  error: Event;
  close: CloseEvent;
};

export type RealtimeWebSocketLike = {
  binaryType: BinaryType;
  readonly readyState: number;
  readonly bufferedAmount: number;
  addEventListener<K extends keyof RealtimeWebSocketEventMap>(
    type: K,
    listener: (event: RealtimeWebSocketEventMap[K]) => void,
  ): void;
  send(data: string | ArrayBuffer): void;
  close(code?: number, reason?: string): void;
};

type AudioInputBufferLike = {
  getChannelData(channel: number): Float32Array;
};

type AudioProcessEventLike = {
  inputBuffer: AudioInputBufferLike;
};

export type RealtimeAudioProcessorLike = {
  onaudioprocess: ((event: AudioProcessEventLike) => void) | null;
  connect(destination: unknown): unknown;
  disconnect(): void;
};

export type RealtimeAudioWorkletNodeLike = RealtimeAudioSourceLike & {
  port: {
    onmessage: ((event: MessageEvent<Float32Array | ArrayBuffer>) => void) | null;
    close?(): void;
  };
};

export type RealtimeAudioSourceLike = {
  connect(destination: unknown): unknown;
  disconnect(): void;
};

export type RealtimeAudioContextLike = {
  readonly sampleRate: number;
  readonly destination: unknown;
  readonly state?: string;
  createMediaStreamSource(stream: MediaStream): RealtimeAudioSourceLike;
  readonly audioWorklet?: {
    addModule(moduleUrl: string): Promise<void>;
  };
  createScriptProcessor?(
    bufferSize: number,
    numberOfInputChannels: number,
    numberOfOutputChannels: number,
  ): RealtimeAudioProcessorLike;
  resume?(): Promise<void>;
  close(): Promise<void>;
};

export type RealtimeSpeechDependencies = {
  createWebSocket?: (url: string) => RealtimeWebSocketLike;
  getUserMedia?: (constraints: MediaStreamConstraints) => Promise<MediaStream>;
  createAudioContext?: () => RealtimeAudioContextLike;
  createAudioWorkletNode?: (
    context: RealtimeAudioContextLike,
    processorName: string,
  ) => RealtimeAudioWorkletNodeLike;
  createAudioWorkletModuleUrl?: (source: string) => string;
  revokeAudioWorkletModuleUrl?: (url: string) => void;
  setTimeout?: (callback: () => void, delayMs: number) => ReturnType<typeof setTimeout>;
  clearTimeout?: (timer: ReturnType<typeof setTimeout>) => void;
};

type ServerMessage = {
  type?: string;
  transcript?: string;
  provider?: string;
  model?: string;
  sampleRate?: number;
  confidence?: number;
  turnIndex?: number;
  providerEvent?: string;
  status?: string;
  message?: string;
  code?: string;
  fatal?: boolean;
};

const WEB_SOCKET_CONNECTING = 0;
const WEB_SOCKET_OPEN = 1;
const WEB_SOCKET_CLOSING = 2;

// ~8 dropped 80ms frames (~0.6s of audio) marks sustained congestion worth
// warning the user about, rather than an incidental single-frame drop.
const DROPPED_FRAME_WARNING_THRESHOLD = 8;

// Deepgram Flux (and the Airboard transcription gateway) accept at most 100
// keyterms per session and reject the whole Configure message if more are sent.
// The shared Airboard vocabulary exceeds this, so bound it at the protocol edge.
const MAX_REALTIME_KEYTERMS = 100;

export function supportsRealtimeSpeech(): boolean {
  if (typeof window === "undefined") {
    return false;
  }
  return Boolean(
    typeof WebSocket !== "undefined" &&
      "mediaDevices" in navigator &&
      (window.AudioContext || getWebkitAudioContext(window)),
  );
}

export function buildRealtimeTranscriptionWebSocketUrl(
  apiBaseUrl?: string,
  path = DEFAULT_REALTIME_TRANSCRIPTION_PATH,
): string {
  const fallbackOrigin = typeof window === "undefined" ? "http://localhost:4000" : window.location.origin;
  const baseUrl = new URL(apiBaseUrl || fallbackOrigin);
  baseUrl.protocol = baseUrl.protocol === "https:" || baseUrl.protocol === "wss:" ? "wss:" : "ws:";
  baseUrl.pathname = path;
  baseUrl.search = "";
  baseUrl.hash = "";
  // Browsers cannot set headers on WebSocket upgrades; the shared API token
  // (when configured) travels as a query parameter instead.
  const apiToken = process.env.NEXT_PUBLIC_AIRBOARD_API_TOKEN?.trim();
  if (apiToken) {
    baseUrl.searchParams.set("token", apiToken);
  }
  return baseUrl.toString();
}

export async function fetchRealtimeTranscriptionConfig(
  apiBaseUrl: string,
  fetchImpl: typeof fetch = fetch,
): Promise<RealtimeTranscriptionConfig> {
  const url = new URL("/transcription/config", apiBaseUrl).toString();
  const response = await fetchImpl(url, { method: "GET" });
  if (!response.ok) {
    throw new Error(`Realtime transcription config request failed (${response.status}).`);
  }
  const payload = (await response.json()) as Partial<RealtimeTranscriptionConfig>;
  return {
    available: payload.available === true,
    provider: typeof payload.provider === "string" ? payload.provider : null,
    defaultModel: typeof payload.defaultModel === "string" ? payload.defaultModel : null,
    allowedModels: Array.isArray(payload.allowedModels)
      ? payload.allowedModels.filter((model): model is string => typeof model === "string")
      : [],
  };
}

/**
 * Creates a provider-neutral, one-shot streaming transcription session.
 * The API selects the provider and confirms the actual provider/model in the
 * `transcription.ready` event; callers may choose an allowed model per session.
 */
export function createRealtimeSpeechSession(
  callbacks: RealtimeSpeechCallbacks,
  options: RealtimeSpeechOptions = {},
  dependencies: RealtimeSpeechDependencies = {},
): RealtimeSpeechSession | null {
  const createWebSocket = dependencies.createWebSocket ?? defaultCreateWebSocket();
  const getUserMedia = dependencies.getUserMedia ?? defaultGetUserMedia();
  const createAudioContext = dependencies.createAudioContext ?? defaultCreateAudioContext();
  const createAudioWorkletNode =
    dependencies.createAudioWorkletNode ?? defaultCreateAudioWorkletNode();
  const createAudioWorkletModuleUrl =
    dependencies.createAudioWorkletModuleUrl ?? defaultCreateAudioWorkletModuleUrl();
  const revokeAudioWorkletModuleUrl =
    dependencies.revokeAudioWorkletModuleUrl ?? defaultRevokeAudioWorkletModuleUrl();
  if (!createWebSocket || !getUserMedia || !createAudioContext) {
    return null;
  }

  const url = options.url ?? buildRealtimeTranscriptionWebSocketUrl(options.apiBaseUrl);
  const requestedModel = cleanOptionalString(options.model);
  const targetSampleRate = positiveInteger(
    options.sampleRate,
    DEFAULT_REALTIME_TRANSCRIPTION_SAMPLE_RATE,
  );
  const audioBufferSize = validAudioBufferSize(options.audioBufferSize);
  const maxBufferedBytes = positiveInteger(
    options.maxBufferedBytes,
    DEFAULT_REALTIME_TRANSCRIPTION_MAX_BUFFERED_BYTES,
  );
  const stopTimeoutMs = Math.max(100, options.stopTimeoutMs ?? 1_500);
  const setTimer = dependencies.setTimeout ?? setTimeout;
  const clearTimer = dependencies.clearTimeout ?? clearTimeout;

  let socket: RealtimeWebSocketLike | null = null;
  let stream: MediaStream | null = null;
  let audioContext: RealtimeAudioContextLike | null = null;
  let source: RealtimeAudioSourceLike | null = null;
  let processor: RealtimeAudioProcessorLike | null = null;
  let workletNode: RealtimeAudioWorkletNodeLike | null = null;
  let metadata: RealtimeSpeechMetadata | null = null;
  let listening = false;
  let state: "idle" | "starting" | "active" | "stopping" | "ended" = "idle";
  let stopTimer: ReturnType<typeof setTimeout> | null = null;
  let endReported = false;
  let pendingInput = new Float32Array(0);
  let inputSampleRate = targetSampleRate;
  let audioCaptureStarting = false;
  let consecutiveDroppedFrames = 0;
  let dropWarningActive = false;

  const setListening = (nextListening: boolean) => {
    if (listening === nextListening) {
      return;
    }
    listening = nextListening;
    callbacks.onListening?.(nextListening);
  };

  const clearStopTimer = () => {
    if (stopTimer !== null) {
      clearTimer(stopTimer);
      stopTimer = null;
    }
  };

  const releaseAudio = () => {
    setListening(false);
    if (processor) {
      processor.onaudioprocess = null;
      try {
        processor.disconnect();
      } catch {
        // Already disconnected.
      }
      processor = null;
    }
    if (workletNode) {
      workletNode.port.onmessage = null;
      workletNode.port.close?.();
      try {
        workletNode.disconnect();
      } catch {
        // Already disconnected.
      }
      workletNode = null;
    }
    if (source) {
      try {
        source.disconnect();
      } catch {
        // Already disconnected.
      }
      source = null;
    }
    if (stream) {
      for (const track of stream.getTracks()) {
        track.stop();
      }
      stream = null;
    }
    if (audioContext) {
      void audioContext.close().catch(() => undefined);
      audioContext = null;
    }
    pendingInput = new Float32Array(0);
  };

  const reportEnd = (reason: RealtimeSpeechEndReason) => {
    if (endReported) {
      return;
    }
    endReported = true;
    state = "ended";
    clearStopTimer();
    releaseAudio();
    callbacks.onEnd?.(reason);
  };

  const closeSocket = (reason: string) => {
    if (socket && socket.readyState < WEB_SOCKET_CLOSING) {
      socket.close(1000, reason);
    }
  };

  const fail = (message: string, code?: string) => {
    if (state === "ended") {
      return;
    }
    callbacks.onError?.(message, code);
    releaseAudio();
    reportEnd("error");
    closeSocket("transcription error");
  };

  const sendStart = () => {
    if (!socket || socket.readyState !== WEB_SOCKET_OPEN) {
      return;
    }
    socket.send(
      JSON.stringify({
        type: "transcription.start",
        sampleRate: targetSampleRate,
        ...(cleanOptionalString(options.language) ? { language: options.language!.trim() } : {}),
        ...(requestedModel ? { model: requestedModel } : {}),
        ...(options.keyterms?.length
          ? { keyterms: boundedKeyterms(options.keyterms) }
          : {}),
      }),
    );
  };

  const sendPcmFrame = (inputFrame: Float32Array) => {
    if (!socket || socket.readyState !== WEB_SOCKET_OPEN) {
      return;
    }
    // When a provider or network falls behind, stale audio is worse than a
    // dropped frame for interactive commands. Keep the latency queue bounded.
    if (socket.bufferedAmount >= maxBufferedBytes) {
      consecutiveDroppedFrames += 1;
      // Warn once per congestion episode after ~0.6s of sustained dropping.
      if (consecutiveDroppedFrames >= DROPPED_FRAME_WARNING_THRESHOLD && !dropWarningActive) {
        dropWarningActive = true;
        callbacks.onAudioDropped?.();
      }
      return;
    }
    consecutiveDroppedFrames = 0;
    dropWarningActive = false;
    const pcmFrame = encodePcm16Frame(inputFrame, inputSampleRate, targetSampleRate);
    if (pcmFrame.byteLength > 0) {
      socket.send(pcmFrame);
    }
  };

  const ingestAudio = (input: Float32Array) => {
    if (!listening || input.length === 0) {
      return;
    }
    const combined = new Float32Array(pendingInput.length + input.length);
    combined.set(pendingInput);
    combined.set(input, pendingInput.length);
    pendingInput = combined;

    const inputFrameSamples = Math.max(
      1,
      Math.round((inputSampleRate * REALTIME_TRANSCRIPTION_FRAME_DURATION_MS) / 1_000),
    );
    while (pendingInput.length >= inputFrameSamples) {
      const frame = pendingInput.slice(0, inputFrameSamples);
      pendingInput = pendingInput.slice(inputFrameSamples);
      sendPcmFrame(frame);
    }
  };

  const flushPendingAudio = () => {
    if (pendingInput.length === 0) {
      return;
    }
    const inputFrameSamples = Math.max(
      1,
      Math.round((inputSampleRate * REALTIME_TRANSCRIPTION_FRAME_DURATION_MS) / 1_000),
    );
    const paddedFrame = new Float32Array(inputFrameSamples);
    paddedFrame.set(pendingInput.slice(0, inputFrameSamples));
    pendingInput = new Float32Array(0);
    sendPcmFrame(paddedFrame);
  };

  const connectAudioCapture = async () => {
    if (state !== "starting" || audioCaptureStarting) {
      return;
    }
    audioCaptureStarting = true;
    try {
      if (!audioContext || !stream) {
        fail("Microphone capture was not prepared before transcription started.", "MICROPHONE_UNAVAILABLE");
        return;
      }

      inputSampleRate = audioContext.sampleRate;
      source = audioContext.createMediaStreamSource(stream);
      let captureConnected = false;

      if (
        audioContext.audioWorklet &&
        createAudioWorkletNode &&
        createAudioWorkletModuleUrl &&
        revokeAudioWorkletModuleUrl
      ) {
        let moduleUrl: string | null = null;
        try {
          moduleUrl = createAudioWorkletModuleUrl(AUDIO_WORKLET_PROCESSOR_SOURCE);
          await audioContext.audioWorklet.addModule(moduleUrl);
          if (state !== "starting" || !audioContext || !source) {
            releaseAudio();
            return;
          }
          workletNode = createAudioWorkletNode(audioContext, AUDIO_WORKLET_PROCESSOR_NAME);
          workletNode.port.onmessage = (event) => {
            const input =
              event.data instanceof Float32Array
                ? event.data
                : event.data instanceof ArrayBuffer
                  ? new Float32Array(event.data)
                  : null;
            if (input) {
              ingestAudio(input);
            }
          };
          source.connect(workletNode);
          workletNode.connect(audioContext.destination);
          captureConnected = true;
        } catch {
          if (workletNode) {
            workletNode.port.onmessage = null;
            workletNode.port.close?.();
            try {
              workletNode.disconnect();
            } catch {
              // Ignore cleanup errors before the fallback is connected.
            }
            workletNode = null;
          }
          try {
            source?.disconnect();
          } catch {
            // The source may not have connected yet.
          }
          // AudioWorklet can be blocked by browser/CSP policy. A deprecated
          // ScriptProcessor fallback keeps transcription usable in that case.
        } finally {
          if (moduleUrl) {
            revokeAudioWorkletModuleUrl(moduleUrl);
          }
        }
      }

      if (!captureConnected) {
        if (!audioContext.createScriptProcessor) {
          throw new Error("This browser does not expose an audio capture processor.");
        }
        processor = audioContext.createScriptProcessor(audioBufferSize, 1, 1);
        processor.onaudioprocess = (event) => {
          ingestAudio(event.inputBuffer.getChannelData(0));
        };
        source.connect(processor);
        processor.connect(audioContext.destination);
      }
      state = "active";
      setListening(true);
    } catch (error) {
      fail(describeRealtimeSpeechError(error), "MICROPHONE_UNAVAILABLE");
    }
  };

  const handleServerMessage = (event: MessageEvent) => {
    const message = parseServerMessage(event.data);
    if (!message) {
      return;
    }
    switch (message.type) {
      case "transcription.ready": {
        if (
          typeof message.provider !== "string" ||
          typeof message.model !== "string" ||
          typeof message.sampleRate !== "number"
        ) {
          fail("The transcription service returned incomplete model metadata.", "INVALID_READY");
          return;
        }
        metadata = {
          provider: message.provider,
          model: message.model,
          sampleRate: message.sampleRate,
        };
        callbacks.onReady?.(metadata);
        void connectAudioCapture();
        return;
      }
      case "transcription.partial": {
        const transcript = cleanOptionalString(message.transcript);
        if (!transcript) {
          return;
        }
        const transcriptEvent = toTranscriptEvent(message, transcript);
        callbacks.onInterim?.(transcript, transcriptEvent);
        return;
      }
      case "transcription.final": {
        const transcript = cleanOptionalString(message.transcript);
        if (!transcript) {
          return;
        }
        const transcriptEvent = toTranscriptEvent(message, transcript);
        callbacks.onFinal(transcript, transcriptEvent);
        return;
      }
      case "transcription.provider":
        callbacks.onProviderStatus?.({
          status: cleanOptionalString(message.status) ?? "unknown",
          ...(cleanOptionalString(message.provider) ? { provider: message.provider!.trim() } : {}),
          ...(cleanOptionalString(message.model) ? { model: message.model!.trim() } : {}),
          ...(cleanOptionalString(message.message) ? { message: message.message!.trim() } : {}),
        });
        return;
      case "transcription.error": {
        const errorMessage =
          cleanOptionalString(message.message) ?? "Realtime transcription failed.";
        const errorCode = cleanOptionalString(message.code) ?? undefined;
        if (message.fatal === false) {
          callbacks.onError?.(errorMessage, errorCode);
          return;
        }
        fail(errorMessage, errorCode);
        return;
      }
      case "transcription.stopped":
        releaseAudio();
        reportEnd("stopped");
        closeSocket("transcription stopped");
        return;
      default:
        return;
    }
  };

  const openSocket = () => {
    if (state !== "starting") {
      return;
    }
    try {
      socket = createWebSocket(url);
      socket.binaryType = "arraybuffer";
      socket.addEventListener("open", sendStart);
      socket.addEventListener("message", handleServerMessage);
      socket.addEventListener("error", () => {
        fail("Could not connect to the realtime transcription service.", "WEBSOCKET_ERROR");
      });
      socket.addEventListener("close", () => {
        if (state === "ended") {
          return;
        }
        const reason: RealtimeSpeechEndReason = state === "stopping" ? "stopped" : "closed";
        reportEnd(reason);
      });
    } catch (error) {
      fail(describeRealtimeSpeechError(error), "WEBSOCKET_UNAVAILABLE");
    }
  };

  const prepareSession = async () => {
    try {
      // Construct/resume the context synchronously from the caller's click so
      // browsers preserve user activation. Do not start a paid provider stream
      // until microphone permission succeeds.
      audioContext = createAudioContext();
      const resumePromise =
        audioContext.state === "suspended" ? audioContext.resume?.() : undefined;
      const nextStream = await getUserMedia({
        audio: {
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
        video: false,
      });
      await resumePromise;
      if (state !== "starting") {
        for (const track of nextStream.getTracks()) {
          track.stop();
        }
        releaseAudio();
        return;
      }
      stream = nextStream;
      openSocket();
    } catch (error) {
      fail(describeRealtimeSpeechError(error), "MICROPHONE_UNAVAILABLE");
    }
  };

  return {
    start() {
      if (state !== "idle") {
        return;
      }
      state = "starting";
      void prepareSession();
    },
    stop() {
      if (state === "idle") {
        reportEnd("stopped");
        return;
      }
      if (state === "ended" || state === "stopping") {
        return;
      }
      state = "stopping";
      flushPendingAudio();
      releaseAudio();
      if (socket?.readyState === WEB_SOCKET_OPEN) {
        socket.send(JSON.stringify({ type: "transcription.stop" }));
        stopTimer = setTimer(() => {
          reportEnd("stopped");
          closeSocket("transcription stop timeout");
        }, stopTimeoutMs);
      } else {
        reportEnd("stopped");
        closeSocket("transcription stopped");
      }
    },
    abort() {
      if (state === "ended") {
        return;
      }
      releaseAudio();
      if (socket?.readyState === WEB_SOCKET_OPEN) {
        socket.send(JSON.stringify({ type: "transcription.abort" }));
      }
      reportEnd("aborted");
      closeSocket("transcription aborted");
    },
    isListening: () => listening,
    getMetadata: () => metadata,
    requestedModel,
    url,
  };
}

/** Resamples mono Float32 audio and encodes signed little-endian PCM16. */
export function encodePcm16Frame(
  input: Float32Array,
  inputSampleRate: number,
  outputSampleRate = DEFAULT_REALTIME_TRANSCRIPTION_SAMPLE_RATE,
): ArrayBuffer {
  if (input.length === 0 || inputSampleRate <= 0 || outputSampleRate <= 0) {
    return new ArrayBuffer(0);
  }
  const outputLength = Math.max(1, Math.round((input.length * outputSampleRate) / inputSampleRate));
  const output = new ArrayBuffer(outputLength * Int16Array.BYTES_PER_ELEMENT);
  const view = new DataView(output);

  for (let outputIndex = 0; outputIndex < outputLength; outputIndex += 1) {
    const inputPosition = (outputIndex * inputSampleRate) / outputSampleRate;
    const leftIndex = Math.min(Math.floor(inputPosition), input.length - 1);
    const rightIndex = Math.min(leftIndex + 1, input.length - 1);
    const fraction = inputPosition - leftIndex;
    const sample = input[leftIndex]! * (1 - fraction) + input[rightIndex]! * fraction;
    const clamped = Math.max(-1, Math.min(1, sample));
    const pcm = clamped < 0 ? Math.round(clamped * 0x8000) : Math.round(clamped * 0x7fff);
    view.setInt16(outputIndex * Int16Array.BYTES_PER_ELEMENT, pcm, true);
  }
  return output;
}

function defaultCreateWebSocket(): ((url: string) => RealtimeWebSocketLike) | null {
  if (typeof WebSocket === "undefined") {
    return null;
  }
  return (url) => new WebSocket(url) as unknown as RealtimeWebSocketLike;
}

function defaultGetUserMedia(): RealtimeSpeechDependencies["getUserMedia"] | null {
  if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
    return null;
  }
  return (constraints) => navigator.mediaDevices.getUserMedia(constraints);
}

function defaultCreateAudioContext(): RealtimeSpeechDependencies["createAudioContext"] | null {
  if (typeof window === "undefined") {
    return null;
  }
  const Context = window.AudioContext ?? getWebkitAudioContext(window);
  if (!Context) {
    return null;
  }
  return () => new Context() as unknown as RealtimeAudioContextLike;
}

function defaultCreateAudioWorkletNode(): RealtimeSpeechDependencies["createAudioWorkletNode"] | null {
  if (typeof AudioWorkletNode === "undefined") {
    return null;
  }
  return (context, processorName) =>
    new AudioWorkletNode(context as unknown as BaseAudioContext, processorName, {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      outputChannelCount: [1],
    }) as unknown as RealtimeAudioWorkletNodeLike;
}

function defaultCreateAudioWorkletModuleUrl(): RealtimeSpeechDependencies["createAudioWorkletModuleUrl"] | null {
  if (typeof Blob === "undefined" || typeof URL === "undefined" || !URL.createObjectURL) {
    return null;
  }
  return (source) => URL.createObjectURL(new Blob([source], { type: "text/javascript" }));
}

function defaultRevokeAudioWorkletModuleUrl(): RealtimeSpeechDependencies["revokeAudioWorkletModuleUrl"] | null {
  if (typeof URL === "undefined" || !URL.revokeObjectURL) {
    return null;
  }
  return (url) => URL.revokeObjectURL(url);
}

function getWebkitAudioContext(
  target: Window,
): (new () => AudioContext) | undefined {
  return (target as Window & { webkitAudioContext?: new () => AudioContext }).webkitAudioContext;
}

function toTranscriptEvent(
  message: ServerMessage,
  transcript: string,
): RealtimeSpeechTranscriptEvent {
  return {
    transcript,
    ...(cleanOptionalString(message.provider) ? { provider: message.provider!.trim() } : {}),
    ...(cleanOptionalString(message.model) ? { model: message.model!.trim() } : {}),
    ...(typeof message.confidence === "number" ? { confidence: message.confidence } : {}),
    ...(typeof message.turnIndex === "number" ? { turnIndex: message.turnIndex } : {}),
    ...(cleanOptionalString(message.providerEvent)
      ? { providerEvent: message.providerEvent!.trim() }
      : {}),
  };
}

function parseServerMessage(data: unknown): ServerMessage | null {
  if (typeof data !== "string") {
    return null;
  }
  try {
    const value = JSON.parse(data) as unknown;
    return value && typeof value === "object" ? (value as ServerMessage) : null;
  } catch {
    return null;
  }
}

function positiveInteger(value: number | undefined, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? Math.round(value)
    : fallback;
}

function validAudioBufferSize(value: number | undefined): number {
  const allowed = new Set([256, 512, 1024, 2048, 4096, 8192, 16_384]);
  return typeof value === "number" && allowed.has(value) ? value : 2048;
}

function cleanOptionalString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

// Trim, drop empties, de-duplicate, and cap to the provider's keyterm limit.
// Earlier terms (wake word and high-value command phrases) are kept first.
export function boundedKeyterms(keyterms: readonly string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const raw of keyterms) {
    const term = raw.trim();
    if (!term || seen.has(term)) {
      continue;
    }
    seen.add(term);
    result.push(term);
    if (result.length >= MAX_REALTIME_KEYTERMS) {
      break;
    }
  }
  return result;
}

function describeRealtimeSpeechError(error: unknown): string {
  if (
    typeof DOMException !== "undefined" &&
    error instanceof DOMException &&
    error.name === "NotAllowedError"
  ) {
    return "Microphone permission was denied. Allow microphone access and try again.";
  }
  if (error instanceof Error && error.message) {
    return error.message;
  }
  return "Realtime transcription could not start.";
}
