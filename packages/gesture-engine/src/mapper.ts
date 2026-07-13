import type { CanvasMapping, CursorPoint, HandLandmark } from "./types.ts";

export function mapLandmarkToCanvas(
  landmark: HandLandmark,
  mapping: CanvasMapping,
  timestampMs: number,
): CursorPoint {
  const normalizedX = mapping.mirrorInput ? 1 - landmark.x : landmark.x;
  const centeredX = (normalizedX - 0.5) * mapping.sensitivity + 0.5;
  const centeredY = (landmark.y - 0.5) * mapping.sensitivity + 0.5;

  return {
    x: clampCanvas(centeredX * mapping.canvasWidth, mapping.canvasWidth),
    y: clampCanvas(centeredY * mapping.canvasHeight, mapping.canvasHeight),
    t: timestampMs,
  };
}

function clampCanvas(value: number, max: number): number {
  return Math.max(0, Math.min(max, value));
}
