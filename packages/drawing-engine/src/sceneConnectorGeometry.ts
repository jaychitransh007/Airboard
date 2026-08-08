import type { AnnotationPoint, ConnectorElement } from "@airboard/core";

/**
 * Deterministic board-space samples for a scene connector. Rendering, labels,
 * hit testing, and selection all consume the same route so curved and bent
 * connectors never disagree about where the object is.
 */
export function sampleSceneConnector(
  element: ConnectorElement,
  curvedSegments = 28,
): AnnotationPoint[] {
  const start = element.start.point;
  const end = element.end.point;

  if (element.pathKind === "straight") {
    return [start, end];
  }

  if (element.pathKind === "bent") {
    if (element.controlPoints.length > 0) {
      return [start, ...element.controlPoints, end];
    }
    const middleX = start.x + (end.x - start.x) / 2;
    return [
      start,
      { x: middleX, y: start.y },
      { x: middleX, y: end.y },
      end,
    ];
  }

  const controls = sceneConnectorCurveControls(element);
  const segmentCount = Math.max(4, Math.floor(curvedSegments));
  return Array.from({ length: segmentCount + 1 }, (_, index) => {
    const t = index / segmentCount;
    return cubicPoint(start, controls[0], controls[1], end, t);
  });
}

/** Cubic control points, deriving a stable horizontal S-curve when omitted. */
export function sceneConnectorCurveControls(
  element: ConnectorElement,
): readonly [AnnotationPoint, AnnotationPoint] {
  const start = element.start.point;
  const end = element.end.point;
  const first = element.controlPoints[0];
  const second = element.controlPoints[1];
  if (first && second) return [first, second];
  if (first) return [first, first];

  const dx = end.x - start.x;
  return [
    { x: start.x + dx / 2, y: start.y },
    { x: end.x - dx / 2, y: end.y },
  ];
}

export function sceneConnectorPointAt(
  element: ConnectorElement,
  rawPosition: number,
): AnnotationPoint {
  const points = sampleSceneConnector(element);
  if (points.length === 0) return element.start.point;
  if (points.length === 1) return points[0]!;

  const position = Math.min(1, Math.max(0, rawPosition));
  const lengths: number[] = [];
  let total = 0;
  for (let index = 1; index < points.length; index += 1) {
    const previous = points[index - 1]!;
    const current = points[index]!;
    const length = Math.hypot(current.x - previous.x, current.y - previous.y);
    lengths.push(length);
    total += length;
  }
  if (total === 0) return points[0]!;

  const target = total * position;
  let traversed = 0;
  for (let index = 0; index < lengths.length; index += 1) {
    const length = lengths[index]!;
    if (traversed + length >= target) {
      const start = points[index]!;
      const end = points[index + 1]!;
      const local = length === 0 ? 0 : (target - traversed) / length;
      return {
        x: start.x + (end.x - start.x) * local,
        y: start.y + (end.y - start.y) * local,
      };
    }
    traversed += length;
  }
  return points[points.length - 1]!;
}

function cubicPoint(
  start: AnnotationPoint,
  controlA: AnnotationPoint,
  controlB: AnnotationPoint,
  end: AnnotationPoint,
  t: number,
): AnnotationPoint {
  const inverse = 1 - t;
  const a = inverse * inverse * inverse;
  const b = 3 * inverse * inverse * t;
  const c = 3 * inverse * t * t;
  const d = t * t * t;
  return {
    x: a * start.x + b * controlA.x + c * controlB.x + d * end.x,
    y: a * start.y + b * controlA.y + c * controlB.y + d * end.y,
  };
}
