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
 *   host -> frame: ready | frame {id, bitmap} | ended {reason} | error {message}
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
  postToHost: (message: BridgeMessage) => void;
  /** The only window object accepted as a message source. */
  hostWindow: unknown;
  /** The only origins accepted for host messages. */
  allowedOrigins: readonly string[];
  helloAttempts?: number;
  helloIntervalMs?: number;
  firstFrameTimeoutMs?: number;
};

export type MeetMediaBridgeVideoSession = {
  stop(): void;
};

export type MeetMediaBridge = {
  startVideo(handlers: {
    onFrame: (bitmap: ImageBitmap) => void;
    onEnded: (reason: string) => void;
  }): Promise<MeetMediaBridgeVideoSession>;
};

function makeMessage(type: string, fields?: Record<string, unknown>): BridgeMessage {
  return { bridge: MEET_MEDIA_BRIDGE_MARKER, v: MEET_MEDIA_BRIDGE_VERSION, type, ...fields };
}

function parseHostMessage(
  event: MeetMediaBridgeEvent,
  env: MeetMediaBridgeEnv,
): BridgeMessage | null {
  if (event.source !== env.hostWindow || !env.allowedOrigins.includes(event.origin)) {
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
      env.postToHost(makeMessage("hello"));
      timer = setTimeout(sendHello, intervalMs);
    };
    sendHello();
  });
}

function createBridge(env: MeetMediaBridgeEnv): MeetMediaBridge {
  return {
    startVideo(handlers) {
      const firstFrameTimeoutMs = env.firstFrameTimeoutMs ?? 8000;
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
            env.postToHost(makeMessage("stop-video"));
          }
        };

        const timeout = setTimeout(() => {
          if (!started) {
            stop(true);
            reject(new Error("The Meet media bridge did not deliver video frames."));
          }
        }, firstFrameTimeoutMs);

        const unsubscribe = env.listen((event) => {
          const message = parseHostMessage(event, env);
          if (!message || stopped) {
            return;
          }
          if (message.type === "frame") {
            const bitmap = message.bitmap as ImageBitmap | undefined;
            if (!bitmap) {
              return;
            }
            env.postToHost(makeMessage("frame-ack", { id: message.id }));
            if (!started) {
              started = true;
              clearTimeout(timeout);
              resolve({ stop: () => stop(true) });
            }
            handlers.onFrame(bitmap);
            return;
          }
          if (message.type === "ended" || message.type === "error") {
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
              handlers.onEnded(reason);
            } else {
              reject(new Error(`The Meet media bridge stopped: ${reason}`));
            }
          }
        });

        env.postToHost(makeMessage("start-video", { maxWidth: 640 }));
      });
    },
  };
}

/**
 * Browser wrapper: probes for the bridge extension from inside the Meet
 * add-on iframe. Under test hooks the harness page may emulate the host in
 * the same window, so the frame's own origin is also accepted.
 */
export function probeMeetMediaBridgeInWindow(): Promise<MeetMediaBridge | null> {
  if (typeof window === "undefined") {
    return Promise.resolve(null);
  }
  const testHooks = process.env.NEXT_PUBLIC_AIRBOARD_TEST_HOOKS === "1";
  let hostWindow: Window;
  try {
    hostWindow = window.top ?? window;
  } catch {
    return Promise.resolve(null);
  }
  if (hostWindow === window && !testHooks) {
    return Promise.resolve(null);
  }
  const allowedOrigins = [
    "https://meet.google.com",
    ...(testHooks ? [window.location.origin] : []),
  ];
  return probeMeetMediaBridge({
    listen: (handler) => {
      const domHandler = (event: MessageEvent) => handler(event);
      window.addEventListener("message", domHandler);
      return () => window.removeEventListener("message", domHandler);
    },
    postToHost: (message) => {
      // The hello/start payloads carry no sensitive data; responses are
      // validated against hostWindow + allowedOrigins on receipt.
      hostWindow.postMessage(message, "*");
    },
    hostWindow,
    allowedOrigins,
  });
}
