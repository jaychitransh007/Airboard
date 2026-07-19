"use client";

import { useEffect } from "react";

const MARKER = "airboard-media-bridge";
const VERSION = 1;
const MAX_IN_FLIGHT = 2;
// Host->frame message types; the emulator must ignore its own posts, since in
// the harness both protocol sides share one window.
const HOST_MESSAGE_TYPES = new Set([
  "ready",
  "frame",
  "audio-chunk",
  "ended",
  "error",
  "overlay-state",
  "overlay-ack",
]);

type ActiveSession = {
  stream: MediaStream;
  video: HTMLVideoElement;
  inFlight: number;
  nextId: number;
  stopped: boolean;
};

type ActiveAudioSession = {
  stream: MediaStream;
  reader: ReadableStreamDefaultReader<AudioDataLike> | null;
  stopped: boolean;
};

// Chrome-only WebCodecs APIs not yet in lib.dom; minimal shapes used here.
type AudioDataLike = {
  sampleRate: number;
  numberOfFrames: number;
  copyTo(destination: Float32Array, options: { planeIndex: number; format: string }): void;
  close(): void;
};
type MediaStreamTrackProcessorCtor = new (init: { track: MediaStreamTrack }) => {
  readable: ReadableStream<AudioDataLike>;
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
      void session.reader?.cancel().catch(() => {});
      session.stream.getTracks().forEach((track) => track.stop());
      if (notify) {
        post({ type: "ended", reason, channel: "audio" });
      }
    };

    const startAudio = async () => {
      stopActiveAudio("restarted", false);
      const Processor = (
        window as { MediaStreamTrackProcessor?: MediaStreamTrackProcessorCtor }
      ).MediaStreamTrackProcessor;
      if (!Processor) {
        post({ type: "error", message: "audio-capture-unsupported", channel: "audio" });
        return;
      }
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
      const [track] = stream.getAudioTracks();
      if (!track) {
        stream.getTracks().forEach((t) => t.stop());
        post({ type: "error", message: "no-audio-track", channel: "audio" });
        return;
      }
      const reader = new Processor({ track }).readable.getReader();
      const session: ActiveAudioSession = { stream, reader, stopped: false };
      activeAudio = session;
      let seq = 1;
      void (async () => {
        try {
          while (!session.stopped) {
            const { value, done } = await reader.read();
            if (done || session.stopped) {
              value?.close();
              break;
            }
            const samples = new Float32Array(value.numberOfFrames);
            value.copyTo(samples, { planeIndex: 0, format: "f32-planar" });
            const sampleRate = value.sampleRate;
            value.close();
            post({ type: "audio-chunk", seq: seq++, sampleRate, samples: samples.buffer }, [
              samples.buffer,
            ]);
          }
        } catch {
          // Reader cancelled; teardown handled by stopActiveAudio.
        }
      })();
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
        return;
      }
      // Camera-overlay compositor emulation: acks frames and mirrors state so
      // e2e can assert the pump without a real Meet page. Counters land on
      // window for assertions.
      const testWindow = window as unknown as {
        __overlayFrames?: number;
        __overlayArmed?: boolean;
      };
      const overlayVerification = () => {
        const frames = testWindow.__overlayFrames ?? 0;
        return {
          extensionVersion: "0.8.0-test",
          framesComposited: frames,
          lastCompositeAt: frames > 0 ? Date.now() : 0,
          senderAttached: frames > 0,
          framesEncoded: frames,
          bytesSent: frames * 4_096,
          lastVerifiedAt: frames > 0 ? Date.now() : 0,
        };
      };
      if (data.type === "overlay-hello") {
        post({
          type: "overlay-state",
          armed: testWindow.__overlayArmed === true,
          engaged: true,
          verification: overlayVerification(),
        });
        return;
      }
      if (data.type === "overlay-start") {
        testWindow.__overlayArmed = true;
        testWindow.__overlayFrames = testWindow.__overlayFrames ?? 0;
        post({
          type: "overlay-state",
          armed: true,
          engaged: true,
          verification: overlayVerification(),
        });
        return;
      }
      if (data.type === "overlay-frame") {
        const frame = data as unknown as { id?: number; bitmap?: ImageBitmap };
        testWindow.__overlayFrames = (testWindow.__overlayFrames ?? 0) + 1;
        frame.bitmap?.close();
        post({ type: "overlay-ack", id: frame.id });
        if (testWindow.__overlayFrames === 1 || testWindow.__overlayFrames % 5 === 0) {
          post({
            type: "overlay-state",
            armed: true,
            engaged: true,
            verification: overlayVerification(),
          });
        }
        return;
      }
      if (data.type === "overlay-stop") {
        testWindow.__overlayArmed = false;
        post({
          type: "overlay-state",
          armed: false,
          engaged: true,
          verification: overlayVerification(),
        });
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
