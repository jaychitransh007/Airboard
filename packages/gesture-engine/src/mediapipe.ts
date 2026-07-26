import type { DetectedHand, Handedness, HandLandmark } from "./types.ts";

export type MediaPipeHandTrackerOptions = {
  wasmBaseUrl?: string;
  modelAssetPath?: string;
  numHands?: number;
  minHandDetectionConfidence?: number;
  minHandPresenceConfidence?: number;
  minTrackingConfidence?: number;
  /** Test seam; production always uses the dynamically imported MediaPipe task. */
  runtime?: MediaPipeHandTrackerRuntime;
};

export type MediaPipeHandTrackerRuntime = {
  FilesetResolver: {
    forVisionTasks(baseUrl: string): Promise<unknown>;
  };
  HandLandmarker: {
    createFromOptions(
      vision: unknown,
      options: Record<string, unknown>,
    ): Promise<unknown>;
  };
};

export class MediaPipeHandTracker {
  private readonly handLandmarker: any;

  private constructor(handLandmarker: any) {
    this.handLandmarker = handLandmarker;
  }

  static async create(options: MediaPipeHandTrackerOptions = {}): Promise<MediaPipeHandTracker> {
    installMediaPipeConsoleFilter();
    const runtime =
      options.runtime ??
      ((await import("@mediapipe/tasks-vision")) as unknown as MediaPipeHandTrackerRuntime);
    const { FilesetResolver, HandLandmarker } = runtime;
    const vision = await FilesetResolver.forVisionTasks(
      options.wasmBaseUrl ?? "/vendor/mediapipe/wasm",
    );
    const handLandmarker = await HandLandmarker.createFromOptions(vision, {
      baseOptions: {
        modelAssetPath: options.modelAssetPath ?? "/vendor/mediapipe/models/hand_landmarker.task",
      },
      runningMode: "VIDEO",
      numHands: options.numHands ?? 2,
      minHandDetectionConfidence: options.minHandDetectionConfidence ?? 0.5,
      minHandPresenceConfidence: options.minHandPresenceConfidence ?? 0.5,
      minTrackingConfidence: options.minTrackingConfidence ?? 0.6,
    });

    return new MediaPipeHandTracker(handLandmarker);
  }

  detect(video: HTMLVideoElement, timestampMs: number): DetectedHand[] {
    installMediaPipeConsoleFilter();
    const result = this.handLandmarker.detectForVideo(video, timestampMs);
    const landmarks = (result.landmarks ?? []) as HandLandmark[][];
    const worldLandmarks = (result.worldLandmarks ?? []) as HandLandmark[][];
    const handednesses = (result.handednesses ?? result.handedness ?? []) as any[][];

    return landmarks.map((handLandmarks, index) => {
      const category = handednesses[index]?.[0];
      const detectedHand: DetectedHand = {
        handedness: normalizeHandedness(category?.categoryName),
        handednessScore: Number(category?.score ?? 0),
        landmarks: handLandmarks,
      };
      const detectedWorldLandmarks = worldLandmarks[index];
      return detectedWorldLandmarks
        ? { ...detectedHand, worldLandmarks: detectedWorldLandmarks }
        : detectedHand;
    });
  }

  close(): void {
    this.handLandmarker.close?.();
  }
}

function normalizeHandedness(value: unknown): Handedness {
  return String(value).toLowerCase() === "left" ? "left" : "right";
}

const MEDIA_PIPE_INFO_MESSAGE = "INFO: Created TensorFlow Lite XNNPACK delegate for CPU";
const MEDIA_PIPE_CONSOLE_FILTER_FLAG = "__airboardMediaPipeConsoleFilterInstalled";

function installMediaPipeConsoleFilter(): void {
  const globalScope = globalThis as typeof globalThis & {
    [MEDIA_PIPE_CONSOLE_FILTER_FLAG]?: boolean;
  };
  if (globalScope[MEDIA_PIPE_CONSOLE_FILTER_FLAG]) {
    return;
  }

  const originalInfo = console.info.bind(console);
  const originalError = console.error.bind(console);

  console.info = (...args: unknown[]) => {
    if (isBenignMediaPipeInfo(args)) {
      return;
    }
    originalInfo(...args);
  };
  console.error = (...args: unknown[]) => {
    if (isBenignMediaPipeInfo(args)) {
      return;
    }
    originalError(...args);
  };

  globalScope[MEDIA_PIPE_CONSOLE_FILTER_FLAG] = true;
}

function isBenignMediaPipeInfo(args: readonly unknown[]): boolean {
  return args.some((arg) =>
    String(arg).includes(MEDIA_PIPE_INFO_MESSAGE),
  );
}
