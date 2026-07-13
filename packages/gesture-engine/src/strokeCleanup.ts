import type { FrictionStrokePoint, VirtualSurfaceFrictionConfig } from "./types";

export type StrokeCleanupResult = {
  points: FrictionStrokePoint[];
  discard: boolean;
  cleanupApplied: boolean;
  lineSnapApplied: boolean;
};

export function cleanupStrokePoints(
  points: readonly FrictionStrokePoint[],
  config: VirtualSurfaceFrictionConfig,
): StrokeCleanupResult {
  const withoutDuplicates = removeDuplicatePoints(points);
  const durationMs = getStrokeDurationMs(withoutDuplicates);
  const discard =
    withoutDuplicates.length < config.minStrokePoints || durationMs < config.minStrokeDurationMs;

  if (discard) {
    return {
      points: withoutDuplicates,
      discard: true,
      cleanupApplied: false,
      lineSnapApplied: false,
    };
  }

  if (!config.enablePostStrokeSmoothing) {
    return {
      points: withoutDuplicates,
      discard: false,
      cleanupApplied: false,
      lineSnapApplied: false,
    };
  }

  const simplified = ramerDouglasPeucker(withoutDuplicates, config.rdpTolerancePx);
  if (config.enableLineSnap && shouldSnapToLine(simplified, config.lineSnapErrorThresholdPx)) {
    const firstPoint = simplified[0];
    const lastPoint = simplified[simplified.length - 1];
    return {
      points: firstPoint && lastPoint ? [firstPoint, lastPoint] : simplified,
      discard: false,
      cleanupApplied: true,
      lineSnapApplied: true,
    };
  }

  const smoothed = applyChaikinSmoothing(simplified, config.chaikinPasses);
  return {
    points: smoothed,
    discard: false,
    cleanupApplied: smoothed.length !== withoutDuplicates.length || simplified.length !== withoutDuplicates.length,
    lineSnapApplied: false,
  };
}

function removeDuplicatePoints(points: readonly FrictionStrokePoint[]): FrictionStrokePoint[] {
  const result: FrictionStrokePoint[] = [];
  for (const point of points) {
    const previous = result[result.length - 1];
    if (!previous || distance(previous, point) >= 0.5) {
      result.push(point);
    }
  }
  return result;
}

function getStrokeDurationMs(points: readonly FrictionStrokePoint[]): number {
  const firstPoint = points[0];
  const lastPoint = points[points.length - 1];
  return firstPoint && lastPoint ? Math.max(0, lastPoint.t - firstPoint.t) : 0;
}

function ramerDouglasPeucker(
  points: readonly FrictionStrokePoint[],
  tolerancePx: number,
): FrictionStrokePoint[] {
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

  const left = ramerDouglasPeucker(points.slice(0, maxIndex + 1), tolerancePx);
  const right = ramerDouglasPeucker(points.slice(maxIndex), tolerancePx);
  return [...left.slice(0, -1), ...right];
}

function shouldSnapToLine(points: readonly FrictionStrokePoint[], errorThresholdPx: number): boolean {
  if (points.length < 3) {
    return false;
  }

  const firstPoint = points[0];
  const lastPoint = points[points.length - 1];
  if (!firstPoint || !lastPoint || distance(firstPoint, lastPoint) < 24) {
    return false;
  }

  const averageError =
    points.reduce((sum, point) => sum + distanceFromLine(point, firstPoint, lastPoint), 0) /
    points.length;
  return averageError <= errorThresholdPx;
}

function applyChaikinSmoothing(
  points: readonly FrictionStrokePoint[],
  passes: number,
): FrictionStrokePoint[] {
  let current = [...points];
  for (let pass = 0; pass < passes; pass += 1) {
    if (current.length <= 2) {
      return current;
    }

    const next: FrictionStrokePoint[] = [];
    const firstPoint = current[0];
    const lastPoint = current[current.length - 1];
    if (firstPoint) {
      next.push(firstPoint);
    }

    for (let index = 0; index < current.length - 1; index += 1) {
      const start = current[index];
      const end = current[index + 1];
      if (!start || !end) {
        continue;
      }
      next.push(interpolatePoint(start, end, 0.25));
      next.push(interpolatePoint(start, end, 0.75));
    }

    if (lastPoint) {
      next.push(lastPoint);
    }
    current = next;
  }
  return current;
}

function interpolatePoint(
  start: FrictionStrokePoint,
  end: FrictionStrokePoint,
  amount: number,
): FrictionStrokePoint {
  const point: FrictionStrokePoint = {
    x: interpolate(start.x, end.x, amount),
    y: interpolate(start.y, end.y, amount),
    t: interpolate(start.t, end.t, amount),
  };
  setOptional(point, "rawX", interpolateOptional(start.rawX, end.rawX, amount));
  setOptional(point, "rawY", interpolateOptional(start.rawY, end.rawY, amount));
  setOptional(point, "rawTipX", interpolateOptional(start.rawTipX, end.rawTipX, amount));
  setOptional(point, "rawTipY", interpolateOptional(start.rawTipY, end.rawTipY, amount));
  setOptional(point, "confidence", interpolateOptional(start.confidence, end.confidence, amount));
  setOptional(
    point,
    "handSpeedPxPerSec",
    interpolateOptional(start.handSpeedPxPerSec, end.handSpeedPxPerSec, amount),
  );
  setOptional(
    point,
    "gestureConfidence",
    interpolateOptional(start.gestureConfidence, end.gestureConfidence, amount),
  );
  setOptional(
    point,
    "gripConfidence",
    interpolateOptional(start.gripConfidence, end.gripConfidence, amount),
  );
  setOptional(
    point,
    "tipConfidence",
    interpolateOptional(start.tipConfidence, end.tipConfidence, amount),
  );
  setOptional(
    point,
    "contactScore",
    interpolateOptional(start.contactScore, end.contactScore, amount),
  );
  setOptional(
    point,
    "frictionGain",
    interpolateOptional(start.frictionGain, end.frictionGain, amount),
  );
  setOptional(point, "inputSource", start.inputSource ?? end.inputSource);
  setOptional(point, "trackingSource", start.trackingSource ?? end.trackingSource);
  return point;
}

function setOptional<TKey extends keyof FrictionStrokePoint>(
  point: FrictionStrokePoint,
  key: TKey,
  value: FrictionStrokePoint[TKey] | undefined,
): void {
  if (value !== undefined) {
    point[key] = value;
  }
}

function interpolate(start: number, end: number, amount: number): number {
  return start + (end - start) * amount;
}

function interpolateOptional(
  start: number | undefined,
  end: number | undefined,
  amount: number,
): number | undefined {
  if (start === undefined || end === undefined) {
    return start ?? end;
  }
  return interpolate(start, end, amount);
}

function distance(a: Pick<FrictionStrokePoint, "x" | "y">, b: Pick<FrictionStrokePoint, "x" | "y">): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function distanceFromLine(
  point: Pick<FrictionStrokePoint, "x" | "y">,
  start: Pick<FrictionStrokePoint, "x" | "y">,
  end: Pick<FrictionStrokePoint, "x" | "y">,
): number {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared === 0) {
    return distance(point, start);
  }

  const projection = ((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSquared;
  const clampedProjection = Math.max(0, Math.min(1, projection));
  return distance(point, {
    x: start.x + clampedProjection * dx,
    y: start.y + clampedProjection * dy,
  });
}
