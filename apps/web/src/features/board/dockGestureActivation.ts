export type DockGestureTarget = {
  id: string;
  disabled?: boolean;
  bounds: {
    left: number;
    top: number;
    width: number;
    height: number;
  };
};

/**
 * Chooses one forgiving dock target in screen space. Overlapping padded areas
 * resolve to the closest visual center so a camera cursor cannot activate an
 * arbitrary neighbor.
 */
export function chooseDockGestureTarget(
  point: { x: number; y: number },
  targets: readonly DockGestureTarget[],
  paddingPx = 10,
): string | null {
  const candidates = targets
    .filter((target) => {
      if (target.disabled || !target.id) return false;
      const { left, top, width, height } = target.bounds;
      return (
        point.x >= left - paddingPx &&
        point.x <= left + width + paddingPx &&
        point.y >= top - paddingPx &&
        point.y <= top + height + paddingPx
      );
    })
    .map((target) => ({
      id: target.id,
      distance: Math.hypot(
        point.x - (target.bounds.left + target.bounds.width / 2),
        point.y - (target.bounds.top + target.bounds.height / 2),
      ),
    }))
    .sort((left, right) => left.distance - right.distance);
  return candidates[0]?.id ?? null;
}

/**
 * Permits one dock activation per physical close/reopen cycle. Crucially, the
 * close may begin before the hand reaches the target.
 */
export class DockGestureActivationTracker {
  private consumed = false;

  activate(targetId: string | null, closeIntentActive: boolean): string | null {
    if (!targetId || !closeIntentActive || this.consumed) {
      return null;
    }
    this.consumed = true;
    return targetId;
  }

  release(): void {
    this.consumed = false;
  }

  reset(): void {
    this.consumed = false;
  }
}
