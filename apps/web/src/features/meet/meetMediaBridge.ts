import {
  CONFIGURED_CHROME_EXTENSION_ORIGIN,
  extensionRelayMessageFields,
  extensionRelayNonceFromHash,
  isTrustedExtensionRelayMessage,
  UNPACKED_EXTENSION_RELAY_ALLOWED,
} from "./extensionRelayTrust.ts";

/**
 * Client side of the Airboard media bridge.
 *
 * Google Meet neither exposes its media tracks to add-ons nor delegates
 * camera permission to the add-on iframe (confirmed in a real client), so an
 * embedded capture inside this frame is browser-blocked. The Airboard Meet
 * Media Bridge extension runs on meet.google.com — the origin the user has
 * already granted camera access to — captures there on request, and streams
 * downscaled video frames into this frame over window.postMessage with
 * transferable ImageBitmaps. Capture starts only from an explicit user action
 * in Airboard and stops when either side ends it.
 *
 * Protocol (all messages carry `bridge: "airboard-media-bridge", v: 1`):
 *   frame -> host: hello | start-video {maxWidth} | frame-ack {id} | stop-video
 *                | start-audio | audio-ack {seq} | stop-audio
 *   host -> frame: ready | frame {id, bitmap} | audio-chunk {seq, sampleRate, samples}
 *                | ended {reason, channel} | error {message, channel}
 * `channel` ("video" | "audio") scopes end/error events so one capture
 * stopping never tears down the other.
 */

export const MEET_MEDIA_BRIDGE_MARKER = "airboard-media-bridge";
export const MEET_MEDIA_BRIDGE_VERSION = 1;

type BridgeMessage = {
  bridge: typeof MEET_MEDIA_BRIDGE_MARKER;
  v: typeof MEET_MEDIA_BRIDGE_VERSION;
  type: string;
  [key: string]: unknown;
};

export type MeetMediaBridgeEvent = {
  data: unknown;
  origin: string;
  source: unknown;
};

export type MeetMediaBridgeEnv = {
  /** Subscribes to message events; returns an unsubscribe function. */
  listen: (handler: (event: MeetMediaBridgeEvent) => void) => () => void;
  /** Posts a message to the host (top) window. */
  postToHost: (message: BridgeMessage, transfer?: Transferable[]) => void;
  /** The only window object accepted as a message source. */
  hostWindow: unknown;
  /** The only origins accepted for host messages. */
  allowedOrigins: readonly string[];
  /** Exact published extension origin accepted in addition to allowedOrigins. */
  trustedExtensionOrigin?: string;
  /** 256-bit frame binding required on every message in an extension relay. */
  relayNonce?: string;
  /** Allows a nonce-bound unpacked extension only when no published ID exists. */
  allowNonceBoundExtensionOrigin?: boolean;
  helloAttempts?: number;
  helloIntervalMs?: number;
  firstFrameTimeoutMs?: number;
};

export type MeetMediaBridgeVideoSession = {
  stop(): void;
};

export type MeetMediaBridgeAudioSession = {
  stop(): void;
};

export type MeetMediaBridge = {
  startVideo(handlers: {
    onFrame: (bitmap: ImageBitmap) => void;
    onEnded: (reason: string) => void;
  }): Promise<MeetMediaBridgeVideoSession>;
  startAudio(handlers: {
    onChunk: (samples: Float32Array<ArrayBuffer>, sampleRate: number) => void;
    onEnded: (reason: string) => void;
  }): Promise<MeetMediaBridgeAudioSession>;
};

function makeMessage(type: string, fields?: Record<string, unknown>): BridgeMessage {
  return { bridge: MEET_MEDIA_BRIDGE_MARKER, v: MEET_MEDIA_BRIDGE_VERSION, type, ...fields };
}

function makeEnvMessage(
  env: MeetMediaBridgeEnv,
  type: string,
  fields?: Record<string, unknown>,
): BridgeMessage {
  return makeMessage(type, {
    ...fields,
    ...extensionRelayMessageFields(env.relayNonce ?? null),
  });
}

function parseHostMessage(
  event: MeetMediaBridgeEvent,
  env: MeetMediaBridgeEnv,
): BridgeMessage | null {
  if (event.source !== env.hostWindow) {
    return null;
  }
  const data = event.data as BridgeMessage | null;
  if (
    !data ||
    typeof data !== "object" ||
    data.bridge !== MEET_MEDIA_BRIDGE_MARKER ||
    data.v !== MEET_MEDIA_BRIDGE_VERSION ||
    typeof data.type !== "string"
  ) {
    return null;
  }
  const exactOrNonceBoundExtension =
    (Boolean(env.trustedExtensionOrigin) || env.allowNonceBoundExtensionOrigin === true) &&
    isTrustedExtensionRelayMessage(event, {
      configuredOrigin: env.trustedExtensionOrigin ?? null,
      relayNonce: env.relayNonce ?? null,
      allowNonceBoundUnpacked: env.allowNonceBoundExtensionOrigin === true,
    });
  if (!env.allowedOrigins.includes(event.origin) && !exactOrNonceBoundExtension) {
    return null;
  }
  if (env.relayNonce && data.relayNonce !== env.relayNonce) {
    return null;
  }
  return data;
}

/**
 * Announces this frame to the bridge extension and resolves with a bridge
 * handle when the extension answers, or null when no extension is present.
 */
export function probeMeetMediaBridge(env: MeetMediaBridgeEnv): Promise<MeetMediaBridge | null> {
  const attempts = env.helloAttempts ?? 8;
  const intervalMs = env.helloIntervalMs ?? 500;

  return new Promise((resolve) => {
    let settled = false;
    let sent = 0;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const unsubscribe = env.listen((event) => {
      const message = parseHostMessage(event, env);
      if (!message || message.type !== "ready" || settled) {
        return;
      }
      settled = true;
      if (timer) {
        clearTimeout(timer);
      }
      unsubscribe();
      resolve(createBridge(env));
    });

    const sendHello = () => {
      if (settled) {
        return;
      }
      if (sent >= attempts) {
        settled = true;
        unsubscribe();
        resolve(null);
        return;
      }
      sent += 1;
      env.postToHost(makeEnvMessage(env, "hello"));
      timer = setTimeout(sendHello, intervalMs);
    };
    sendHello();
  });
}

function createBridge(env: MeetMediaBridgeEnv): MeetMediaBridge {
  const startChannel = <TSession>(input: {
    channel: "video" | "audio";
    startMessage: BridgeMessage;
    stopMessage: BridgeMessage;
    timeoutError: string;
    /** Handles a data message; returns true when the session is "started". */
    onData: (message: BridgeMessage) => boolean;
    onEnded: (reason: string) => void;
    makeSession: (stop: () => void) => TSession;
  }): Promise<TSession> => {
    const firstDataTimeoutMs = env.firstFrameTimeoutMs ?? 8000;
    return new Promise((resolve, reject) => {
      let started = false;
      let stopped = false;

      const stop = (notifyHost: boolean) => {
        if (stopped) {
          return;
        }
        stopped = true;
        unsubscribe();
        if (notifyHost) {
          env.postToHost(input.stopMessage);
        }
      };

      const timeout = setTimeout(() => {
        if (!started) {
          stop(true);
          reject(new Error(input.timeoutError));
        }
      }, firstDataTimeoutMs);

      const unsubscribe = env.listen((event) => {
        const message = parseHostMessage(event, env);
        if (!message || stopped) {
          return;
        }
        if (message.type === "ended" || message.type === "error") {
          // Unscoped end/error events apply to every channel; scoped ones
          // only to their own.
          const channel = typeof message.channel === "string" ? message.channel : null;
          if (channel !== null && channel !== input.channel) {
            return;
          }
          const reason =
            typeof message.reason === "string"
              ? message.reason
              : typeof message.message === "string"
                ? message.message
                : message.type;
          const wasStarted = started;
          clearTimeout(timeout);
          stop(false);
          if (wasStarted) {
            input.onEnded(reason);
          } else {
            reject(new Error(`The Meet media bridge stopped: ${reason}`));
          }
          return;
        }
        if (input.onData(message) && !started) {
          started = true;
          clearTimeout(timeout);
          resolve(input.makeSession(() => stop(true)));
        }
      });

      env.postToHost(input.startMessage);
    });
  };

  return {
    startVideo(handlers) {
      return startChannel<MeetMediaBridgeVideoSession>({
        channel: "video",
        startMessage: makeEnvMessage(env, "start-video", { maxWidth: 640 }),
        stopMessage: makeEnvMessage(env, "stop-video"),
        timeoutError: "The Meet media bridge did not deliver video frames.",
        onEnded: handlers.onEnded,
        makeSession: (stop) => ({ stop }),
        onData: (message) => {
          if (message.type !== "frame") {
            return false;
          }
          const bitmap = message.bitmap as ImageBitmap | undefined;
          if (!bitmap) {
            return false;
          }
          env.postToHost(makeEnvMessage(env, "frame-ack", { id: message.id }));
          handlers.onFrame(bitmap);
          return true;
        },
      });
    },
    startAudio(handlers) {
      return startChannel<MeetMediaBridgeAudioSession>({
        channel: "audio",
        startMessage: makeEnvMessage(env, "start-audio"),
        stopMessage: makeEnvMessage(env, "stop-audio"),
        timeoutError: "The Meet media bridge did not deliver microphone audio.",
        onEnded: handlers.onEnded,
        makeSession: (stop) => ({ stop }),
        onData: (message) => {
          if (message.type !== "audio-chunk") {
            return false;
          }
          const samples = message.samples as ArrayBuffer | undefined;
          const sampleRate = typeof message.sampleRate === "number" ? message.sampleRate : 0;
          const seq = typeof message.seq === "number" && Number.isSafeInteger(message.seq)
            ? message.seq
            : 0;
          if (!samples || sampleRate <= 0 || seq <= 0) {
            return false;
          }
          handlers.onChunk(new Float32Array(samples), sampleRate);
          env.postToHost(makeEnvMessage(env, "audio-ack", { seq }));
          return true;
        },
      });
    },
  };
}

/**
 * Rebuilds a live microphone MediaStream from bridged audio chunks so the
 * realtime speech session can consume it exactly like a local microphone.
 * Calling stop() on the returned stream's track (which the speech session
 * does on teardown) also stops the bridge capture on the Meet page.
 */
export async function createBridgedMicStream(bridge: MeetMediaBridge): Promise<MediaStream> {
  type AudioContextCtor = new () => AudioContext;
  const Ctor: AudioContextCtor | undefined =
    (window as { AudioContext?: AudioContextCtor; webkitAudioContext?: AudioContextCtor })
      .AudioContext ??
    (window as { webkitAudioContext?: AudioContextCtor }).webkitAudioContext;
  if (!Ctor) {
    throw new Error("Web Audio is unavailable in this browser.");
  }
  const context = new Ctor();
  const destination = context.createMediaStreamDestination();
  let nextTime = 0;
  let torndown = false;

  const session = await bridge.startAudio({
    onChunk: (samples, sampleRate) => {
      if (torndown) {
        return;
      }
      // Schedule chunks back-to-back; the context resamples as needed.
      const buffer = context.createBuffer(1, samples.length, sampleRate);
      buffer.copyToChannel(samples, 0);
      const source = context.createBufferSource();
      source.buffer = buffer;
      source.connect(destination);
      const lead = context.currentTime + 0.02;
      if (nextTime < lead) {
        nextTime = lead;
      }
      source.start(nextTime);
      nextTime += buffer.duration;
    },
    onEnded: () => {
      teardown();
    },
  });

  const [track] = destination.stream.getAudioTracks();
  const originalStop = track ? track.stop.bind(track) : null;
  const teardown = () => {
    if (torndown) {
      return;
    }
    torndown = true;
    session.stop();
    originalStop?.();
    void context.close().catch(() => {});
  };
  if (track) {
    track.stop = teardown;
  }
  return destination.stream;
}

/**
 * Browser wrapper: probes through the immediate parent. In the Marketplace
 * add-on that parent is Meet itself; in the Chrome camera-overlay product it
 * is engine.html, which relays to Meet and reports sanitized compositor state
 * to the extension background worker. Using window.top here bypasses that
 * relay and prevents server preflight from ever completing.
 */
export function probeMeetMediaBridgeInWindow(): Promise<MeetMediaBridge | null> {
  if (typeof window === "undefined") {
    return Promise.resolve(null);
  }
  const testHooks = process.env.NEXT_PUBLIC_AIRBOARD_TEST_HOOKS === "1";
  let hostWindow: Window;
  try {
    hostWindow = window.parent;
  } catch {
    return Promise.resolve(null);
  }
  if (hostWindow === window && !testHooks) {
    return Promise.resolve(null);
  }
  const relayNonce = extensionRelayNonceFromHash(window.location.hash);
  const allowedOrigins = [
    "https://meet.google.com",
    ...(CONFIGURED_CHROME_EXTENSION_ORIGIN ? [CONFIGURED_CHROME_EXTENSION_ORIGIN] : []),
    ...(testHooks ? [window.location.origin] : []),
  ];
  const hostTargetOrigin = relayNonce
    ? CONFIGURED_CHROME_EXTENSION_ORIGIN ?? "*"
    : testHooks
      ? "*"
      : "https://meet.google.com";
  return probeMeetMediaBridge({
    listen: (handler) => {
      const domHandler = (event: MessageEvent) => handler(event);
      window.addEventListener("message", domHandler);
      return () => window.removeEventListener("message", domHandler);
    },
    postToHost: (message, transfer) => {
      hostWindow.postMessage(message, hostTargetOrigin, transfer ?? []);
    },
    hostWindow,
    allowedOrigins,
    ...(CONFIGURED_CHROME_EXTENSION_ORIGIN
      ? { trustedExtensionOrigin: CONFIGURED_CHROME_EXTENSION_ORIGIN }
      : {}),
    ...(relayNonce ? { relayNonce } : {}),
    allowNonceBoundExtensionOrigin: Boolean(
      relayNonce &&
        !CONFIGURED_CHROME_EXTENSION_ORIGIN &&
        UNPACKED_EXTENSION_RELAY_ALLOWED,
    ),
  });
}

/**
 * Camera-overlay channel: the inverse of the capture bridge. The add-on frame
 * streams transparent neon board frames to the extension's MAIN-world
 * compositor, which blends them onto the presenter's outgoing Meet camera.
 */
export type MeetCameraOverlayVerification = {
  extensionVersion: string;
  framesComposited: number;
  lastCompositeAt: number;
  senderAttached: boolean;
  framesEncoded: number;
  bytesSent: number;
  lastVerifiedAt: number;
};

export type MeetCameraOverlayState = {
  armed: boolean;
  engaged: boolean;
  verification?: MeetCameraOverlayVerification;
};

function finiteMetric(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : 0;
}

function parseOverlayVerification(value: unknown): MeetCameraOverlayVerification | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }
  const verification = value as Record<string, unknown>;
  return {
    extensionVersion:
      typeof verification.extensionVersion === "string"
        ? verification.extensionVersion.slice(0, 24)
        : "unknown",
    framesComposited: finiteMetric(verification.framesComposited),
    lastCompositeAt: finiteMetric(verification.lastCompositeAt),
    senderAttached: verification.senderAttached === true,
    framesEncoded: finiteMetric(verification.framesEncoded),
    bytesSent: finiteMetric(verification.bytesSent),
    lastVerifiedAt: finiteMetric(verification.lastVerifiedAt),
  };
}

export type MeetCameraOverlay = {
  /** Arms the compositor and begins accepting frames. */
  start(): void;
  /** Disarms the compositor; the camera returns to passthrough. */
  stop(): void;
  /**
   * Sends one overlay frame unless the in-flight cap is reached. Returns
   * whether the bitmap was sent (and therefore transferred); the caller must
   * close it when false.
   */
  trySendFrame(bitmap: ImageBitmap, scrim: number): boolean;
  /** Unsubscribes; does not disarm the compositor. */
  dispose(): void;
};

export function probeMeetCameraOverlay(
  env: MeetMediaBridgeEnv,
  onState: (state: MeetCameraOverlayState) => void,
): Promise<MeetCameraOverlay | null> {
  const attempts = env.helloAttempts ?? 8;
  const intervalMs = env.helloIntervalMs ?? 500;

  return new Promise((resolve) => {
    let settled = false;
    let sent = 0;
    let inFlight = 0;
    let nextId = 1;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const unsubscribe = env.listen((event) => {
      const message = parseHostMessage(event, env);
      if (!message) {
        return;
      }
      if (message.type === "overlay-state") {
        const verification = parseOverlayVerification(message.verification);
        onState({
          armed: message.armed === true,
          engaged: message.engaged === true,
          ...(verification ? { verification } : {}),
        });
        if (!settled) {
          settled = true;
          if (timer) {
            clearTimeout(timer);
          }
          resolve(overlayHandle);
        }
        return;
      }
      if (message.type === "overlay-ack") {
        inFlight = Math.max(0, inFlight - 1);
      }
    });

    const overlayHandle: MeetCameraOverlay = {
      start() {
        env.postToHost(makeEnvMessage(env, "overlay-start"));
      },
      stop() {
        env.postToHost(makeEnvMessage(env, "overlay-stop"));
      },
      trySendFrame(bitmap, scrim) {
        if (inFlight >= 2) {
          return false;
        }
        inFlight += 1;
        env.postToHost(
          makeEnvMessage(env, "overlay-frame", { id: nextId++, scrim, bitmap }),
          [bitmap],
        );
        return true;
      },
      dispose() {
        unsubscribe();
      },
    };

    const sendHello = () => {
      if (settled) {
        return;
      }
      if (sent >= attempts) {
        settled = true;
        unsubscribe();
        resolve(null);
        return;
      }
      sent += 1;
      env.postToHost(makeEnvMessage(env, "overlay-hello"));
      timer = setTimeout(sendHello, intervalMs);
    };
    sendHello();
  });
}

/** Browser wrapper for the camera-overlay probe (Meet or extension relay parent). */
export function probeMeetCameraOverlayInWindow(
  onState: (state: MeetCameraOverlayState) => void,
): Promise<MeetCameraOverlay | null> {
  if (typeof window === "undefined") {
    return Promise.resolve(null);
  }
  const testHooks = process.env.NEXT_PUBLIC_AIRBOARD_TEST_HOOKS === "1";
  let hostWindow: Window;
  try {
    hostWindow = window.parent;
  } catch {
    return Promise.resolve(null);
  }
  if (hostWindow === window && !testHooks) {
    return Promise.resolve(null);
  }
  const relayNonce = extensionRelayNonceFromHash(window.location.hash);
  const allowedOrigins = [
    "https://meet.google.com",
    ...(CONFIGURED_CHROME_EXTENSION_ORIGIN ? [CONFIGURED_CHROME_EXTENSION_ORIGIN] : []),
    ...(testHooks ? [window.location.origin] : []),
  ];
  const hostTargetOrigin = relayNonce
    ? CONFIGURED_CHROME_EXTENSION_ORIGIN ?? "*"
    : testHooks
      ? "*"
      : "https://meet.google.com";
  return probeMeetCameraOverlay(
    {
      listen: (handler) => {
        const domHandler = (event: MessageEvent) => handler(event);
        window.addEventListener("message", domHandler);
        return () => window.removeEventListener("message", domHandler);
      },
      postToHost: (message, transfer) => {
        hostWindow.postMessage(message, hostTargetOrigin, transfer ?? []);
      },
      hostWindow,
      allowedOrigins,
      ...(CONFIGURED_CHROME_EXTENSION_ORIGIN
        ? { trustedExtensionOrigin: CONFIGURED_CHROME_EXTENSION_ORIGIN }
        : {}),
      ...(relayNonce ? { relayNonce } : {}),
      allowNonceBoundExtensionOrigin: Boolean(
        relayNonce &&
          !CONFIGURED_CHROME_EXTENSION_ORIGIN &&
          UNPACKED_EXTENSION_RELAY_ALLOWED,
      ),
    },
    onState,
  );
}
