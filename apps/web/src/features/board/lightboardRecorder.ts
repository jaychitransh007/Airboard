/**
 * Lightboard studio recorder.
 *
 * Records the composite a viewer sees — camera or captured-screen underlay,
 * scrim, then the neon board canvas — into a WebM. The on-screen board is a DOM
 * stack (video + scrim div + transparent canvas), so a recording canvas redraws
 * the stack per animation frame and MediaRecorder captures that plus the
 * microphone. Everything is local: no upload, no server.
 */

export type RecorderTheme = "classic" | "lightboard";

export type LightboardRecorderInput = {
  boardCanvas: HTMLCanvasElement;
  /** Present and playing only when a camera or captured-screen underlay is on. */
  underlayVideo: HTMLVideoElement | null;
  /** Cameras are mirrored/cover-fit; screens are unmirrored/contain-fit. */
  underlayMode?: "camera" | "screen";
  getScrimOpacity: () => number;
  getTheme: () => RecorderTheme;
  /** Longest output edge; the recording canvas keeps the board aspect. */
  maxWidth?: number;
  frameRate?: number;
  /** Injectable for tests; defaults to the real microphone. */
  getUserMedia?: (constraints: MediaStreamConstraints) => Promise<MediaStream>;
};

export type LightboardRecorderHandle = {
  /** True when the recording includes a microphone track. */
  hasAudio: boolean;
  stop(): Promise<Blob>;
};

const STAGE_DARK = "#05080c";
const MIME_PREFERENCES = [
  "video/webm;codecs=vp9,opus",
  "video/webm;codecs=vp8,opus",
  "video/webm",
];

/** Output size: board aspect, capped to maxWidth, floored to even numbers. */
export function recordingDimensions(
  boardWidth: number,
  boardHeight: number,
  maxWidth = 1920,
): { width: number; height: number } {
  const safeWidth = Math.max(2, boardWidth);
  const safeHeight = Math.max(2, boardHeight);
  const scale = Math.min(1, maxWidth / safeWidth);
  const even = (value: number) => Math.max(2, 2 * Math.floor((value * scale) / 2));
  return { width: even(safeWidth), height: even(safeHeight) };
}

/** object-fit: cover geometry — source rectangle drawn to fill dst. */
export function coverRect(
  sourceWidth: number,
  sourceHeight: number,
  targetWidth: number,
  targetHeight: number,
): { x: number; y: number; width: number; height: number } {
  const scale = Math.max(targetWidth / sourceWidth, targetHeight / sourceHeight);
  const width = sourceWidth * scale;
  const height = sourceHeight * scale;
  return { x: (targetWidth - width) / 2, y: (targetHeight - height) / 2, width, height };
}

/** object-fit: contain geometry — the whole source remains visible. */
export function containRect(
  sourceWidth: number,
  sourceHeight: number,
  targetWidth: number,
  targetHeight: number,
): { x: number; y: number; width: number; height: number } {
  const scale = Math.min(targetWidth / sourceWidth, targetHeight / sourceHeight);
  const width = sourceWidth * scale;
  const height = sourceHeight * scale;
  return { x: (targetWidth - width) / 2, y: (targetHeight - height) / 2, width, height };
}

export function recordingFileName(now: Date): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return (
    `airboard-lightboard-${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}` +
    `-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}.webm`
  );
}

export async function startLightboardRecording(
  input: LightboardRecorderInput,
): Promise<LightboardRecorderHandle> {
  if (typeof MediaRecorder === "undefined") {
    throw new Error("Recording is not supported in this browser.");
  }
  const frameRate = input.frameRate ?? 30;
  const { width, height } = recordingDimensions(
    input.boardCanvas.width,
    input.boardCanvas.height,
    input.maxWidth,
  );

  const stage = document.createElement("canvas");
  stage.width = width;
  stage.height = height;
  const context = stage.getContext("2d");
  if (!context) {
    throw new Error("Recording canvas is unavailable.");
  }

  let stopped = false;
  const drawFrame = () => {
    if (stopped) {
      return;
    }
    const theme = input.getTheme();
    context.fillStyle = theme === "lightboard" ? STAGE_DARK : "#ffffff";
    context.fillRect(0, 0, width, height);

    const video = input.underlayVideo;
    if (theme === "lightboard" && video && video.videoWidth > 0) {
      const mode = input.underlayMode ?? "camera";
      const fit =
        mode === "screen"
          ? containRect(video.videoWidth, video.videoHeight, width, height)
          : coverRect(video.videoWidth, video.videoHeight, width, height);
      if (mode === "camera") {
        context.save();
        // The on-screen camera is mirrored (selfie view); match it.
        context.translate(width, 0);
        context.scale(-1, 1);
        context.drawImage(video, width - fit.x - fit.width, fit.y, fit.width, fit.height);
        context.restore();
      } else {
        context.drawImage(video, fit.x, fit.y, fit.width, fit.height);
      }
      const scrim = Math.min(1, Math.max(0, input.getScrimOpacity()));
      if (scrim > 0) {
        context.fillStyle = `rgba(5, 8, 12, ${scrim})`;
        context.fillRect(0, 0, width, height);
      }
    }

    context.drawImage(input.boardCanvas, 0, 0, width, height);
    requestAnimationFrame(drawFrame);
  };
  requestAnimationFrame(drawFrame);

  const stream = stage.captureStream(frameRate);

  // Microphone is best-effort: a denied prompt records video-only.
  let hasAudio = false;
  let micStream: MediaStream | null = null;
  const getUserMedia =
    input.getUserMedia ??
    (typeof navigator !== "undefined" && navigator.mediaDevices
      ? navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices)
      : null);
  if (getUserMedia) {
    try {
      micStream = await getUserMedia({ audio: true, video: false });
      for (const track of micStream.getAudioTracks()) {
        stream.addTrack(track);
        hasAudio = true;
      }
    } catch {
      micStream = null;
    }
  }

  const mimeType = MIME_PREFERENCES.find((candidate) =>
    MediaRecorder.isTypeSupported(candidate),
  );
  const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
  const chunks: Blob[] = [];
  recorder.ondataavailable = (event) => {
    if (event.data.size > 0) {
      chunks.push(event.data);
    }
  };
  recorder.start(1000);

  return {
    hasAudio,
    stop() {
      return new Promise<Blob>((resolve) => {
        recorder.onstop = () => {
          stopped = true;
          stream.getTracks().forEach((track) => track.stop());
          micStream?.getTracks().forEach((track) => track.stop());
          resolve(new Blob(chunks, { type: recorder.mimeType || "video/webm" }));
        };
        recorder.stop();
      });
    },
  };
}
