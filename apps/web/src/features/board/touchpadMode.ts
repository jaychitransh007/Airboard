import type { StrokePoint } from "@airboard/core";

export type AirboardInputMode = "touchpad" | "gesture";

export type TouchpadModeVariant = "simple" | "presenter" | "precision";

export type TouchpadTool = "marker" | "eraser";

export type TouchpadInputState =
  | "IDLE"
  | "HOVER"
  | "DRAWING"
  | "ERASING"
  | "PANNING"
  | "PAUSED";

export type TouchpadModeConfig = {
  stroke: {
    minPointDistancePx: number;
    minStrokeDurationMs: number;
    minStrokePoints: number;
    defaultThickness: number;
    defaultColor: string;
  };
  smoothing: {
    liveSmoothingEnabled: boolean;
    liveSmoothingAlpha: number;
    postSmoothingEnabled: boolean;
    simplificationTolerancePx: number;
  };
  eraser: {
    defaultRadiusPx: number;
    strokeLevelErase: boolean;
  };
  cleanup: {
    lineSnapEnabled: boolean;
    lineSnapErrorThresholdPx: number;
  };
};

export type FinalizedTouchpadStroke = {
  points: StrokePoint[];
  discard: boolean;
  cleanupApplied: boolean;
  lineSnapApplied: boolean;
};

const defaultTouchpadModeConfig: TouchpadModeConfig = {
  stroke: {
    minPointDistancePx: 1.5,
    minStrokeDurationMs: 50,
    minStrokePoints: 2,
    defaultThickness: 3,
    defaultColor: "#111827",
  },
  smoothing: {
    liveSmoothingEnabled: true,
    liveSmoothingAlpha: 0.72,
    postSmoothingEnabled: true,
    simplificationTolerancePx: 2,
  },
  eraser: {
    defaultRadiusPx: 28,
    strokeLevelErase: true,
  },
  cleanup: {
    lineSnapEnabled: true,
    lineSnapErrorThresholdPx: 6,
  },
};

type PointerLikeEvent = {
  clientX: number;
  clientY: number;
  pressure: number;
  pointerType: string;
};

export function getTouchpadModeConfig(
  variant: TouchpadModeVariant,
  overrides: {
    color: string;
    thickness: number;
    eraserRadius: number;
  },
): TouchpadModeConfig {
  const config = cloneConfig(defaultTouchpadModeConfig);
  config.stroke.defaultColor = overrides.color;
  config.stroke.defaultThickness = overrides.thickness;
  config.eraser.defaultRadiusPx = overrides.eraserRadius;

  if (variant === "presenter") {
    config.stroke.defaultThickness = Math.max(overrides.thickness, 4);
    config.smoothing.liveSmoothingAlpha = 0.66;
    config.smoothing.simplificationTolerancePx = 2.4;
    config.cleanup.lineSnapErrorThresholdPx = 8;
  }

  if (variant === "precision") {
    config.stroke.minPointDistancePx = 1;
    config.stroke.defaultThickness = Math.min(overrides.thickness, 3);
    config.smoothing.liveSmoothingAlpha = 0.58;
    config.smoothing.simplificationTolerancePx = 1.4;
    config.cleanup.lineSnapErrorThresholdPx = 5;
  }

  return config;
}

export function normalizePointerEvent(
  event: PointerLikeEvent,
  canvas: HTMLCanvasElement,
): StrokePoint {
  const rect = canvas.getBoundingClientRect();
  const x = clamp(event.clientX - rect.left, 0, rect.width);
  const y = clamp(event.clientY - rect.top, 0, rect.height);
  const pointerType = normalizePointerType(event.pointerType);
  const point: StrokePoint = {
    x,
    y,
    t: performance.now(),
    pressure: event.pressure || 0.5,
    pointerType,
    rawX: event.clientX,
    rawY: event.clientY,
    inputSource: "touchpad",
  };
  return point;
}

export function shouldAddTouchpadPoint(
  previousPoint: StrokePoint | null,
  nextPoint: StrokePoint,
  minPointDistancePx: number,
): boolean {
  return !previousPoint || distance(previousPoint, nextPoint) >= minPointDistancePx;
}

export function smoothLiveTouchpadPoint(
  previousPoint: StrokePoint | null,
  nextPoint: StrokePoint,
  config: TouchpadModeConfig,
): StrokePoint {
  if (!previousPoint || !config.smoothing.liveSmoothingEnabled) {
    return nextPoint;
  }

  const alpha = config.smoothing.liveSmoothingAlpha;
  return {
    ...nextPoint,
    x: previousPoint.x + (nextPoint.x - previousPoint.x) * alpha,
    y: previousPoint.y + (nextPoint.y - previousPoint.y) * alpha,
  };
}

export function finalizeTouchpadStroke(input: {
  points: readonly StrokePoint[];
  config: TouchpadModeConfig;
  straightLine: boolean;
}): FinalizedTouchpadStroke {
  const deduped = removeDuplicatePoints(input.points);
  const durationMs = getStrokeDurationMs(deduped);
  const discard =
    deduped.length < input.config.stroke.minStrokePoints ||
    durationMs < input.config.stroke.minStrokeDurationMs;

  if (discard) {
    return {
      points: deduped,
      discard: true,
      cleanupApplied: false,
      lineSnapApplied: false,
    };
  }

  if (input.straightLine) {
    const firstPoint = deduped[0];
    const lastPoint = deduped[deduped.length - 1];
    return {
      points: firstPoint && lastPoint ? [firstPoint, lastPoint] : deduped,
      discard: false,
      cleanupApplied: true,
      lineSnapApplied: true,
    };
  }

  if (!input.config.smoothing.postSmoothingEnabled) {
    return {
      points: deduped,
      discard: false,
      cleanupApplied: false,
      lineSnapApplied: false,
    };
  }

  const simplified = simplifyPoints(deduped, input.config.smoothing.simplificationTolerancePx);
  if (
    input.config.cleanup.lineSnapEnabled &&
    shouldSnapToLine(simplified, input.config.cleanup.lineSnapErrorThresholdPx)
  ) {
    const firstPoint = simplified[0];
    const lastPoint = simplified[simplified.length - 1];
    return {
      points: firstPoint && lastPoint ? [firstPoint, lastPoint] : simplified,
      discard: false,
      cleanupApplied: true,
      lineSnapApplied: true,
    };
  }

  const smoothed = smoothFinalPoints(simplified);
  return {
    points: smoothed,
    discard: false,
    cleanupApplied: smoothed.length !== deduped.length || simplified.length !== deduped.length,
    lineSnapApplied: false,
  };
}

function cloneConfig(config: TouchpadModeConfig): TouchpadModeConfig {
  return {
    stroke: { ...config.stroke },
    smoothing: { ...config.smoothing },
    eraser: { ...config.eraser },
    cleanup: { ...config.cleanup },
  };
}

function normalizePointerType(pointerType: string): NonNullable<StrokePoint["pointerType"]> {
  if (pointerType === "pen" || pointerType === "touch") {
    return pointerType;
  }
  return "mouse";
}

function removeDuplicatePoints(points: readonly StrokePoint[]): StrokePoint[] {
  const result: StrokePoint[] = [];
  for (const point of points) {
    const previousPoint = result[result.length - 1];
    if (!previousPoint || distance(previousPoint, point) >= 0.5) {
      result.push(point);
    }
  }
  return result;
}

function getStrokeDurationMs(points: readonly StrokePoint[]): number {
  const firstPoint = points[0];
  const lastPoint = points[points.length - 1];
  return firstPoint && lastPoint ? Math.max(0, lastPoint.t - firstPoint.t) : 0;
}

function simplifyPoints(points: readonly StrokePoint[], tolerancePx: number): StrokePoint[] {
  if (points.length <= 2) {
    return [...points];
  }

  const firstPoint = points[0];
  const lastPoint = points[points.length - 1];
  if (!firstPoint || !lastPoint) {
    return [...points];
  }

  let maxDistance = 0;
  let maxIndex = 0;
  for (let index = 1; index < points.length - 1; index += 1) {
    const point = points[index];
    if (!point) {
      continue;
    }
    const pointDistance = distanceFromLine(point, firstPoint, lastPoint);
    if (pointDistance > maxDistance) {
      maxDistance = pointDistance;
      maxIndex = index;
    }
  }

  if (maxDistance <= tolerancePx) {
    return [firstPoint, lastPoint];
  }

  const left = simplifyPoints(points.slice(0, maxIndex + 1), tolerancePx);
  const right = simplifyPoints(points.slice(maxIndex), tolerancePx);
  return [...left.slice(0, -1), ...right];
}

function smoothFinalPoints(points: readonly StrokePoint[]): StrokePoint[] {
  if (points.length <= 2) {
    return [...points];
  }

  return points.map((point, index) => {
    const previousPoint = points[index - 1];
    const nextPoint = points[index + 1];
    if (!previousPoint || !nextPoint) {
      return point;
    }
    return {
      ...point,
      x: previousPoint.x * 0.2 + point.x * 0.6 + nextPoint.x * 0.2,
      y: previousPoint.y * 0.2 + point.y * 0.6 + nextPoint.y * 0.2,
    };
  });
}

function shouldSnapToLine(points: readonly StrokePoint[], errorThresholdPx: number): boolean {
  if (points.length < 3) {
    return false;
  }

  const firstPoint = points[0];
  const lastPoint = points[points.length - 1];
  if (!firstPoint || !lastPoint || distance(firstPoint, lastPoint) < 30) {
    return false;
  }

  const averageError =
    points.reduce((sum, point) => sum + distanceFromLine(point, firstPoint, lastPoint), 0) /
    points.length;
  return averageError <= errorThresholdPx;
}

function distanceFromLine(
  point: Pick<StrokePoint, "x" | "y">,
  start: Pick<StrokePoint, "x" | "y">,
  end: Pick<StrokePoint, "x" | "y">,
): number {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared === 0) {
    return distance(point, start);
  }

  const projection = ((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSquared;
  const clampedProjection = clamp(projection, 0, 1);
  return distance(point, {
    x: start.x + clampedProjection * dx,
    y: start.y + clampedProjection * dy,
  });
}

function distance(a: Pick<StrokePoint, "x" | "y">, b: Pick<StrokePoint, "x" | "y">): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
