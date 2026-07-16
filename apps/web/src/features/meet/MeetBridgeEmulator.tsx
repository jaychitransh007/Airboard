"use client";

import { useEffect } from "react";

const MARKER = "airboard-media-bridge";
const VERSION = 1;
const MAX_IN_FLIGHT = 2;
// Host->frame message types; the emulator must ignore its own posts, since in
// the harness both protocol sides share one window.
const HOST_MESSAGE_TYPES = new Set(["ready", "frame", "audio-chunk", "ended", "error"]);

type ActiveSession = {
  stream: MediaStream;
  video: HTMLVideoElement;
  inFlight: number;
  nextId: number;
  stopped: boolean;
};

type ActiveAudioSession = {
  stream: MediaStream;
  context: AudioContext;
  nodes: AudioNode[];
  stopped: boolean;
};

/**
 * Test-only stand-in for the Meet Media Bridge extension. The real content
 * script runs on meet.google.com and streams the meeting camera into the
 * add-on iframe; in the harness everything is one top-level window, so this
 * component answers the same protocol using the test camera (Playwright runs
 * with a fake media device). Renders nothing.
 */
export function MeetBridgeEmulator() {
  useEffect(() => {
    if (process.env.NEXT_PUBLIC_AIRBOARD_TEST_HOOKS !== "1") {
      return;
    }
    let active: ActiveSession | null = null;

    const post = (message: Record<string, unknown>, transfer?: Transferable[]) => {
      window.postMessage(
        { bridge: MARKER, v: VERSION, ...message },
        window.location.origin,
        transfer ?? [],
      );
    };

    const stopActive = (reason: string, notify: boolean) => {
      const session = active;
      if (!session || session.stopped) {
        return;
      }
      session.stopped = true;
      active = null;
      session.stream.getTracks().forEach((track) => track.stop());
      session.video.srcObject = null;
      if (notify) {
        post({ type: "ended", reason, channel: "video" });
      }
    };

    let activeAudio: ActiveAudioSession | null = null;
    const stopActiveAudio = (reason: string, notify: boolean) => {
      const session = activeAudio;
      if (!session || session.stopped) {
        return;
      }
      session.stopped = true;
      activeAudio = null;
      session.nodes.forEach((node) => {
        try {
          node.disconnect();
        } catch {
          // Already torn down.
        }
      });
      session.stream.getTracks().forEach((track) => track.stop());
      void session.context.close().catch(() => {});
      if (notify) {
        post({ type: "ended", reason, channel: "audio" });
      }
    };

    const startAudio = async () => {
      stopActiveAudio("restarted", false);
      let stream: MediaStream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      } catch (error) {
        post({
          type: "error",
          message: `microphone-unavailable: ${(error as Error)?.name}`,
          channel: "audio",
        });
        return;
      }
      const context = new AudioContext();
      const source = context.createMediaStreamSource(stream);
      const processor = context.createScriptProcessor(4096, 1, 1);
      const silence = context.createGain();
      silence.gain.value = 0;
      const session: ActiveAudioSession = {
        stream,
        context,
        nodes: [source, processor, silence],
        stopped: false,
      };
      activeAudio = session;
      let seq = 1;
      processor.onaudioprocess = (event) => {
        if (session.stopped) {
          return;
        }
        const input = event.inputBuffer.getChannelData(0);
        const copy = new Float32Array(input.length);
        copy.set(input);
        post(
          { type: "audio-chunk", seq: seq++, sampleRate: context.sampleRate, samples: copy.buffer },
          [copy.buffer],
        );
      };
      source.connect(processor);
      processor.connect(silence);
      silence.connect(context.destination);
    };

    const startVideo = async (maxWidthRaw: unknown) => {
      stopActive("restarted", false);
      let stream: MediaStream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
      } catch (error) {
        post({ type: "error", message: `camera-unavailable: ${(error as Error)?.name}` });
        return;
      }
      const video = document.createElement("video");
      video.muted = true;
      video.playsInline = true;
      video.srcObject = stream;
      await video.play();

      const session: ActiveSession = { stream, video, inFlight: 0, nextId: 1, stopped: false };
      active = session;
      const maxWidth = Math.max(160, Math.min(1280, Number(maxWidthRaw) || 640));

      const pump = () => {
        if (session.stopped) {
          return;
        }
        if (session.inFlight < MAX_IN_FLIGHT && video.videoWidth > 0) {
          const width = Math.min(maxWidth, video.videoWidth);
          const height = Math.round((video.videoHeight * width) / video.videoWidth);
          session.inFlight += 1;
          const id = session.nextId++;
          createImageBitmap(video, { resizeWidth: width, resizeHeight: height })
            .then((bitmap) => {
              if (session.stopped) {
                bitmap.close();
                return;
              }
              post({ type: "frame", id, bitmap }, [bitmap]);
            })
            .catch(() => {
              session.inFlight = Math.max(0, session.inFlight - 1);
            });
        }
        video.requestVideoFrameCallback(pump);
      };
      video.requestVideoFrameCallback(pump);
    };

    const onMessage = (event: MessageEvent) => {
      const data = event.data as { bridge?: string; v?: number; type?: string } | null;
      if (
        !data ||
        data.bridge !== MARKER ||
        data.v !== VERSION ||
        typeof data.type !== "string" ||
        HOST_MESSAGE_TYPES.has(data.type) ||
        event.source !== window
      ) {
        return;
      }
      if (data.type === "hello") {
        post({ type: "ready" });
        return;
      }
      if (data.type === "start-video") {
        void startVideo((data as { maxWidth?: unknown }).maxWidth);
        return;
      }
      if (data.type === "frame-ack") {
        if (active) {
          active.inFlight = Math.max(0, active.inFlight - 1);
        }
        return;
      }
      if (data.type === "stop-video") {
        stopActive("stopped", false);
        return;
      }
      if (data.type === "start-audio") {
        void startAudio();
        return;
      }
      if (data.type === "stop-audio") {
        stopActiveAudio("stopped", false);
      }
    };

    window.addEventListener("message", onMessage);
    return () => {
      window.removeEventListener("message", onMessage);
      stopActive("unmounted", false);
      stopActiveAudio("unmounted", false);
    };
  }, []);

  return null;
}
