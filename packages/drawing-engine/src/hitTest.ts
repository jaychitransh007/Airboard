import type { BoardState, Stroke, StrokePoint } from "@airboard/core";
import { getConnectorRoutePoints } from "./connectorGeometry.ts";

export function findIntersectingStrokeIds(
  state: BoardState,
  point: StrokePoint,
  radius: number,
): string[] {
  return Object.values(state.strokes)
    .filter((stroke) => stroke.status === "committed")
    .filter((stroke) => strokeIntersectsCircle(stroke, point, radius))
    .map((stroke) => stroke.id);
}

export function findAnnotationObjectAtPoint(
  state: BoardState,
  point: Pick<StrokePoint, "x" | "y">,
): Stroke | null {
  const strokes = Object.values(state.strokes)
    .filter((stroke) => stroke.status === "committed" && stroke.annotation)
    .reverse();

  for (const stroke of strokes) {
    if (annotationContainsPoint(stroke, point)) {
      return stroke;
    }
  }

  return null;
}

export function strokeIntersectsCircle(
  stroke: Stroke,
  center: Pick<StrokePoint, "x" | "y">,
  radius: number,
): boolean {
  if (stroke.annotation?.bounds && boundsIntersectsCircle(stroke.annotation.bounds, center, radius)) {
    return true;
  }

  if (stroke.points.length === 0) {
    return false;
  }

  if (
    (stroke.annotation?.type === "arrow" || stroke.annotation?.type === "connector") &&
    stroke.annotation.start &&
    stroke.annotation.end
  ) {
    const route = getConnectorRoutePoints(stroke.annotation);
    for (let index = 1; index < route.length; index += 1) {
      const start = route[index - 1];
      const end = route[index];
      if (start && end && distanceToSegment(center, start, end) <= radius + stroke.thickness / 2) {
        return true;
      }
    }
    return false;
  }

  if (stroke.points.length === 1) {
    const point = stroke.points[0];
    return point ? distance(point, center) <= radius + stroke.thickness / 2 : false;
  }

  for (let index = 1; index < stroke.points.length; index += 1) {
    const start = stroke.points[index - 1];
    const end = stroke.points[index];
    if (start && end && distanceToSegment(center, start, end) <= radius + stroke.thickness / 2) {
      return true;
    }
  }

  return false;
}

function annotationContainsPoint(
  stroke: Stroke,
  point: Pick<StrokePoint, "x" | "y">,
): boolean {
  const annotation = stroke.annotation;
  if (!annotation) {
    return false;
  }

  if (annotation.bounds) {
    const padding = annotation.type === "highlight" ? 8 : 4;
    const { x, y, width, height } = annotation.bounds;
    const halfWidth = width / 2;
    const halfHeight = height / 2;
    const centerX = x + halfWidth;
    const centerY = y + halfHeight;
    const dx = point.x - centerX;
    const dy = point.y - centerY;
    const radiusX = halfWidth + padding;
    const radiusY = halfHeight + padding;

    // Match the rendered geometry so a node's transparent bounding-box corners
    // are not grabbable: ellipses use a radial test and decision diamonds use a
    // rhombus test. Everything else keeps the padded bounding box.
    if (annotation.type === "ellipse" || annotation.type === "pointer") {
      if (!(radiusX > 0) || !(radiusY > 0)) {
        return false;
      }
      return (dx * dx) / (radiusX * radiusX) + (dy * dy) / (radiusY * radiusY) <= 1;
    }

    if (annotation.nodeType === "decision") {
      if (!(radiusX > 0) || !(radiusY > 0)) {
        return false;
      }
      return Math.abs(dx) / radiusX + Math.abs(dy) / radiusY <= 1;
    }

    return (
      point.x >= x - padding &&
      point.x <= x + width + padding &&
      point.y >= y - padding &&
      point.y <= y + height + padding
    );
  }

  if (
    (annotation.type === "arrow" || annotation.type === "connector") &&
    annotation.start &&
    annotation.end
  ) {
    const route = getConnectorRoutePoints(annotation);
    for (let index = 1; index < route.length; index += 1) {
      const start = route[index - 1];
      const end = route[index];
      if (
        start &&
        end &&
        distanceToSegment(point, start, end) <= Math.max(10, stroke.thickness + 7)
      ) {
        return true;
      }
    }
    return false;
  }

  return false;
}

function distance(a: Pick<StrokePoint, "x" | "y">, b: Pick<StrokePoint, "x" | "y">): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function boundsIntersectsCircle(
  bounds: NonNullable<Stroke["annotation"]>["bounds"],
  center: Pick<StrokePoint, "x" | "y">,
  radius: number,
): boolean {
  if (!bounds) {
    return false;
  }

  const closestX = clamp(center.x, bounds.x, bounds.x + bounds.width);
  const closestY = clamp(center.y, bounds.y, bounds.y + bounds.height);
  return Math.hypot(center.x - closestX, center.y - closestY) <= radius;
}

function distanceToSegment(
  point: Pick<StrokePoint, "x" | "y">,
  start: Pick<StrokePoint, "x" | "y">,
  end: Pick<StrokePoint, "x" | "y">,
): number {
  const dx = end.x - start.x;
  const dy = end.y - start.y;

  if (dx === 0 && dy === 0) {
    return distance(point, start);
  }

  const t = Math.max(
    0,
    Math.min(1, ((point.x - start.x) * dx + (point.y - start.y) * dy) / (dx * dx + dy * dy)),
  );
  const projected = {
    x: start.x + t * dx,
    y: start.y + t * dy,
  };

  return distance(point, projected);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
