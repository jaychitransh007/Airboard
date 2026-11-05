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

/**
 * Frames board-space `bounds` inside the visible part of the canvas, which
 * excludes `rightInset` screen pixels (the Airo panel). Never zooms past 100%,
 * so a small diagram stays at its natural size instead of filling the screen.
 */
export function fitViewportToBounds(
  bounds: { x: number; y: number; width: number; height: number },
  limits: ViewportLimits,
  options: { padding?: number; rightInset?: number } = {},
): BoardViewport {
  const padding = options.padding ?? 48;
  const visibleWidth = Math.max(1, limits.canvasWidth - (options.rightInset ?? 0));
  const scale = clampNumber(
    Math.min(
      1,
      (visibleWidth - padding * 2) / Math.max(1, bounds.width),
      (limits.canvasHeight - padding * 2) / Math.max(1, bounds.height),
    ),
    limits.minScale,
    limits.maxScale,
  );
  return {
    x: visibleWidth / 2 - (bounds.x + bounds.width / 2) * scale,
    y: limits.canvasHeight / 2 - (bounds.y + bounds.height / 2) * scale,
    scale,
  };
}

/**
 * True when all of `bounds` is on screen, left of any panel covering the
 * canvas's right edge. Boards made on a wide screen often open partly hidden
 * on a narrow one.
 */
export function boundsFitViewport(
  bounds: { x: number; y: number; width: number; height: number },
  viewport: BoardViewport,
  limits: Pick<ViewportLimits, "canvasWidth" | "canvasHeight">,
  rightInset = 0,
): boolean {
  const left = viewport.x + bounds.x * viewport.scale;
  const top = viewport.y + bounds.y * viewport.scale;
  const right = viewport.x + (bounds.x + bounds.width) * viewport.scale;
  const bottom = viewport.y + (bounds.y + bounds.height) * viewport.scale;
  return left >= 0 && top >= 0 && right <= limits.canvasWidth - rightInset && bottom <= limits.canvasHeight;
}

type ScreenRect = { left: number; top: number; width: number; height: number };

/**
 * The middle of the canvas area an open panel leaves uncovered, in canvas
 * screen coordinates. A panel spanning most of the width is a bottom sheet
 * (phones) and covers the bottom; a narrower one covers the right edge.
 * Commands place new objects here so they appear where the person can see.
 */
export function unobscuredCanvasCenter(canvas: ScreenRect, panel: ScreenRect | null): { x: number; y: number } {
  let right = canvas.width;
  let bottom = canvas.height;
  if (panel && panel.width > 0 && panel.height > 0) {
    if (panel.width >= canvas.width * 0.6) {
      bottom = clampNumber(panel.top - canvas.top, canvas.height * 0.25, canvas.height);
    } else {
      right = clampNumber(panel.left - canvas.left, canvas.width * 0.25, canvas.width);
    }
  }
  return { x: right / 2, y: bottom / 2 };
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
