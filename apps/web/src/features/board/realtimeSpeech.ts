import { blockedMediaHelp } from "./mediaPermissionHelp.ts";

export const DEFAULT_REALTIME_TRANSCRIPTION_SAMPLE_RATE = 16_000;
export const DEFAULT_REALTIME_TRANSCRIPTION_PATH = "/transcription/ws";
export const REALTIME_TRANSCRIPTION_FRAME_DURATION_MS = 80;
export const REALTIME_TRANSCRIPTION_FRAME_SAMPLES = 1_280;
// One second of 16 kHz mono PCM16. Anything beyond this is stale for an
// interactive board command and is dropped until the socket drains.
export const DEFAULT_REALTIME_TRANSCRIPTION_MAX_BUFFERED_BYTES = 32 * 1024;
// The speech gate (createSpeechGate): frames quieter than this RMS level
// (about -48 dBFS, below speech even after the browser's noise suppression
// and gain control) are silence and are not streamed, since the provider
// bills streamed audio and the API charges voice minutes for it.
export const DEFAULT_SPEECH_GATE_THRESHOLD = 0.004;
// Audio keeps flowing this long after the last loud frame. It must outlast
// the provider's end-of-turn timeout (1.2 s by default) so every turn is
// finished before the stream goes quiet.
export const DEFAULT_SPEECH_GATE_HANGOVER_MS = 2_000;
// The quiet audio just before speech is sent with it, so the first syllable
// ("Ai-ro") is never clipped.
export const DEFAULT_SPEECH_GATE_PRE_ROLL_MS = 480;

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
  dynamicKeyterms: boolean;
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

/** "paused": the stream reached its time limit after a long quiet stretch. */
export type RealtimeSpeechEndReason = "stopped" | "aborted" | "error" | "closed" | "paused";

/**
 * Why a live session is opening a replacement stream: "rollover" when a stream
 * in use reaches the server's time limit, "dropped" for a network drop, server
 * restart or provider close, "busy" when the server or provider is at capacity.
 */
export type RealtimeSpeechReconnectCause = "rollover" | "dropped" | "busy";

/**
 * Today's voice minutes are running low. Sent once as the remainder falls to
 * 15 minutes and once at 5 minutes; `scope` "service" means the pilot-wide
 * total, not the person's own allowance, is the nearer limit. `message` is
 * ready to show as is.
 */
export type RealtimeSpeechAllowanceWarning = {
  remainingMinutes: number;
  scope: "personal" | "service";
  message: string;
};

export type RealtimeSpeechCallbacks = {
  /** The first stream is ready; replacement streams report onReconnected instead. */
  onReady?: (metadata: RealtimeSpeechMetadata) => void;
  /** The stream dropped; listening pauses until onReconnected. */
  onReconnecting?: (cause: RealtimeSpeechReconnectCause, attempt: number) => void;
  /** A replacement stream is ready, and listening resumes. */
  onReconnected?: (metadata: RealtimeSpeechMetadata) => void;
  onListening?: (listening: boolean) => void;
  onInterim?: (transcript: string, event: RealtimeSpeechTranscriptEvent) => void;
  onFinal: (transcript: string, event: RealtimeSpeechTranscriptEvent) => void;
  onProviderStatus?: (event: RealtimeSpeechProviderEvent) => void;
  onError?: (message: string, code?: string) => void;
  /**
   * `wakeable` is true when trying again later may work: the session paused
   * after a quiet stretch, or gave up reconnecting. It is false for a refusal
   * a new session can't fix, such as a used-up daily allowance or a blocked
   * microphone.
   */
  onEnd?: (reason: RealtimeSpeechEndReason, detail?: { wakeable: boolean }) => void;
  /**
   * Fired once per sustained congestion episode when audio frames are being
   * dropped to keep latency bounded. Lets the UI warn that a command may be cut
   * off, rather than surfacing a generic "not recognized" failure.
   */
  onAudioDropped?: () => void;
  /** Today's voice minutes are running low; voice keeps working until they run out. */
  onAllowanceWarning?: (warning: RealtimeSpeechAllowanceWarning) => void;
};

export type RealtimeSpeechGateOptions = {
  threshold?: number;
  hangoverMs?: number;
  preRollMs?: number;
};

export type RealtimeSpeechOptions = {
  /** HTTP(S) API origin, such as http://localhost:4000. */
  apiBaseUrl?: string;
  /** Explicit WebSocket URL. Takes precedence over apiBaseUrl. */
  url?: string;
  /**
   * Verified user or installation token. It is exchanged for a one-minute
   * transcription ticket, and only the ticket goes in the socket URL.
   */
  accessToken?: string;
  language?: string;
  /** Provider model identifier selected for this session. */
  model?: string | undefined;
  /** Domain vocabulary used by providers that support key-term biasing. */
  keyterms?: string[];
  /** Advertised by the gateway before the client sends mid-stream updates. */
  dynamicKeyterms?: boolean;
  sampleRate?: number;
  audioBufferSize?: number;
  /** Audio frames are dropped above this socket backlog to keep latency bounded. */
  maxBufferedBytes?: number;
  stopTimeoutMs?: number;
  /**
   * Survive a dropped stream (server restart, network drop, provider close,
   * busy server, the server's per-stream time limit) by opening a new one
   * with a fresh ticket while the microphone stays open.
   */
  reconnect?: boolean;
  /** The current access token, so a reconnect after a token refresh still gets a ticket. */
  getAccessToken?: () => string | undefined;
  /**
   * When the server's time limit ends a stream and no speech was heard for
   * this long, end the session as "paused" instead of reconnecting, so a
   * forgotten tab stops streaming. Without it, a time-limited stream always
   * reconnects.
   */
  quietPauseMs?: number;
  /** Reconnect attempts in a row before giving up. */
  maxReconnectAttempts?: number;
  /**
   * Hold back silence instead of streaming it (on by default): only speech,
   * with a moment before and after, is sent. The API keeps the provider
   * stream open meanwhile, so nothing reconnects when speech returns.
   */
  silenceGate?: boolean | RealtimeSpeechGateOptions;
};

export type RealtimeSpeechSession = {
  start(): void;
  updateKeyterms(keyterms: readonly string[]): void;
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

export type RealtimePcmInputSession = {
  stop(): void;
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
  /** Exchanges the access token for a transcription ticket (POST /transcription/ticket). */
  fetchTranscriptionTicket?: (apiBaseUrl: string, accessToken: string) => Promise<string>;
  /**
   * Direct mono PCM source for hosts that already expose decoded microphone
   * samples (for example the Meet extension bridge). This bypasses
   * AudioContext entirely, so default-on capture is not blocked by iframe
   * autoplay/user-activation policy.
   */
  startPcmInput?: (handlers: {
    onChunk: (samples: Float32Array, sampleRate: number) => void;
    onEnded: (reason: string) => void;
  }) => Promise<RealtimePcmInputSession>;
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
  now?: () => number;
  /** A number in [0, 1) that spreads reconnect delays. */
  random?: () => number;
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
  keytermCount?: number;
  remainingMinutes?: number;
  scope?: string;
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
const MAX_REALTIME_KEYTERM_LENGTH = 100;
const MAX_REALTIME_KEYTERM_CHARACTERS = 1_000;

// The longest wait before each reconnect attempt in a row; each wait is
// between half and all of it, so clients dropped together (a deploy, a
// provider blip) don't all return in the same instant. Together they outlast
// the API's 30-second provider circuit breaker. A rollover reconnects at once.
const RECONNECT_DELAYS_MS = [1_000, 2_000, 4_000, 8_000, 15_000, 20_000, 30_000];
const DEFAULT_MAX_RECONNECT_ATTEMPTS = RECONNECT_DELAYS_MS.length;
// Refusals no new stream can fix, even once a stream has worked.
const FINAL_TRANSCRIPTION_CODES = new Set([
  "ACTIVE_ENTITLEMENT_REQUIRED",
  "VOICE_DISABLED_BY_ADMIN",
  "DAILY_VOICE_LIMIT",
  "SERVICE_VOICE_LIMIT",
  "AUDIO_RATE_LIMIT",
  "INVALID_AUDIO_FRAME",
  "AUDIO_FRAME_TOO_LARGE",
  "STARTUP_AUDIO_OVERFLOW",
  "TRANSCRIPTION_UNAVAILABLE",
  "TRANSCRIPTION_NOT_READY",
  "TRANSCRIPTION_ALREADY_ACTIVE",
  "INVALID_READY",
  "MICROPHONE_UNAVAILABLE",
]);
// A stream that stayed up this long was healthy, so its drop starts a fresh
// run of attempts. A stream that keeps dropping at once gives up instead of
// paying for a new provider stream every second.
const HEALTHY_STREAM_MS = 30_000;

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
  ticket?: string,
): string {
  const fallbackOrigin = typeof window === "undefined" ? "http://localhost:4000" : window.location.origin;
  const baseUrl = new URL(apiBaseUrl || fallbackOrigin);
  baseUrl.protocol = baseUrl.protocol === "https:" || baseUrl.protocol === "wss:" ? "wss:" : "ws:";
  baseUrl.pathname = path;
  baseUrl.search = "";
  baseUrl.hash = "";
  // Browsers cannot set headers on WebSocket upgrades, so a one-minute
  // ticket travels in the query instead of the sign-in token.
  if (ticket) {
    baseUrl.searchParams.set("ticket", ticket);
  }
  return baseUrl.toString();
}

/** The API refuses with a client-facing code, such as ACTIVE_ENTITLEMENT_REQUIRED. */
export class TranscriptionTicketError extends Error {
  readonly code: string;

  constructor(code: string) {
    super(code);
    this.code = code;
  }
}

export async function fetchTranscriptionTicket(
  apiBaseUrl: string,
  accessToken: string,
  fetchImpl: typeof fetch = fetch,
): Promise<string> {
  const response = await fetchImpl(new URL("/transcription/ticket", apiBaseUrl).toString(), {
    method: "POST",
    headers: { authorization: `Bearer ${accessToken}` },
  });
  const body = (await response.json().catch(() => null)) as { ticket?: unknown; error?: unknown } | null;
  if (!response.ok || typeof body?.ticket !== "string") {
    throw new TranscriptionTicketError(typeof body?.error === "string" ? body.error : "AUTHORIZATION_UNAVAILABLE");
  }
  return body.ticket;
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
    dynamicKeyterms: payload.dynamicKeyterms === true,
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
  const startPcmInput = dependencies.startPcmInput;
  const getUserMedia = dependencies.getUserMedia ?? defaultGetUserMedia();
  const createAudioContext = dependencies.createAudioContext ?? defaultCreateAudioContext();
  const createAudioWorkletNode =
    dependencies.createAudioWorkletNode ?? defaultCreateAudioWorkletNode();
  const createAudioWorkletModuleUrl =
    dependencies.createAudioWorkletModuleUrl ?? defaultCreateAudioWorkletModuleUrl();
  const revokeAudioWorkletModuleUrl =
    dependencies.revokeAudioWorkletModuleUrl ?? defaultRevokeAudioWorkletModuleUrl();
  if (!createWebSocket || (!startPcmInput && (!getUserMedia || !createAudioContext))) {
    return null;
  }

  // The socket URL without credentials; a ticket is added when the socket opens.
  const url = options.url ?? buildRealtimeTranscriptionWebSocketUrl(options.apiBaseUrl);
  const exchangeTicket = dependencies.fetchTranscriptionTicket ?? fetchTranscriptionTicket;
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
  const maxReconnectAttempts = positiveInteger(
    options.maxReconnectAttempts,
    DEFAULT_MAX_RECONNECT_ATTEMPTS,
  );
  const setTimer = dependencies.setTimeout ?? setTimeout;
  const clearTimer = dependencies.clearTimeout ?? clearTimeout;
  const now = dependencies.now ?? Date.now;
  const random = dependencies.random ?? Math.random;

  let socket: RealtimeWebSocketLike | null = null;
  let stream: MediaStream | null = null;
  let pcmInputSession: RealtimePcmInputSession | null = null;
  let audioContext: RealtimeAudioContextLike | null = null;
  let source: RealtimeAudioSourceLike | null = null;
  let processor: RealtimeAudioProcessorLike | null = null;
  let workletNode: RealtimeAudioWorkletNodeLike | null = null;
  let metadata: RealtimeSpeechMetadata | null = null;
  let listening = false;
  // "reconnecting": the stream dropped, a replacement is opening, and the
  // microphone stays open.
  let state: "idle" | "starting" | "active" | "reconnecting" | "stopping" | "ended" = "idle";
  let stopTimer: ReturnType<typeof setTimeout> | null = null;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let endReported = false;
  let pendingInput = new Float32Array(0);
  let inputSampleRate = targetSampleRate;
  let audioCaptureStarting = false;
  let audioCaptureLive = false;
  let everReady = false;
  let streamReadyAt: number | null = null;
  let lastSpeechAt = now();
  let reconnectAttempts = 0;
  let reconnectCause: RealtimeSpeechReconnectCause | null = null;
  let endWakeable = false;
  let consecutiveDroppedFrames = 0;
  let dropWarningActive = false;
  let currentKeyterms = boundedKeyterms(options.keyterms ?? []);
  const speechGate =
    options.silenceGate === false
      ? null
      : createSpeechGate(typeof options.silenceGate === "object" ? options.silenceGate : {});
  let lastSentKeytermFingerprint: string | null = null;

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

  const clearReconnectTimer = () => {
    if (reconnectTimer !== null) {
      clearTimer(reconnectTimer);
      reconnectTimer = null;
    }
  };

  const releaseAudio = () => {
    setListening(false);
    audioCaptureLive = false;
    pcmInputSession?.stop();
    pcmInputSession = null;
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
    clearReconnectTimer();
    releaseAudio();
    callbacks.onEnd?.(reason, { wakeable: reason === "paused" || endWakeable });
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

  // Server refusals that a new stream can get past.
  const recoverableCause = (code: string | undefined): RealtimeSpeechReconnectCause | null => {
    switch (code) {
      case "TRANSCRIPTION_SESSION_LIMIT":
        return "rollover";
      case "TRANSCRIPTION_CAPACITY_REACHED":
      case "TRANSCRIPTION_PROVIDER_UNAVAILABLE":
      case "RATE_LIMITED":
        return "busy";
      case "AUTHORIZATION_UNAVAILABLE":
      case "POLICY_UNAVAILABLE":
        return "dropped";
      default:
        // Once a stream has worked, anything not known to be final is a
        // provider or network failure (a Deepgram reset arrives as
        // PROVIDER_SOCKET_ERROR or Deepgram's own code). That covers a
        // sign-in token that expired during a long sleep, which the next
        // attempt reads afresh, and the old stream still holding this
        // account's slot. On a first start these are real refusals.
        return everReady && code && !FINAL_TRANSCRIPTION_CODES.has(code) ? "dropped" : null;
    }
  };

  // Opens a replacement stream after a delay while the microphone stays
  // open. Returns false when the session should end instead.
  const scheduleReconnect = (cause: RealtimeSpeechReconnectCause): boolean => {
    if (!options.reconnect || (state !== "starting" && state !== "active" && state !== "reconnecting")) {
      return false;
    }
    if (streamReadyAt !== null && now() - streamReadyAt >= HEALTHY_STREAM_MS) {
      reconnectAttempts = 0;
    }
    streamReadyAt = null;
    if (reconnectAttempts >= maxReconnectAttempts) {
      return false;
    }
    const longestDelayMs = RECONNECT_DELAYS_MS[Math.min(reconnectAttempts, RECONNECT_DELAYS_MS.length - 1)]!;
    const delayMs = cause === "rollover" ? 0 : Math.round(longestDelayMs * (0.5 + random() / 2));
    reconnectAttempts += 1;
    reconnectCause = cause;
    // Detach first, so the dropped socket's own close event is ignored.
    const dropped = socket;
    socket = null;
    if (dropped && dropped.readyState < WEB_SOCKET_CLOSING) {
      dropped.close(1000, "transcription reconnecting");
    }
    state = "reconnecting";
    setListening(false);
    pendingInput = new Float32Array(0);
    clearReconnectTimer();
    callbacks.onReconnecting?.(cause, reconnectAttempts);
    reconnectTimer = setTimer(() => {
      reconnectTimer = null;
      openSocket();
    }, delayMs);
    return true;
  };

  // Ends the session, or opens a replacement stream when the failure is one
  // a new stream can fix.
  const handleFailure = (
    message: string,
    code: string | undefined,
    cause: RealtimeSpeechReconnectCause | null,
  ) => {
    if (!cause || !options.reconnect) {
      fail(message, code);
      return;
    }
    if (
      cause === "rollover" &&
      options.quietPauseMs !== undefined &&
      now() - lastSpeechAt >= options.quietPauseMs
    ) {
      releaseAudio();
      reportEnd("paused");
      closeSocket("transcription paused");
      return;
    }
    if (scheduleReconnect(cause)) {
      return;
    }
    giveUp(code);
  };

  const giveUp = (code?: string) => {
    const lastCause = reconnectCause;
    endWakeable = true;
    fail(
      lastCause === "busy"
        ? "Airo's voice is busy right now. Try again in a minute; typed commands still work."
        : everReady
          ? "Airo's voice connection dropped and couldn't reconnect. Hold an open palm, click the board, or reload it to try again; typed commands still work."
          : "Could not connect to the realtime transcription service.",
      code ?? "TRANSCRIPTION_RECONNECT_FAILED",
    );
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
        ...(currentKeyterms.length
          ? { keyterms: currentKeyterms }
          : {}),
      }),
    );
    lastSentKeytermFingerprint = keytermFingerprint(currentKeyterms);
  };

  const sendKeytermUpdate = () => {
    if (
      options.dynamicKeyterms !== true ||
      !metadata ||
      !socket ||
      socket.readyState !== WEB_SOCKET_OPEN ||
      state === "stopping" ||
      state === "ended"
    ) {
      return;
    }
    const fingerprint = keytermFingerprint(currentKeyterms);
    if (fingerprint === lastSentKeytermFingerprint) {
      return;
    }
    socket.send(
      JSON.stringify({
        type: "transcription.configure",
        keyterms: currentKeyterms,
      }),
    );
    lastSentKeytermFingerprint = fingerprint;
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

  const sendGatedFrame = (frame: Float32Array) => {
    if (!speechGate) {
      sendPcmFrame(frame);
      return;
    }
    for (const gated of speechGate.push(frame)) {
      sendPcmFrame(gated);
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
      sendGatedFrame(frame);
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
    sendGatedFrame(paddedFrame);
  };

  // Listening starts now, or once a replacement stream is ready if the
  // stream dropped while the microphone was connecting.
  const markCaptureLive = () => {
    audioCaptureLive = true;
    if (state === "starting") {
      state = "active";
      setListening(true);
    }
  };

  const connectAudioCapture = async () => {
    if (state !== "starting" || audioCaptureStarting) {
      return;
    }
    audioCaptureStarting = true;
    try {
      if (startPcmInput) {
        if (!pcmInputSession) {
          fail("Meet microphone capture was not prepared before transcription started.", "MICROPHONE_UNAVAILABLE");
          return;
        }
        markCaptureLive();
        return;
      }
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
          // A stream that drops meanwhile keeps the microphone for its replacement.
          if ((state !== "starting" && state !== "reconnecting") || !audioContext || !source) {
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
      markCaptureLive();
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
        streamReadyAt = now();
        if (everReady) {
          // A replacement stream: the microphone is still open, so listening
          // resumes at once.
          reconnectCause = null;
          if (state === "reconnecting") {
            state = audioCaptureLive ? "active" : "starting";
          }
          callbacks.onReconnected?.(metadata);
          sendKeytermUpdate();
          if (audioCaptureLive) {
            setListening(true);
          } else {
            void connectAudioCapture();
          }
          return;
        }
        everReady = true;
        if (state === "reconnecting") {
          state = "starting";
        }
        callbacks.onReady?.(metadata);
        // A label can be created or renamed while the provider connection is
        // opening. Apply the latest complete vocabulary before audio capture.
        sendKeytermUpdate();
        void connectAudioCapture();
        return;
      }
      case "transcription.partial": {
        const transcript = cleanOptionalString(message.transcript);
        if (!transcript) {
          return;
        }
        lastSpeechAt = now();
        const transcriptEvent = toTranscriptEvent(message, transcript);
        callbacks.onInterim?.(transcript, transcriptEvent);
        return;
      }
      case "transcription.final": {
        const transcript = cleanOptionalString(message.transcript);
        if (!transcript) {
          return;
        }
        lastSpeechAt = now();
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
      case "transcription.configured":
        callbacks.onProviderStatus?.({
          status: "configured",
          message:
            typeof message.keytermCount === "number"
              ? `${message.keytermCount} transcription keyterms active`
              : "Transcription keyterms updated",
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
        handleFailure(errorMessage, errorCode, recoverableCause(errorCode));
        return;
      }
      case "transcription.allowance_warning": {
        if (typeof message.remainingMinutes !== "number" || !Number.isFinite(message.remainingMinutes)) {
          return;
        }
        const remainingMinutes = Math.max(0, Math.floor(message.remainingMinutes));
        const scope = message.scope === "service" ? "service" : "personal";
        callbacks.onAllowanceWarning?.({
          remainingMinutes,
          scope,
          message:
            cleanOptionalString(message.message) ??
            `About ${remainingMinutes} minutes of Airo voice left today. Typed commands keep working.`,
        });
        return;
      }
      case "transcription.renewing":
        // The server is replacing the provider stream behind this one, with
        // no gap. A forgotten tab that has heard nobody for a long time
        // pauses here instead, as it did when streams were cut at the limit.
        if (
          options.reconnect &&
          options.quietPauseMs !== undefined &&
          state === "active" &&
          now() - lastSpeechAt >= options.quietPauseMs
        ) {
          releaseAudio();
          reportEnd("paused");
          closeSocket("transcription paused");
        }
        return;
      case "transcription.stopped":
        // Nobody asked this stream to stop: the provider closed it.
        if (options.reconnect && (state === "starting" || state === "active")) {
          if (!scheduleReconnect("dropped")) {
            giveUp();
          }
          return;
        }
        releaseAudio();
        reportEnd("stopped");
        closeSocket("transcription stopped");
        return;
      default:
        return;
    }
  };

  const opening = () => state === "starting" || state === "reconnecting";

  const openSocket = () => {
    if (!opening()) {
      return;
    }
    const accessToken = options.getAccessToken?.() ?? options.accessToken;
    if (options.url || !accessToken) {
      connectSocket(url);
      return;
    }
    const apiBaseUrl = options.apiBaseUrl || (typeof window === "undefined" ? "http://localhost:4000" : window.location.origin);
    void exchangeTicket(apiBaseUrl, accessToken).then(
      (ticket) => {
        if (opening()) {
          connectSocket(buildRealtimeTranscriptionWebSocketUrl(options.apiBaseUrl, DEFAULT_REALTIME_TRANSCRIPTION_PATH, ticket));
        }
      },
      (error: unknown) => {
        if (!opening()) {
          return;
        }
        const code = error instanceof TranscriptionTicketError ? error.code : "AUTHORIZATION_UNAVAILABLE";
        handleFailure(
          describeTranscriptionCloseRefusal(code) ?? "Could not connect to the realtime transcription service.",
          code,
          recoverableCause(code),
        );
      },
    );
  };

  const connectSocket = (socketUrl: string) => {
    try {
      const current = createWebSocket(socketUrl);
      socket = current;
      current.binaryType = "arraybuffer";
      // A replaced socket's late events must not touch its successor.
      current.addEventListener("open", () => {
        if (socket === current) sendStart();
      });
      current.addEventListener("message", (event) => {
        if (socket === current) handleServerMessage(event);
      });
      current.addEventListener("error", () => {
        // With reconnect on, the close event that always follows decides.
        if (socket !== current || options.reconnect) {
          return;
        }
        fail("Could not connect to the realtime transcription service.", "WEBSOCKET_ERROR");
      });
      current.addEventListener("close", (event) => {
        if (socket !== current || state === "ended") {
          return;
        }
        const refusal = describeTranscriptionCloseRefusal(event?.reason ?? "");
        if (refusal) {
          handleFailure(refusal, event.reason, recoverableCause(event.reason));
          return;
        }
        if (state === "stopping") {
          reportEnd("stopped");
          return;
        }
        // A server restart (1012), network drop (1006) or busy server (1013).
        if (options.reconnect) {
          if (!scheduleReconnect(event?.reason === "RATE_LIMITED" ? "busy" : "dropped")) {
            giveUp();
          }
          return;
        }
        reportEnd("closed");
      });
    } catch (error) {
      fail(describeRealtimeSpeechError(error), "WEBSOCKET_UNAVAILABLE");
    }
  };

  const prepareSession = async () => {
    try {
      if (startPcmInput) {
        const nextPcmInputSession = await startPcmInput({
          onChunk: (samples, sampleRate) => {
            if (sampleRate <= 0 || state === "ended" || state === "stopping") {
              return;
            }
            inputSampleRate = sampleRate;
            ingestAudio(samples);
          },
          onEnded: (reason) => {
            if (state === "ended" || state === "stopping") {
              return;
            }
            fail(`The Meet microphone bridge stopped: ${reason}.`, "MICROPHONE_UNAVAILABLE");
          },
        });
        if (state !== "starting") {
          nextPcmInputSession.stop();
          return;
        }
        pcmInputSession = nextPcmInputSession;
        openSocket();
        return;
      }
      // Construct/resume the context synchronously from the caller's click so
      // browsers preserve user activation. Do not start a paid provider stream
      // until microphone permission succeeds.
      audioContext = createAudioContext!();
      const resumePromise =
        audioContext.state === "suspended" ? audioContext.resume?.() : undefined;
      const nextStream = await getUserMedia!({
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
      lastSpeechAt = now();
      void prepareSession();
    },
    updateKeyterms(keyterms) {
      const nextKeyterms = boundedKeyterms(keyterms);
      if (
        keytermFingerprint(nextKeyterms) ===
        keytermFingerprint(currentKeyterms)
      ) {
        return;
      }
      currentKeyterms = nextKeyterms;
      sendKeytermUpdate();
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

export type SpeechGate = {
  /** Takes one capture frame and returns the frames to send now, oldest first. */
  push(frame: Float32Array): Float32Array[];
  isOpen(): boolean;
};

/**
 * Holds back silence: frames are sent from a little before the first loud
 * frame until the hangover after the last one. Assumes the session's
 * 80 ms capture frames.
 */
export function createSpeechGate(options: RealtimeSpeechGateOptions = {}): SpeechGate {
  const threshold = options.threshold ?? DEFAULT_SPEECH_GATE_THRESHOLD;
  const hangoverFrames = Math.max(
    1,
    Math.ceil((options.hangoverMs ?? DEFAULT_SPEECH_GATE_HANGOVER_MS) / REALTIME_TRANSCRIPTION_FRAME_DURATION_MS),
  );
  const preRollFrames = Math.max(
    0,
    Math.ceil((options.preRollMs ?? DEFAULT_SPEECH_GATE_PRE_ROLL_MS) / REALTIME_TRANSCRIPTION_FRAME_DURATION_MS),
  );
  let open = false;
  let quietFrames = 0;
  let preRoll: Float32Array[] = [];
  return {
    push(frame) {
      if (rmsLevel(frame) >= threshold) {
        quietFrames = 0;
        if (open) {
          return [frame];
        }
        open = true;
        const frames = [...preRoll, frame];
        preRoll = [];
        return frames;
      }
      if (open) {
        quietFrames += 1;
        if (quietFrames <= hangoverFrames) {
          return [frame];
        }
        open = false;
      }
      if (preRollFrames > 0) {
        preRoll.push(frame);
        if (preRoll.length > preRollFrames) {
          preRoll.shift();
        }
      }
      return [];
    },
    isOpen: () => open,
  };
}

function rmsLevel(frame: Float32Array): number {
  if (frame.length === 0) {
    return 0;
  }
  let sum = 0;
  for (let index = 0; index < frame.length; index += 1) {
    const sample = frame[index]!;
    sum += sample * sample;
  }
  return Math.sqrt(sum / frame.length);
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
  let totalCharacters = 0;
  for (const raw of keyterms) {
    const term = raw.trim();
    const lookup = term.toLocaleLowerCase("en-US");
    if (
      !term ||
      term.length > MAX_REALTIME_KEYTERM_LENGTH ||
      seen.has(lookup) ||
      totalCharacters + term.length > MAX_REALTIME_KEYTERM_CHARACTERS
    ) {
      continue;
    }
    seen.add(lookup);
    result.push(term);
    totalCharacters += term.length;
    if (result.length >= MAX_REALTIME_KEYTERMS) {
      break;
    }
  }
  return result;
}

function keytermFingerprint(keyterms: readonly string[]): string {
  return keyterms
    .map((term) => term.toLocaleLowerCase("en-US"))
    .join("\u0000");
}

/** Close reasons the API uses when it refuses a stream at connect time. */
function describeTranscriptionCloseRefusal(reason: string): string | null {
  switch (reason) {
    case "ACTIVE_ENTITLEMENT_REQUIRED":
      return "Your pilot access has ended, so Airo voice is off. Typed commands and pointer edits still work.";
    case "VOICE_DISABLED_BY_ADMIN":
      return "Your workspace admin turned off voice. Typed commands and pointer edits still work.";
    case "AUTHORIZATION_UNAVAILABLE":
    case "POLICY_UNAVAILABLE":
      return "Airo couldn't confirm your access just now. Reload the board in a moment to try again.";
    case "Airboard authentication required":
      return "Sign in to Airboard to use Airo's voice. Typed commands and pointer edits still work.";
    default:
      return null;
  }
}

function describeRealtimeSpeechError(error: unknown): string {
  if (
    typeof DOMException !== "undefined" &&
    error instanceof DOMException &&
    error.name === "NotAllowedError"
  ) {
    return blockedMediaHelp("microphone", typeof navigator === "undefined" ? "" : navigator.userAgent);
  }
  if (error instanceof Error && error.message) {
    return error.message;
  }
  return "Realtime transcription could not start.";
}
