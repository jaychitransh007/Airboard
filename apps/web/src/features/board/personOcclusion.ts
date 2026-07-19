import { fitSourceToCanvas } from "@airboard/gesture-engine";
import type { ImageSegmenter, MPMask } from "@mediapipe/tasks-vision";

export const PERSON_SEGMENTER_MODEL_PATH =
  "/vendor/mediapipe/models/selfie_segmenter_landscape.tflite";

export type PersonMaskTuning = {
  lowConfidence: number;
  highConfidence: number;
};

export const DEFAULT_PERSON_MASK_TUNING: PersonMaskTuning = {
  lowConfidence: 0.28,
  highConfidence: 0.72,
};

export function personMaskAlpha(
  confidence: number,
  tuning: PersonMaskTuning = DEFAULT_PERSON_MASK_TUNING,
): number {
  const low = Math.min(tuning.lowConfidence, tuning.highConfidence);
  const high = Math.max(low + 0.001, tuning.highConfidence);
  const normalized = Math.min(1, Math.max(0, (confidence - low) / (high - low)));
  // Smoothstep feathers hair and shoulder boundaries without leaving neon
  // fully visible through mid-confidence foreground pixels.
  const smoothed = normalized * normalized * (3 - 2 * normalized);
  return Math.round(smoothed * 255);
}

export class MediaPipePersonSegmenter {
  private readonly segmenter: ImageSegmenter;

  private constructor(segmenter: ImageSegmenter) {
    this.segmenter = segmenter;
  }

  static async create(options: {
    wasmBaseUrl?: string;
    modelAssetPath?: string;
  } = {}): Promise<MediaPipePersonSegmenter> {
    const { FilesetResolver, ImageSegmenter } = await import("@mediapipe/tasks-vision");
    const vision = await FilesetResolver.forVisionTasks(
      options.wasmBaseUrl ?? "/vendor/mediapipe/wasm",
    );
    const segmenter = await ImageSegmenter.createFromOptions(vision, {
      baseOptions: {
        modelAssetPath: options.modelAssetPath ?? PERSON_SEGMENTER_MODEL_PATH,
      },
      runningMode: "VIDEO",
      outputConfidenceMasks: true,
      outputCategoryMask: false,
    });
    return new MediaPipePersonSegmenter(segmenter);
  }

  segment(
    video: HTMLVideoElement,
    timestampMs: number,
    onMask: (mask: MPMask) => void,
  ): void {
    this.segmenter.segmentForVideo(video, timestampMs, (result) => {
      const mask = result.confidenceMasks?.[0];
      if (mask) {
        onMask(mask);
      }
    });
  }

  close(): void {
    this.segmenter.close();
  }
}

export function updatePersonMaskCanvas(
  canvas: HTMLCanvasElement,
  mask: Pick<MPMask, "width" | "height" | "getAsFloat32Array">,
  tuning: PersonMaskTuning = DEFAULT_PERSON_MASK_TUNING,
): void {
  if (canvas.width !== mask.width || canvas.height !== mask.height) {
    canvas.width = mask.width;
    canvas.height = mask.height;
  }
  const context = canvas.getContext("2d");
  if (!context) {
    return;
  }
  const confidence = mask.getAsFloat32Array();
  const image = context.createImageData(mask.width, mask.height);
  for (let pixel = 0; pixel < confidence.length; pixel += 1) {
    const offset = pixel * 4;
    image.data[offset] = 255;
    image.data[offset + 1] = 255;
    image.data[offset + 2] = 255;
    image.data[offset + 3] = personMaskAlpha(confidence[pixel] ?? 0, tuning);
  }
  context.putImageData(image, 0, 0);
}

function resizeCanvasToCssSize(canvas: HTMLCanvasElement): {
  width: number;
  height: number;
} {
  const rect = canvas.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  const width = Math.max(1, Math.floor(rect.width * dpr));
  const height = Math.max(1, Math.floor(rect.height * dpr));
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }
  return { width, height };
}

function drawCover(
  context: CanvasRenderingContext2D,
  source: CanvasImageSource,
  sourceWidth: number,
  sourceHeight: number,
  targetWidth: number,
  targetHeight: number,
  mirror: boolean,
): void {
  const fit = fitSourceToCanvas(
    sourceWidth,
    sourceHeight,
    targetWidth,
    targetHeight,
    "cover",
  );
  context.save();
  if (mirror) {
    context.translate(targetWidth, 0);
    context.scale(-1, 1);
    context.drawImage(source, targetWidth - fit.x - fit.width, fit.y, fit.width, fit.height);
  } else {
    context.drawImage(source, fit.x, fit.y, fit.width, fit.height);
  }
  context.restore();
}

/** Draws undimmed camera pixels for the segmented person above neon ink. */
export function renderPersonForeground(input: {
  targetCanvas: HTMLCanvasElement;
  maskCanvas: HTMLCanvasElement;
  video: HTMLVideoElement;
}): void {
  const { width, height } = resizeCanvasToCssSize(input.targetCanvas);
  const context = input.targetCanvas.getContext("2d");
  if (!context || input.video.videoWidth <= 0 || input.maskCanvas.width <= 0) {
    return;
  }
  context.clearRect(0, 0, width, height);
  drawCover(
    context,
    input.video,
    input.video.videoWidth,
    input.video.videoHeight,
    width,
    height,
    true,
  );
  context.globalCompositeOperation = "destination-in";
  drawCover(
    context,
    input.maskCanvas,
    input.video.videoWidth,
    input.video.videoHeight,
    width,
    height,
    true,
  );
  context.globalCompositeOperation = "source-over";
}

/**
 * Produces a transparent board frame with person pixels cut out. The Meet
 * compositor supplies the camera below it, so this gives the outgoing stream
 * the same behind-the-presenter depth ordering as the standalone DOM stage.
 */
export function renderBoardBehindPerson(input: {
  targetCanvas: HTMLCanvasElement;
  boardCanvas: HTMLCanvasElement;
  maskCanvas: HTMLCanvasElement | null;
  videoWidth: number;
  videoHeight: number;
}): HTMLCanvasElement {
  const width = input.boardCanvas.width;
  const height = input.boardCanvas.height;
  if (input.targetCanvas.width !== width || input.targetCanvas.height !== height) {
    input.targetCanvas.width = width;
    input.targetCanvas.height = height;
  }
  const context = input.targetCanvas.getContext("2d");
  if (!context) {
    return input.boardCanvas;
  }
  context.clearRect(0, 0, width, height);
  context.drawImage(input.boardCanvas, 0, 0, width, height);
  if (
    input.maskCanvas &&
    input.maskCanvas.width > 0 &&
    input.videoWidth > 0 &&
    input.videoHeight > 0
  ) {
    context.globalCompositeOperation = "destination-out";
    drawCover(
      context,
      input.maskCanvas,
      input.videoWidth,
      input.videoHeight,
      width,
      height,
      true,
    );
    context.globalCompositeOperation = "source-over";
  }
  return input.targetCanvas;
}
