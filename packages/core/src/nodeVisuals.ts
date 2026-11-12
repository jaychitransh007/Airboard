import {
  AIRBOARD_SEMANTIC_NODE_CAPABILITIES,
  type AirboardNodeVisualKind,
  type AirboardSemanticNodeCapability,
} from "./semanticCapabilities.ts";
import type { AnnotationBounds, AnnotationNodeType, AnnotationPoint } from "./types.ts";

const VISUALS_BY_NODE_TYPE = new Map<AnnotationNodeType, AirboardSemanticNodeCapability>(
  AIRBOARD_SEMANTIC_NODE_CAPABILITIES.map((capability) => [
    capability.nodeType,
    capability,
  ]),
);

export function nodeVisualCapability(
  nodeType: AnnotationNodeType,
): AirboardSemanticNodeCapability {
  const capability = VISUALS_BY_NODE_TYPE.get(nodeType);
  if (!capability) throw new Error(`Missing node visual capability: ${nodeType}`);
  return capability;
}

export function nodeVisualKind(nodeType: AnnotationNodeType): AirboardNodeVisualKind {
  return nodeVisualCapability(nodeType).visual.kind;
}

export function nodeVisualDefaultSize(
  nodeType: AnnotationNodeType,
): { width: number; height: number } {
  return { ...nodeVisualCapability(nodeType).visual.defaultSize };
}

export function pointOnNodeBoundary(
  bounds: AnnotationBounds,
  nodeType: AnnotationNodeType | undefined,
  toward: AnnotationPoint,
): AnnotationPoint {
  const center = boundsCenter(bounds);
  const dx = toward.x - center.x;
  const dy = toward.y - center.y;
  if (dx === 0 && dy === 0) {
    return { x: bounds.x + bounds.width, y: center.y };
  }
  const kind = nodeType ? nodeVisualKind(nodeType) : "box";
  if (kind === "actor") {
    return polygonBoundary(center, toward, actorBoundaryPolygon(bounds));
  }
  if (kind === "ellipse") {
    return ellipseBoundary(bounds, toward);
  }
  if (kind === "decision") {
    const scale =
      1 /
      (Math.abs(dx) / Math.max(bounds.width / 2, 0.0001) +
        Math.abs(dy) / Math.max(bounds.height / 2, 0.0001));
    return { x: center.x + dx * scale, y: center.y + dy * scale };
  }
  if (kind === "io") {
    const skew = Math.min(bounds.width * 0.18, 26);
    return polygonBoundary(
      center,
      toward,
      [
        { x: bounds.x + skew, y: bounds.y },
        { x: bounds.x + bounds.width, y: bounds.y },
        { x: bounds.x + bounds.width - skew, y: bounds.y + bounds.height },
        { x: bounds.x, y: bounds.y + bounds.height },
      ],
    );
  }
  if (kind === "note") {
    const fold = Math.min(bounds.width, bounds.height) * 0.2;
    return polygonBoundary(
      center,
      toward,
      [
        { x: bounds.x, y: bounds.y },
        { x: bounds.x + bounds.width, y: bounds.y },
        { x: bounds.x + bounds.width, y: bounds.y + bounds.height - fold },
        { x: bounds.x + bounds.width - fold, y: bounds.y + bounds.height },
        { x: bounds.x, y: bounds.y + bounds.height },
      ],
    );
  }
  if (kind === "terminator") {
    return stadiumBoundary(bounds, toward);
  }
  return rectangleBoundary(bounds, toward);
}

function boundsCenter(bounds: AnnotationBounds): AnnotationPoint {
  return {
    x: bounds.x + bounds.width / 2,
    y: bounds.y + bounds.height / 2,
  };
}

function rectangleBoundary(bounds: AnnotationBounds, toward: AnnotationPoint): AnnotationPoint {
  const center = boundsCenter(bounds);
  const dx = toward.x - center.x;
  const dy = toward.y - center.y;
  const scale =
    1 /
    Math.max(
      Math.abs(dx) / Math.max(bounds.width / 2, 0.0001),
      Math.abs(dy) / Math.max(bounds.height / 2, 0.0001),
    );
  return { x: center.x + dx * scale, y: center.y + dy * scale };
}

function ellipseBoundary(bounds: AnnotationBounds, toward: AnnotationPoint): AnnotationPoint {
  const center = boundsCenter(bounds);
  const dx = toward.x - center.x;
  const dy = toward.y - center.y;
  const rx = Math.max(bounds.width / 2, 0.0001);
  const ry = Math.max(bounds.height / 2, 0.0001);
  const scale = 1 / Math.sqrt((dx * dx) / (rx * rx) + (dy * dy) / (ry * ry));
  return { x: center.x + dx * scale, y: center.y + dy * scale };
}

function stadiumBoundary(bounds: AnnotationBounds, toward: AnnotationPoint): AnnotationPoint {
  const center = boundsCenter(bounds);
  const radius = Math.min(bounds.height / 2, bounds.width / 2);
  const halfStraight = Math.max(0, bounds.width / 2 - radius);
  const dx = toward.x - center.x;
  const dy = toward.y - center.y;
  const capCenterX = center.x + Math.sign(dx) * halfStraight;
  if (Math.abs(dx) * radius >= Math.abs(dy) * Math.max(halfStraight, 0.0001)) {
    const capToward = { x: toward.x - capCenterX + center.x, y: toward.y };
    const local = ellipseBoundary(
      { x: center.x - radius, y: center.y - radius, width: radius * 2, height: radius * 2 },
      capToward,
    );
    return { x: local.x - center.x + capCenterX, y: local.y };
  }
  return rectangleBoundary(bounds, toward);
}

function polygonBoundary(
  center: AnnotationPoint,
  toward: AnnotationPoint,
  polygon: readonly AnnotationPoint[],
): AnnotationPoint {
  const rayEnd = {
    x: center.x + (toward.x - center.x) * 10_000,
    y: center.y + (toward.y - center.y) * 10_000,
  };
  let nearest: { point: AnnotationPoint; distance: number } | null = null;
  for (let index = 0; index < polygon.length; index += 1) {
    const start = polygon[index]!;
    const end = polygon[(index + 1) % polygon.length]!;
    const point = segmentIntersection(center, rayEnd, start, end);
    if (!point) continue;
    const distance = Math.hypot(point.x - center.x, point.y - center.y);
    if (!nearest || distance < nearest.distance) nearest = { point, distance };
  }
  return nearest?.point ?? center;
}

function segmentIntersection(
  a: AnnotationPoint,
  b: AnnotationPoint,
  c: AnnotationPoint,
  d: AnnotationPoint,
): AnnotationPoint | null {
  const denominator = (a.x - b.x) * (c.y - d.y) - (a.y - b.y) * (c.x - d.x);
  if (Math.abs(denominator) < 1e-9) return null;
  const t =
    ((a.x - c.x) * (c.y - d.y) - (a.y - c.y) * (c.x - d.x)) / denominator;
  const u =
    -((a.x - b.x) * (a.y - c.y) - (a.y - b.y) * (a.x - c.x)) /
    denominator;
  if (t < 0 || t > 1 || u < 0 || u > 1) return null;
  return { x: a.x + t * (b.x - a.x), y: a.y + t * (b.y - a.y) };
}

function actorBoundaryPolygon(bounds: AnnotationBounds): AnnotationPoint[] {
  return [
    { x: bounds.x + bounds.width * 0.5, y: bounds.y },
    { x: bounds.x + bounds.width * 0.65, y: bounds.y + bounds.height * 0.22 },
    { x: bounds.x + bounds.width * 0.82, y: bounds.y + bounds.height * 0.4 },
    { x: bounds.x + bounds.width * 0.62, y: bounds.y + bounds.height * 0.62 },
    { x: bounds.x + bounds.width * 0.72, y: bounds.y + bounds.height * 0.78 },
    { x: bounds.x + bounds.width * 0.28, y: bounds.y + bounds.height * 0.78 },
    { x: bounds.x + bounds.width * 0.38, y: bounds.y + bounds.height * 0.62 },
    { x: bounds.x + bounds.width * 0.18, y: bounds.y + bounds.height * 0.4 },
    { x: bounds.x + bounds.width * 0.35, y: bounds.y + bounds.height * 0.22 },
  ];
}
