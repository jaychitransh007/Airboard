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

const CATALOG_CATEGORY_TARGET_PREFIX = "category:";
export type DockGesturePinchPhase = "open" | "closing" | "closed" | "opening";

/**
 * Maps a hovered catalog-category trigger to the catalog it should open.
 * Tool tiles and top-level controls deliberately return null: hovering them
 * may highlight the target, but must never select or activate anything.
 */
export function catalogIdForDockGestureHover(targetId: string | null): string | null {
  if (!isCatalogCategoryTarget(targetId)) {
    return null;
  }
  const catalogId = targetId.slice(CATALOG_CATEGORY_TARGET_PREFIX.length);
  return catalogId || null;
}

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
 * Permits one dock activation per complete physical close/reopen cycle. A
 * concrete target must remain stable from the controller's `closing` phase
 * through its confirmed `closed` phase. `opening -> closed` jitter therefore
 * cannot manufacture another pickup, and only a true `open` phase rearms the
 * tracker. Catalog categories remain hover-only.
 */
export class DockGestureActivationTracker {
  private consumed = false;
  private candidateId: string | null = null;

  update(targetId: string | null, pinchPhase: DockGesturePinchPhase): string | null {
    if (pinchPhase === "open") {
      this.release();
      return null;
    }

    if (pinchPhase === "opening") {
      this.candidateId = null;
      return null;
    }

    const activatableTarget =
      targetId && !isCatalogCategoryTarget(targetId) ? targetId : null;
    if (pinchPhase === "closing") {
      this.candidateId = this.consumed ? null : activatableTarget;
      return null;
    }

    if (
      this.consumed ||
      !activatableTarget ||
      this.candidateId !== activatableTarget
    ) {
      return null;
    }

    this.consumed = true;
    this.candidateId = null;
    return activatableTarget;
  }

  release(): void {
    this.consumed = false;
    this.candidateId = null;
  }

  reset(): void {
    this.consumed = false;
    this.candidateId = null;
  }
}

function isCatalogCategoryTarget(targetId: string | null): targetId is string {
  return targetId?.startsWith(CATALOG_CATEGORY_TARGET_PREFIX) ?? false;
}
