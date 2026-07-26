import type { BoardState } from "@airboard/core";
import {
  getConnectorRoutePoints,
} from "@airboard/drawing-engine";
import {
  pinchStrengthFromDistance,
  type GestureTarget,
  type GrabStrengthEstimate,
  type HandLandmark,
} from "@airboard/gesture-engine";

import type { AnnotationResizeHandle } from "./gestureAnnotationMode";

export const GESTURE_HANDLE_TARGET_PREFIX = "handle:";

export type GestureTargetKind = "move" | "resize";

/**
 * Keeps hand manipulation unambiguous:
 * - a closed hand can only acquire whole objects for movement;
 * - a precision thumb/index pinch can only acquire selected-object handles.
 *
 * The two target sets never overlap, so an interaction cannot change mode
 * after it starts.
 */
export function buildGestureManipulationTargets(
  state: BoardState,
  selectedStrokeId: string | null,
  kind: GestureTargetKind,
): GestureTarget[] {
  if (kind === "resize") {
    const selected = selectedStrokeId ? state.strokes[selectedStrokeId] : undefined;
    const annotation =
      selected?.status === "committed" ? selected.annotation : undefined;
    if (!selected || !annotation) {
      return [];
    }

    const anchors: { handle: AnnotationResizeHandle; x: number; y: number }[] = [];
    if (annotation.bounds) {
      const { x, y, width, height } = annotation.bounds;
      anchors.push(
        { handle: "nw", x, y },
        { handle: "ne", x: x + width, y },
        { handle: "sw", x, y: y + height },
        { handle: "se", x: x + width, y: y + height },
      );
    } else if (annotation.start && annotation.end) {
      anchors.push(
        { handle: "start", x: annotation.start.x, y: annotation.start.y },
        { handle: "end", x: annotation.end.x, y: annotation.end.y },
      );
    }

    return anchors.map((anchor) => ({
      id: `${GESTURE_HANDLE_TARGET_PREFIX}${selected.id}:${anchor.handle}`,
      // Camera precision is lower than pointer precision. A 28px target plus
      // the area cursor keeps the visible handle easy to acquire without
      // exposing the object body to resize.
      bounds: { x: anchor.x - 14, y: anchor.y - 14, width: 28, height: 28 },
      priority: 3,
      capturePaddingPx: 8,
      releasePaddingPx: 16,
    }));
  }

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

export function parseGestureHandleTargetId(
  targetId: string,
): { strokeId: string; handle: AnnotationResizeHandle } | null {
  if (!targetId.startsWith(GESTURE_HANDLE_TARGET_PREFIX)) {
    return null;
  }
  const separator = targetId.lastIndexOf(":");
  if (separator <= GESTURE_HANDLE_TARGET_PREFIX.length - 1) {
    return null;
  }
  return {
    strokeId: targetId.slice(GESTURE_HANDLE_TARGET_PREFIX.length, separator),
    handle: targetId.slice(separator + 1) as AnnotationResizeHandle,
  };
}

/**
 * A resize is a precision pinch, not a fist. Thumb and index must meet while
 * the index remains extended toward a selected handle. The remaining fingers
 * may rest naturally; requiring an artificial three-finger pose made ordinary
 * camera pinches unusable.
 */
export function estimatePrecisionResizePinch(
  landmarks: readonly (HandLandmark | null | undefined)[],
  grab: GrabStrengthEstimate,
): number {
  const thumbTip = landmarks[4];
  const indexTip = landmarks[8];
  if (
    !thumbTip ||
    !indexTip ||
    !Number.isFinite(thumbTip.x) ||
    !Number.isFinite(thumbTip.y) ||
    !Number.isFinite(indexTip.x) ||
    !Number.isFinite(indexTip.y) ||
    !(grab.handScale > 0)
  ) {
    return 0;
  }

  const indexCurl = grab.fingerScores.index;
  if (
    indexCurl === undefined ||
    !Number.isFinite(indexCurl) ||
    indexCurl > 0.72 ||
    grab.strength >= 0.8
  ) {
    return 0;
  }

  const normalizedDistance =
    Math.hypot(thumbTip.x - indexTip.x, thumbTip.y - indexTip.y) / grab.handScale;
  return pinchStrengthFromDistance(normalizedDistance, 0.24, 1.05);
}
