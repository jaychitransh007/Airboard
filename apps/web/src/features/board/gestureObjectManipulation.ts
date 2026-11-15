import {
  isSceneNodeElement,
  type AnnotationPoint,
  type BoardSceneElement,
  type BoardState,
  type ConnectorEndpoint,
} from "@airboard/core";
import type { GestureTarget } from "@airboard/gesture-engine";

/**
 * Camera manipulation deliberately exposes committed object bodies only.
 * Resize handles and empty-canvas selection regions are never gesture targets:
 * a closed hand may move an object, while every other empty-canvas pose is a
 * no-op.
 *
 * Every hand-targetable element is a target (gap 2 of the hands-free audit),
 * whoever made it: Airo, short commands, the toolbar or dock placement.
 */
export function buildGestureMoveTargets(state: BoardState): GestureTarget[] {
  const targets: GestureTarget[] = [];
  for (const element of Object.values(state.elements ?? {})) {
    if (!isHandTargetableSceneElement(state, element)) continue;
    if (element.kind === "connector") {
      pushSegmentTargets(
        targets,
        element.id,
        [element.start.point, ...element.controlPoints, element.end.point],
        0.9,
      );
      continue;
    }
    targets.push({
      id: element.id,
      bounds: {
        x: element.transform.x,
        y: element.transform.y,
        width: element.transform.width,
        height: element.transform.height,
      },
      priority: isSceneNodeElement(element) ? 2 : 1,
      capturePaddingPx: 12,
      releasePaddingPx: 18,
    });
  }
  return targets;
}

function pushSegmentTargets(
  targets: GestureTarget[],
  id: string,
  route: readonly AnnotationPoint[],
  priority: number,
): void {
  const inflate = 10;
  for (let index = 1; index < route.length; index += 1) {
    const from = route[index - 1]!;
    const to = route[index]!;
    targets.push({
      id,
      bounds: {
        x: Math.min(from.x, to.x) - inflate,
        y: Math.min(from.y, to.y) - inflate,
        width: Math.abs(to.x - from.x) + inflate * 2,
        height: Math.abs(to.y - from.y) + inflate * 2,
      },
      priority,
      capturePaddingPx: 10,
      releasePaddingPx: 16,
    });
  }
}

/**
 * An element a hand may grab, move, erase or hold-to-edit. Sections are
 * containers a closed hand would grab by accident, so they stay mouse-only;
 * hidden elements and members of hidden or collapsed sections are not on view.
 */
export function isHandTargetableSceneElement(
  state: BoardState,
  element: BoardSceneElement | undefined,
): element is BoardSceneElement {
  if (!element || element.status !== "active" || !element.visible) return false;
  if (element.kind === "section") return false;
  const section = element.sectionId ? state.elements[element.sectionId] : undefined;
  if (
    section?.kind === "section" &&
    section.status === "active" &&
    (!section.visible || section.collapsed)
  ) {
    return false;
  }
  return true;
}

/** The node (shape, sticky, text, mind-map node) under a board point, if any. */
export function sceneNodeAtPoint(
  state: BoardState,
  point: AnnotationPoint,
  paddingPx = 0,
): BoardSceneElement | null {
  let best: BoardSceneElement | null = null;
  for (const element of Object.values(state.elements ?? {})) {
    if (!isSceneNodeElement(element) || !isHandTargetableSceneElement(state, element)) continue;
    const { x, y, width, height } = element.transform;
    if (
      point.x >= x - paddingPx &&
      point.x <= x + width + paddingPx &&
      point.y >= y - paddingPx &&
      point.y <= y + height + paddingPx &&
      (!best || element.zIndex > best.zIndex)
    ) {
      best = element;
    }
  }
  return best;
}

export type HandConnectorEnds = {
  start: ConnectorEndpoint;
  end: ConnectorEndpoint;
};

/** How far (board px) from a released connector the hand may still reach a shape. */
const CONNECTOR_DROP_REACH_PX = 360;

/**
 * Ends for a connector placed by hand, attached to real shapes.
 *
 * - `drag`: the hand closed at `from` and opened at `to`. Each end binds to
 *   the shape under that point (close on A, open on B → A→B).
 * - `drop`: a connector carried from the dock and released at `to`. If the
 *   release is over a shape, that shape is the end and the nearest other shape
 *   the start; released between shapes, the two nearest shapes are joined in
 *   reading order (left→right, or top→bottom when they are stacked).
 *
 * Ends with no shape keep the raw point, so the connector still lands where
 * the hand let go.
 */
export function resolveHandConnectorEnds(
  state: BoardState,
  input: { mode: "drag" | "drop"; from: AnnotationPoint; to: AnnotationPoint },
): HandConnectorEnds {
  let startShape: BoardSceneElement | null = null;
  let endShape: BoardSceneElement | null = null;
  if (input.mode === "drag") {
    startShape = sceneNodeAtPoint(state, input.from, 8);
    endShape = sceneNodeAtPoint(state, input.to, 8);
    if (startShape && endShape && startShape.id === endShape.id) endShape = null;
  } else {
    const under = sceneNodeAtPoint(state, input.to, 8);
    const nearest = nearestSceneNodes(state, input.to, CONNECTOR_DROP_REACH_PX)
      .filter((element) => element.id !== under?.id);
    if (under) {
      startShape = nearest[0] ?? null;
      endShape = under;
    } else if (nearest.length >= 2) {
      const [a, b] = [nearest[0]!, nearest[1]!];
      const ca = nodeCenter(a);
      const cb = nodeCenter(b);
      const horizontal = Math.abs(ca.x - cb.x) >= Math.abs(ca.y - cb.y);
      const aFirst = horizontal ? ca.x <= cb.x : ca.y <= cb.y;
      startShape = aFirst ? a : b;
      endShape = aFirst ? b : a;
    }
  }

  const fallbackFrom = input.mode === "drag" ? input.from : { x: input.to.x - 90, y: input.to.y };
  const fallbackTo = input.mode === "drag" ? input.to : { x: input.to.x + 90, y: input.to.y };
  const startToward = endShape ? nodeCenter(endShape) : fallbackTo;
  const endToward = startShape ? nodeCenter(startShape) : fallbackFrom;
  return {
    start: startShape
      ? {
          point: anchorToward(startShape, startToward),
          binding: { elementId: startShape.id, anchor: "auto" },
          decoration: "none",
        }
      : { point: fallbackFrom, decoration: "none" },
    end: endShape
      ? {
          point: anchorToward(endShape, endToward),
          binding: { elementId: endShape.id, anchor: "auto" },
          decoration: "solid_arrow",
        }
      : { point: fallbackTo, decoration: "solid_arrow" },
  };
}

function nearestSceneNodes(
  state: BoardState,
  point: AnnotationPoint,
  reachPx: number,
): BoardSceneElement[] {
  return Object.values(state.elements ?? {})
    .filter((element) => isSceneNodeElement(element) && isHandTargetableSceneElement(state, element))
    .map((element) => ({ element, distance: distanceToBox(element, point) }))
    .filter(({ distance }) => distance <= reachPx)
    .sort((a, b) => a.distance - b.distance)
    .map(({ element }) => element);
}

function distanceToBox(element: BoardSceneElement, point: AnnotationPoint): number {
  const { x, y, width, height } = element.transform;
  const dx = Math.max(x - point.x, 0, point.x - (x + width));
  const dy = Math.max(y - point.y, 0, point.y - (y + height));
  return Math.hypot(dx, dy);
}

function nodeCenter(element: BoardSceneElement): AnnotationPoint {
  return {
    x: element.transform.x + element.transform.width / 2,
    y: element.transform.y + element.transform.height / 2,
  };
}

function anchorToward(element: BoardSceneElement, toward: AnnotationPoint): AnnotationPoint {
  const center = nodeCenter(element);
  const dx = toward.x - center.x;
  const dy = toward.y - center.y;
  if (Math.abs(dx) < 0.001 && Math.abs(dy) < 0.001) return center;
  const halfWidth = Math.max(0.5, element.transform.width / 2);
  const halfHeight = Math.max(0.5, element.transform.height / 2);
  const scale = 1 / Math.max(Math.abs(dx) / halfWidth, Math.abs(dy) / halfHeight);
  return { x: center.x + dx * scale, y: center.y + dy * scale };
}
