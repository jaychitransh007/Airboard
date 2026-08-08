import {
  nodeVisualContainsPoint,
  isCatalogShapeKind,
  type BoardSceneElement,
  type BoardState,
  type CatalogShapeKind,
  type ShapeElement,
  type Stroke,
  type StrokeAnnotation,
  type StrokePoint,
} from "@airboard/core";
import { getConnectorRoutePoints } from "./connectorGeometry.ts";
import { sampleSceneConnector, sceneConnectorPointAt } from "./sceneConnectorGeometry.ts";
import {
  catalogShapeContainsPoint,
  catalogShapeIntersectsCircle,
} from "./shapeGeometry.ts";

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

/** Returns the topmost active v2 scene element at a board-space point. */
export function findSceneElementAtPoint(
  state: BoardState,
  point: Pick<StrokePoint, "x" | "y">,
): BoardSceneElement | null {
  const hiddenMemberIds = hiddenSceneMemberIds(state);
  const elements = Object.values(state.elements ?? {})
    .filter(
      (element) =>
        element.status === "active" &&
        element.visible &&
        !hiddenMemberIds.has(element.id) &&
        !(element.legacyStrokeId && state.strokes[element.legacyStrokeId]),
    )
    .map((element, index) => ({ element, index }))
    .sort((a, b) => b.element.zIndex - a.element.zIndex || b.index - a.index);

  for (const { element } of elements) {
    if (sceneElementContainsPoint(element, point)) return element;
  }
  return null;
}

function hiddenSceneMemberIds(state: BoardState): Set<string> {
  const hidden = new Set<string>();
  const pending = Object.values(state.elements ?? {})
    .filter((element) => element.kind === "section" && element.status === "active" && (!element.visible || element.collapsed))
    .map(({ id }) => id);
  const visited = new Set<string>();
  while (pending.length > 0) {
    const sectionId = pending.shift()!;
    if (visited.has(sectionId)) continue;
    visited.add(sectionId);
    const section = state.elements[sectionId];
    if (section?.kind === "section") {
      for (const memberId of section.memberIds) {
        hidden.add(memberId);
        if (state.elements[memberId]?.kind === "section") pending.push(memberId);
      }
    }
    for (const element of Object.values(state.elements ?? {})) {
      if (element.sectionId !== sectionId) continue;
      hidden.add(element.id);
      if (element.kind === "section") pending.push(element.id);
    }
  }
  return hidden;
}

export type BoardObjectHit =
  | { source: "element"; element: BoardSceneElement }
  | { source: "stroke"; stroke: Stroke };

/** Unified lookup for callers migrating from annotation IDs to scene IDs. */
export function findBoardObjectAtPoint(
  state: BoardState,
  point: Pick<StrokePoint, "x" | "y">,
): BoardObjectHit | null {
  const element = findSceneElementAtPoint(state, point);
  if (element) return { source: "element", element };
  const stroke = findAnnotationObjectAtPoint(state, point);
  return stroke ? { source: "stroke", stroke } : null;
}

export function strokeIntersectsCircle(
  stroke: Stroke,
  center: Pick<StrokePoint, "x" | "y">,
  radius: number,
): boolean {
  const catalogKind = annotationCatalogShapeKind(stroke.annotation);
  if (catalogKind && stroke.annotation?.bounds) {
    return catalogShapeIntersectsCircle(catalogKind, stroke.annotation.bounds, center, radius);
  }
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

    const catalogKind = annotationCatalogShapeKind(annotation);
    if (catalogKind) {
      return catalogShapeContainsPoint(catalogKind, annotation.bounds, point, padding);
    }

    if (annotation.nodeType) {
      return nodeVisualContainsPoint(
        annotation.bounds,
        annotation.nodeType,
        point,
        padding,
      );
    }

    // Match the rendered geometry so a generic ellipse's transparent
    // bounding-box corners are not grabbable.
    if (annotation.type === "ellipse" || annotation.type === "pointer") {
      if (!(radiusX > 0) || !(radiusY > 0)) {
        return false;
      }
      return (dx * dx) / (radiusX * radiusX) + (dy * dy) / (radiusY * radiusY) <= 1;
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

function sceneElementContainsPoint(
  element: BoardSceneElement,
  point: Pick<StrokePoint, "x" | "y">,
): boolean {
  if (element.kind === "shape") return sceneShapeContainsPoint(element, point);

  if (element.kind === "connector") {
    const center = {
      x: element.transform.x + element.transform.width / 2,
      y: element.transform.y + element.transform.height / 2,
    };
    const localPoint = rotateAround(point, center, -(element.transform.rotation ?? 0));
    const route = sampleSceneConnector(element);
    for (let index = 1; index < route.length; index += 1) {
      const start = route[index - 1];
      const end = route[index];
      if (start && end && distanceToSegment(localPoint, start, end) <= 10) return true;
    }
    const label = element.label.blocks.flatMap((block) => block.runs).map((run) => run.text).join("");
    if (label) {
      const anchor = sceneConnectorPointAt(element, element.labelPosition);
      const halfWidth = Math.min(110, Math.max(36, label.length * 3.6 + 12));
      if (Math.abs(localPoint.x - anchor.x) <= halfWidth && Math.abs(localPoint.y - anchor.y) <= 38) {
        return true;
      }
    }
    return false;
  }

  if (element.kind === "drawing") {
    const center = {
      x: element.transform.x + element.transform.width / 2,
      y: element.transform.y + element.transform.height / 2,
    };
    const localPoint = rotateAround(point, center, -(element.transform.rotation ?? 0));
    const radius = Math.max(8, element.style.thickness / 2 + 5);
    if (element.points.length === 1) return distance(localPoint, element.points[0]!) <= radius;
    const route = element.style.straight && element.points.length > 1
      ? [element.points[0]!, element.points[element.points.length - 1]!]
      : element.points;
    for (let index = 1; index < route.length; index += 1) {
      const start = route[index - 1];
      const end = route[index];
      if (start && end && distanceToSegment(localPoint, start, end) <= radius) return true;
    }
    return false;
  }

  const bounds = element.transform;
  const left = Math.min(bounds.x, bounds.x + bounds.width);
  const right = Math.max(bounds.x, bounds.x + bounds.width);
  const top = Math.min(bounds.y, bounds.y + bounds.height);
  const bottom = Math.max(bounds.y, bounds.y + bounds.height);
  const center = { x: (left + right) / 2, y: (top + bottom) / 2 };
  const localPoint = rotateAround(point, center, -(bounds.rotation ?? 0));
  if (element.kind === "stamp") {
    const radiusX = Math.max(1, (right - left) / 2 + 8);
    const radiusY = Math.max(1, (bottom - top) / 2 + 8);
    const dx = localPoint.x - center.x;
    const dy = localPoint.y - center.y;
    return (dx * dx) / (radiusX * radiusX) + (dy * dy) / (radiusY * radiusY) <= 1;
  }
  return (
    localPoint.x >= left - 8 &&
    localPoint.x <= right + 8 &&
    localPoint.y >= top - 8 &&
    localPoint.y <= bottom + 8
  );
}

function sceneShapeContainsPoint(
  element: ShapeElement,
  point: Pick<StrokePoint, "x" | "y">,
): boolean {
  return catalogShapeContainsPoint(element.shapeKind, element.transform, point, 8);
}

function annotationCatalogShapeKind(
  annotation: StrokeAnnotation | undefined,
): CatalogShapeKind | null {
  const candidate = annotation?.shapeKind;
  return isCatalogShapeKind(candidate) ? candidate : null;
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

function rotateAround(
  point: Pick<StrokePoint, "x" | "y">,
  center: Pick<StrokePoint, "x" | "y">,
  degrees: number,
): { x: number; y: number } {
  if (degrees === 0) return { x: point.x, y: point.y };
  const radians = (degrees * Math.PI) / 180;
  const cosine = Math.cos(radians);
  const sine = Math.sin(radians);
  const dx = point.x - center.x;
  const dy = point.y - center.y;
  return {
    x: center.x + dx * cosine - dy * sine,
    y: center.y + dx * sine + dy * cosine,
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
