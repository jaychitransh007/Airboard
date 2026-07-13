import { OneEuroFilter } from "./oneEuroFilter";
import type { CursorPoint, GestureConfig, SmoothedPoint } from "./types";

export class GestureSmoother {
  private readonly xFilter = new OneEuroFilter();
  private readonly yFilter = new OneEuroFilter();
  private lastSmoothedPoint: SmoothedPoint | null = null;

  reset(): void {
    this.xFilter.reset();
    this.yFilter.reset();
    this.lastSmoothedPoint = null;
  }

  smooth(input: {
    point: CursorPoint;
    confidence: number;
    config: GestureConfig;
    gestureJustChanged: boolean;
  }): SmoothedPoint {
    const { point, config } = input;
    const rawX = point.x;
    const rawY = point.y;
    const filteredX = this.xFilter.filter(rawX, point.t);
    const filteredY = this.yFilter.filter(rawY, point.t);
    const filteredPoint: SmoothedPoint = {
      x: filteredX,
      y: filteredY,
      t: point.t,
      rawX,
      rawY,
      predicted: false,
    };

    if (!this.lastSmoothedPoint) {
      this.lastSmoothedPoint = filteredPoint;
      return filteredPoint;
    }

    const dx = filteredPoint.x - this.lastSmoothedPoint.x;
    const dy = filteredPoint.y - this.lastSmoothedPoint.y;
    const movementPx = Math.hypot(dx, dy);
    if (movementPx < config.deadZonePx) {
      const stablePoint = {
        ...filteredPoint,
        x: this.lastSmoothedPoint.x,
        y: this.lastSmoothedPoint.y,
      };
      this.lastSmoothedPoint = stablePoint;
      return stablePoint;
    }

    const shouldPredict =
      input.confidence >= 0.8 &&
      !input.gestureJustChanged &&
      movementPx >= config.deadZonePx * 2 &&
      !hasSharpDirectionChange(this.lastSmoothedPoint, filteredPoint);

    if (!shouldPredict) {
      this.lastSmoothedPoint = filteredPoint;
      return filteredPoint;
    }

    const dt = Math.max(filteredPoint.t - this.lastSmoothedPoint.t, 1);
    const velocityX = dx / dt;
    const velocityY = dy / dt;
    const predictedPoint: SmoothedPoint = {
      ...filteredPoint,
      x: filteredPoint.x + velocityX * config.predictionWindowMs,
      y: filteredPoint.y + velocityY * config.predictionWindowMs,
      predicted: true,
    };

    this.lastSmoothedPoint = filteredPoint;
    return predictedPoint;
  }
}

function hasSharpDirectionChange(previous: SmoothedPoint, next: SmoothedPoint): boolean {
  const previousDx = previous.x - previous.rawX;
  const previousDy = previous.y - previous.rawY;
  const nextDx = next.x - previous.x;
  const nextDy = next.y - previous.y;
  const previousMagnitude = Math.hypot(previousDx, previousDy);
  const nextMagnitude = Math.hypot(nextDx, nextDy);

  if (previousMagnitude < 2 || nextMagnitude < 2) {
    return false;
  }

  const cosine =
    (previousDx * nextDx + previousDy * nextDy) / (previousMagnitude * nextMagnitude);
  return cosine < -0.35;
}
