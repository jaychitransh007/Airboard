import type {
  DetectedHand,
  Handedness,
  HandLandmark,
  MediaPipeCannedGesture,
  MediaPipeCannedGestureName,
} from "./types.ts";

export type MediaPipeHandTrackerOptions = {
  wasmBaseUrl?: string;
  modelAssetPath?: string;
  numHands?: number;
  minHandDetectionConfidence?: number;
  minHandPresenceConfidence?: number;
  minTrackingConfidence?: number;
};

export class MediaPipeHandTracker {
  private readonly gestureRecognizer: any;

  private constructor(gestureRecognizer: any) {
    this.gestureRecognizer = gestureRecognizer;
  }

  static async create(options: MediaPipeHandTrackerOptions = {}): Promise<MediaPipeHandTracker> {
    installMediaPipeConsoleFilter();
    const { FilesetResolver, GestureRecognizer } = await import("@mediapipe/tasks-vision");
    const vision = await FilesetResolver.forVisionTasks(
      options.wasmBaseUrl ?? "/vendor/mediapipe/wasm",
    );
    const gestureRecognizer = await GestureRecognizer.createFromOptions(vision, {
      baseOptions: {
        modelAssetPath:
          options.modelAssetPath ?? "/vendor/mediapipe/models/gesture_recognizer.task",
      },
      runningMode: "VIDEO",
      numHands: options.numHands ?? 2,
      minHandDetectionConfidence: options.minHandDetectionConfidence ?? 0.5,
      minHandPresenceConfidence: options.minHandPresenceConfidence ?? 0.5,
      minTrackingConfidence: options.minTrackingConfidence ?? 0.6,
      cannedGesturesClassifierOptions: {
        categoryAllowlist: ["Victory", "Open_Palm"],
        maxResults: 1,
        scoreThreshold: 0.5,
      },
    });

    return new MediaPipeHandTracker(gestureRecognizer);
  }

  detect(video: HTMLVideoElement, timestampMs: number): DetectedHand[] {
    installMediaPipeConsoleFilter();
    const result = this.gestureRecognizer.recognizeForVideo(video, timestampMs);
    const landmarks = (result.landmarks ?? []) as HandLandmark[][];
    const worldLandmarks = (result.worldLandmarks ?? []) as HandLandmark[][];
    const handednesses = (result.handednesses ?? result.handedness ?? []) as any[][];
    const gestures = (result.gestures ?? []) as any[][];

    return landmarks.map((handLandmarks, index) => {
      const category = handednesses[index]?.[0];
      const cannedGesture = normalizeMediaPipeCannedGesture(gestures[index]?.[0]);
      const detectedHand: DetectedHand = {
        handedness: normalizeHandedness(category?.categoryName),
        handednessScore: Number(category?.score ?? 0),
        landmarks: handLandmarks,
        ...(cannedGesture ? { cannedGesture } : {}),
      };
      const detectedWorldLandmarks = worldLandmarks[index];
      return detectedWorldLandmarks
        ? { ...detectedHand, worldLandmarks: detectedWorldLandmarks }
        : detectedHand;
    });
  }

  close(): void {
    this.gestureRecognizer.close?.();
  }
}

function normalizeHandedness(value: unknown): Handedness {
  return String(value).toLowerCase() === "left" ? "left" : "right";
}

const AIRBOARD_CANNED_GESTURES = new Set<MediaPipeCannedGestureName>([
  "Open_Palm",
  "Victory",
]);

export function normalizeMediaPipeCannedGesture(
  category: unknown,
): MediaPipeCannedGesture | null {
  if (!category || typeof category !== "object") {
    return null;
  }
  const candidate = category as { categoryName?: unknown; score?: unknown };
  const rawName = String(candidate.categoryName ?? "");
  if (!rawName) {
    return null;
  }
  if (!AIRBOARD_CANNED_GESTURES.has(rawName as MediaPipeCannedGestureName)) {
    return null;
  }
  const name = rawName as MediaPipeCannedGestureName;
  const rawScore = Number(candidate.score ?? 0);
  return {
    name,
    score: Number.isFinite(rawScore) ? Math.min(1, Math.max(0, rawScore)) : 0,
  };
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
