import type { CanvasMapping, CursorPoint, HandLandmark } from "./types.ts";

export type CanvasFitRect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export function fitSourceToCanvas(
  sourceWidth: number,
  sourceHeight: number,
  canvasWidth: number,
  canvasHeight: number,
  fitMode: NonNullable<CanvasMapping["fitMode"]>,
): CanvasFitRect {
  if (
    fitMode === "stretch" ||
    sourceWidth <= 0 ||
    sourceHeight <= 0 ||
    canvasWidth <= 0 ||
    canvasHeight <= 0
  ) {
    return { x: 0, y: 0, width: canvasWidth, height: canvasHeight };
  }
  const scale =
    fitMode === "cover"
      ? Math.max(canvasWidth / sourceWidth, canvasHeight / sourceHeight)
      : Math.min(canvasWidth / sourceWidth, canvasHeight / sourceHeight);
  const width = sourceWidth * scale;
  const height = sourceHeight * scale;
  return {
    x: (canvasWidth - width) / 2,
    y: (canvasHeight - height) / 2,
    width,
    height,
  };
}

/** Maps a normalized source point into the fitted, unmirrored canvas plane. */
export function mapLandmarkToFittedCanvas(
  landmark: Pick<HandLandmark, "x" | "y">,
  mapping: CanvasMapping,
): { x: number; y: number } {
  const fit = fitSourceToCanvas(
    mapping.sourceWidth ?? mapping.canvasWidth,
    mapping.sourceHeight ?? mapping.canvasHeight,
    mapping.canvasWidth,
    mapping.canvasHeight,
    mapping.fitMode ?? "stretch",
  );
  return {
    x: fit.x + landmark.x * fit.width,
    y: fit.y + landmark.y * fit.height,
  };
}

export function mapLandmarkToCanvas(
  landmark: HandLandmark,
  mapping: CanvasMapping,
  timestampMs: number,
): CursorPoint {
  const fitted = mapLandmarkToFittedCanvas(landmark, mapping);
  const visibleX = mapping.mirrorInput ? mapping.canvasWidth - fitted.x : fitted.x;
  const centeredX =
    (visibleX - mapping.canvasWidth / 2) * mapping.sensitivity + mapping.canvasWidth / 2;
  const centeredY =
    (fitted.y - mapping.canvasHeight / 2) * mapping.sensitivity + mapping.canvasHeight / 2;

  return {
    x: clampCanvas(centeredX, mapping.canvasWidth),
    y: clampCanvas(centeredY, mapping.canvasHeight),
    t: timestampMs,
  };
}

function clampCanvas(value: number, max: number): number {
  return Math.max(0, Math.min(max, value));
}
