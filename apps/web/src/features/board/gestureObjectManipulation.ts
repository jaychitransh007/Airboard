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
      bounds: { x: anchor.x - 8, y: anchor.y - 8, width: 16, height: 16 },
      priority: 3,
      capturePaddingPx: 4,
      releasePaddingPx: 8,
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
 * the middle, ring, and pinky remain open. A closed hand therefore produces a
 * zero resize signal even though thumb and index are physically close.
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

  const supportingFingerScores = [
    grab.fingerScores.middle,
    grab.fingerScores.ring,
    grab.fingerScores.pinky,
  ];
  if (supportingFingerScores.some((score) => score === undefined || !Number.isFinite(score))) {
    return 0;
  }
  const maximumSupportingCurl = Math.max(
    ...(supportingFingerScores as number[]),
  );
  // Full strength below 0.18 curl, tapering to zero at 0.52. This rejects a
  // fist while allowing natural, slightly relaxed support fingers.
  const openFingerGate = clamp01((0.52 - maximumSupportingCurl) / 0.34);
  if (openFingerGate === 0) {
    return 0;
  }

  const normalizedDistance =
    Math.hypot(thumbTip.x - indexTip.x, thumbTip.y - indexTip.y) / grab.handScale;
  return pinchStrengthFromDistance(normalizedDistance) * openFingerGate;
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, Number.isFinite(value) ? value : 0));
}
