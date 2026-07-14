/**
 * Board viewport: the pan/zoom camera over the (large-but-bounded) board
 * plane. Screen and board coordinates relate as
 *
 *   screen = board * scale + offset
 *
 * All math is pure so panning limits, zoom anchoring, and round-tripping are
 * unit-testable. The board is "infinite-like": the visible window can wander
 * anywhere inside ±WORLD_EXTENT board units of the origin.
 */

export type BoardViewport = {
  /** Screen offset of the board origin, CSS pixels. */
  x: number;
  y: number;
  /** Screen pixels per board unit. */
  scale: number;
};

export type ViewportLimits = {
  minScale: number;
  maxScale: number;
  /** The visible window's center may roam ±this many board units from origin. */
  worldExtent: number;
  canvasWidth: number;
  canvasHeight: number;
};

export const IDENTITY_VIEWPORT: BoardViewport = { x: 0, y: 0, scale: 1 };

export const DEFAULT_VIEWPORT_LIMITS: Omit<ViewportLimits, "canvasWidth" | "canvasHeight"> = {
  minScale: 0.25,
  maxScale: 3,
  worldExtent: 2_400,
};

export function boardPointFromScreen(
  viewport: BoardViewport,
  point: { x: number; y: number },
): { x: number; y: number } {
  return {
    x: (point.x - viewport.x) / viewport.scale,
    y: (point.y - viewport.y) / viewport.scale,
  };
}

export function screenPointFromBoard(
  viewport: BoardViewport,
  point: { x: number; y: number },
): { x: number; y: number } {
  return {
    x: point.x * viewport.scale + viewport.x,
    y: point.y * viewport.scale + viewport.y,
  };
}

/** Pans by a screen-space delta (positive dx moves content right). */
export function panViewport(
  viewport: BoardViewport,
  dxScreen: number,
  dyScreen: number,
  limits: ViewportLimits,
): BoardViewport {
  return clampViewport(
    { x: viewport.x + dxScreen, y: viewport.y + dyScreen, scale: viewport.scale },
    limits,
  );
}

/**
 * Zooms by `factor` keeping the board point under `anchorScreen` stationary
 * on screen — the standard pinch-zoom anchoring rule.
 */
export function zoomViewport(
  viewport: BoardViewport,
  factor: number,
  anchorScreen: { x: number; y: number },
  limits: ViewportLimits,
): BoardViewport {
  const nextScale = clampNumber(viewport.scale * factor, limits.minScale, limits.maxScale);
  const effectiveFactor = nextScale / viewport.scale;
  return clampViewport(
    {
      x: anchorScreen.x - (anchorScreen.x - viewport.x) * effectiveFactor,
      y: anchorScreen.y - (anchorScreen.y - viewport.y) * effectiveFactor,
      scale: nextScale,
    },
    limits,
  );
}

export function clampViewport(
  viewport: BoardViewport,
  limits: ViewportLimits,
): BoardViewport {
  const scale = clampNumber(viewport.scale, limits.minScale, limits.maxScale);
  // Keep the visible window's center within the world bounds.
  const centerScreen = { x: limits.canvasWidth / 2, y: limits.canvasHeight / 2 };
  const centerBoard = boardPointFromScreen({ ...viewport, scale }, centerScreen);
  const clampedCenter = {
    x: clampNumber(centerBoard.x, -limits.worldExtent, limits.worldExtent),
    y: clampNumber(centerBoard.y, -limits.worldExtent, limits.worldExtent),
  };
  return {
    x: centerScreen.x - clampedCenter.x * scale,
    y: centerScreen.y - clampedCenter.y * scale,
    scale,
  };
}

function clampNumber(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}
