import type { AnnotationPoint, StrokeAnnotation } from "@airboard/core";

export function getConnectorRoutePoints(annotation: StrokeAnnotation): AnnotationPoint[] {
  const start = annotation.start;
  const end = annotation.end;
  if (!start || !end) {
    return [];
  }

  if (annotation.type !== "connector") {
    return [start, end];
  }

  const dx = end.x - start.x;
  const dy = end.y - start.y;
  if (Math.abs(dx) < 18 || Math.abs(dy) < 18) {
    return [start, end];
  }

  const midX = start.x + dx / 2;
  return [
    start,
    { x: midX, y: start.y },
    { x: midX, y: end.y },
    end,
  ];
}

export function getRouteMidpoint(points: readonly AnnotationPoint[]): AnnotationPoint | null {
  if (points.length < 2) {
    return points[0] ?? null;
  }

  const segments: Array<{ start: AnnotationPoint; end: AnnotationPoint; length: number }> = [];
  let totalLength = 0;
  for (let index = 1; index < points.length; index += 1) {
    const start = points[index - 1];
    const end = points[index];
    if (!start || !end) {
      continue;
    }
    const length = Math.hypot(end.x - start.x, end.y - start.y);
    segments.push({ start, end, length });
    totalLength += length;
  }

  let remaining = totalLength / 2;
  for (const segment of segments) {
    if (remaining <= segment.length) {
      const ratio = segment.length === 0 ? 0 : remaining / segment.length;
      return {
        x: segment.start.x + (segment.end.x - segment.start.x) * ratio,
        y: segment.start.y + (segment.end.y - segment.start.y) * ratio,
      };
    }
    remaining -= segment.length;
  }
  return points[points.length - 1] ?? null;
}
