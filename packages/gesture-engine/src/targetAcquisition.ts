import type { Vector2D } from "./types.ts";

export type TargetBounds = {
  x: number;
  y: number;
  width: number;
  height: number;
};

/** A target understood by the gesture engine without depending on board models. */
export type GestureTarget = {
  id: string;
  bounds: TargetBounds;
  /** Higher priority wins when area cursors overlap multiple targets. */
  priority?: number;
  /** Extra acquisition radius for small handles or ports. */
  capturePaddingPx?: number;
  /** Extra release radius used after this target already has focus. */
  releasePaddingPx?: number;
  disabled?: boolean;
};

export type AreaTargetMatch = {
  target: GestureTarget;
  distancePx: number;
  inside: boolean;
};

export type StickyTargetInput = {
  point: Vector2D;
  targets: readonly GestureTarget[];
  currentTargetId: string | null;
  acquireRadiusPx: number;
  releaseRadiusPx: number;
};

/** Distance to the nearest point on a target. It is zero while inside. */
export function distanceToTarget(point: Vector2D, bounds: TargetBounds): number {
  const minX = Math.min(bounds.x, bounds.x + bounds.width);
  const maxX = Math.max(bounds.x, bounds.x + bounds.width);
  const minY = Math.min(bounds.y, bounds.y + bounds.height);
  const maxY = Math.max(bounds.y, bounds.y + bounds.height);
  const dx = Math.max(minX - point.x, 0, point.x - maxX);
  const dy = Math.max(minY - point.y, 0, point.y - maxY);
  return Math.hypot(dx, dy);
}

/**
 * Finds the best target touched by a circular area cursor. Priority is
 * considered first, then geometric distance, target size, and source order.
 */
export function findAreaTarget(
  point: Vector2D,
  targets: readonly GestureTarget[],
  radiusPx: number,
): AreaTargetMatch | null {
  const radius = Number.isFinite(radiusPx) ? Math.max(0, radiusPx) : 0;
  const matches = targets.flatMap((target, index) => {
    if (target.disabled) {
      return [];
    }
    const distancePx = distanceToTarget(point, target.bounds);
    const threshold = radius + Math.max(0, target.capturePaddingPx ?? 0);
    if (distancePx > threshold) {
      return [];
    }
    return [
      {
        target,
        distancePx,
        inside: distancePx === 0,
        priority: target.priority ?? 0,
        area: Math.abs(target.bounds.width * target.bounds.height),
        index,
      },
    ];
  });

  matches.sort(
    (a, b) =>
      b.priority - a.priority ||
      a.distancePx - b.distancePx ||
      a.area - b.area ||
      b.index - a.index,
  );

  const winner = matches[0];
  return winner
    ? {
        target: winner.target,
        distancePx: winner.distancePx,
        inside: winner.inside,
      }
    : null;
}

/**
 * Keeps the current target until the cursor leaves a larger release envelope,
 * then performs a fresh area-cursor acquisition. This prevents focus flicker
 * along adjacent object edges.
 */
export function acquireStickyTarget(input: StickyTargetInput): AreaTargetMatch | null {
  if (input.currentTargetId) {
    const current = input.targets.find(
      (target) => target.id === input.currentTargetId && !target.disabled,
    );
    if (current) {
      const distancePx = distanceToTarget(input.point, current.bounds);
      const releaseThreshold =
        Math.max(input.acquireRadiusPx, input.releaseRadiusPx) +
        Math.max(0, current.releasePaddingPx ?? current.capturePaddingPx ?? 0);
      if (distancePx <= releaseThreshold) {
        return {
          target: current,
          distancePx,
          inside: distancePx === 0,
        };
      }
    }
  }

  return findAreaTarget(input.point, input.targets, input.acquireRadiusPx);
}

export function targetCenter(bounds: TargetBounds): Vector2D {
  return {
    x: bounds.x + bounds.width / 2,
    y: bounds.y + bounds.height / 2,
  };
}
