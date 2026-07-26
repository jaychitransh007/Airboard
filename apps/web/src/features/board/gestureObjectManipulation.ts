import type { BoardState } from "@airboard/core";
import { getConnectorRoutePoints } from "@airboard/drawing-engine";
import type { GestureTarget } from "@airboard/gesture-engine";

/**
 * Camera manipulation deliberately exposes committed object bodies only.
 * Resize handles and empty-canvas selection regions are never gesture targets:
 * a closed hand may move an object, while every other empty-canvas pose is a
 * no-op.
 */
export function buildGestureMoveTargets(state: BoardState): GestureTarget[] {
  const targets: GestureTarget[] = [];
  for (const stroke of Object.values(state.strokes)) {
    const annotation = stroke.annotation;
    if (stroke.status !== "committed" || !annotation) {
      continue;
    }

    if (annotation.bounds) {
      targets.push({
        id: stroke.id,
        bounds: annotation.bounds,
        priority: annotation.type === "flow_node" || annotation.type === "sticky_note" ? 2 : 1,
        capturePaddingPx: 12,
        releasePaddingPx: 18,
      });
      continue;
    }

    if (annotation.start && annotation.end) {
      const route = getConnectorRoutePoints(annotation);
      const inflate = 10;
      for (let index = 1; index < route.length; index += 1) {
        const from = route[index - 1]!;
        const to = route[index]!;
        targets.push({
          id: stroke.id,
          bounds: {
            x: Math.min(from.x, to.x) - inflate,
            y: Math.min(from.y, to.y) - inflate,
            width: Math.abs(to.x - from.x) + inflate * 2,
            height: Math.abs(to.y - from.y) + inflate * 2,
          },
          priority: annotation.type === "connector" ? 0.9 : 0.8,
          capturePaddingPx: 10,
          releasePaddingPx: 16,
        });
      }
    }
  }
  return targets;
}

/**
 * Pointer and keyboard-assisted interactions may resolve visible resize
 * handles. Camera input never may, even when its cursor happens to overlap a
 * selected object's pointer handle.
 */
export function resolveResizeHandleForInput<T>(
  inputSource: string,
  forcedHandle: T | null | undefined,
  detectedHandle: T | null,
): T | null {
  if (inputSource === "air_gesture") {
    return null;
  }
  return forcedHandle ?? detectedHandle;
}
