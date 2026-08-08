import type {
  AnnotationBounds,
  AnnotationPoint,
  BoardState,
  Stroke,
} from "@airboard/core";
import {
  getConnectorRoutePoints,
  getRouteMidpoint,
} from "./connectorGeometry.ts";

const GEOMETRY_EPSILON = 0.001;
const CONNECTOR_LABEL_OFFSET_Y = -10;
const CONNECTOR_LABEL_LINE_HEIGHT = 15;
const CONNECTOR_LABEL_PADDING = 2;

export type DiagramSpatialConstraints = {
  /** Minimum edge-to-edge distance between every pair of committed nodes. */
  minimumNodeGap?: number;
  /** Reject intersecting node bounds even when minimumNodeGap is zero. */
  forbidNodeOverlap?: boolean;
  /** Reject a rendered connector route that intersects a non-endpoint node. */
  forbidConnectorThroughUnrelatedNodes?: boolean;
  /** Reject connector segments that occupy the same rendered line. */
  forbidCollinearConnectorOverlap?: boolean;
  /** Small shared endpoint stubs at or below this length remain acceptable. */
  maximumCollinearConnectorOverlap?: number;
  /** Reject an estimated connector-label box that intersects any node. */
  forbidConnectorLabelNodeOverlap?: boolean;
  /** Reject estimated connector-label boxes that intersect each other. */
  forbidConnectorLabelOverlap?: boolean;
  /** Reject an estimated connector-label box that intersects a connector route. */
  forbidConnectorLabelEdgeOverlap?: boolean;
};

export type DiagramSpatialViolationKind =
  | "node_overlap"
  | "node_clearance"
  | "connector_through_node"
  | "collinear_connector_overlap"
  | "connector_label_node_overlap"
  | "connector_label_overlap"
  | "connector_label_edge_overlap";

export type DiagramSpatialViolation = {
  kind: DiagramSpatialViolationKind;
  objectIds: string[];
  message: string;
  measured?: number;
  required?: number;
};

export type DiagramSpatialFacts = {
  nodes: SpatialNode[];
  connectors: SpatialConnector[];
  nodePairs: SpatialNodePair[];
  connectorNodeIntersections: SpatialConnectorNodeIntersection[];
  collinearConnectorOverlaps: SpatialConnectorOverlap[];
  connectorLabelNodeIntersections: SpatialConnectorLabelNodeIntersection[];
  connectorLabelIntersections: SpatialConnectorLabelIntersection[];
  connectorLabelEdgeIntersections: SpatialConnectorLabelEdgeIntersection[];
};

export type DiagramSpatialQuality = {
  pass: boolean;
  violations: DiagramSpatialViolation[];
  facts: DiagramSpatialFacts;
};

const SPATIAL_CONSTRAINT_KEYS = new Set<keyof DiagramSpatialConstraints>([
  "minimumNodeGap",
  "forbidNodeOverlap",
  "forbidConnectorThroughUnrelatedNodes",
  "forbidCollinearConnectorOverlap",
  "maximumCollinearConnectorOverlap",
  "forbidConnectorLabelNodeOverlap",
  "forbidConnectorLabelOverlap",
  "forbidConnectorLabelEdgeOverlap",
]);

type SpatialNode = {
  id: string;
  label: string | null;
  bounds: AnnotationBounds;
};

type SpatialConnector = {
  id: string;
  label: string | null;
  sourceId: string | null;
  targetId: string | null;
  route: AnnotationPoint[];
  labelBounds: AnnotationBounds | null;
};

type SpatialNodePair = {
  firstId: string;
  secondId: string;
  overlaps: boolean;
  clearance: number;
};

type SpatialConnectorNodeIntersection = {
  connectorId: string;
  nodeId: string;
};

type SpatialConnectorOverlap = {
  firstId: string;
  secondId: string;
  overlapLength: number;
};

type SpatialConnectorLabelNodeIntersection = {
  connectorId: string;
  nodeId: string;
};

type SpatialConnectorLabelIntersection = {
  firstId: string;
  secondId: string;
};

type SpatialConnectorLabelEdgeIntersection = {
  labelConnectorId: string;
  edgeConnectorId: string;
};

/**
 * Inspect the geometry that the production renderer consumes. The inspection
 * is constraint-free so one snapshot can be assessed against several eval
 * policies without retaining the complete BoardState.
 */
export function inspectBoardSpatialQuality(
  state: BoardState,
): DiagramSpatialFacts {
  const committed = Object.values(state.strokes).filter(
    (stroke) => stroke.status === "committed" && stroke.annotation,
  );
  const nodes = committed.flatMap((stroke): SpatialNode[] => {
    const annotation = stroke.annotation;
    if (
      !annotation?.bounds ||
      annotation.type === "connector" ||
      annotation.type === "arrow" ||
      annotation.type === "highlight" ||
      annotation.type === "pointer" ||
      annotation.type === "text_label" ||
      annotation.type === "cross_mark" ||
      annotation.type === "freehand" ||
      (annotation.groupMemberStrokeIds?.length ?? 0) > 0
    ) {
      return [];
    }
    return [{
      id: stroke.id,
      label: annotation.label?.trim() || null,
      bounds: normalizeBounds(annotation.bounds),
    }];
  });
  const connectors = committed.flatMap((stroke): SpatialConnector[] => {
    const annotation = stroke.annotation;
    if (
      !annotation ||
      (annotation.type !== "connector" && annotation.type !== "arrow") ||
      !annotation.start ||
      !annotation.end
    ) {
      return [];
    }
    const route = getConnectorRoutePoints(annotation).map(clonePoint);
    return [{
      id: stroke.id,
      label: annotation.label?.trim() || null,
      sourceId: annotation.snappedStartStrokeId ?? null,
      targetId: annotation.snappedEndStrokeId ?? null,
      route,
      labelBounds: connectorLabelBounds(stroke, route),
    }];
  });

  return {
    nodes,
    connectors,
    nodePairs: inspectNodePairs(nodes),
    connectorNodeIntersections: inspectConnectorNodeIntersections(
      connectors,
      nodes,
    ),
    collinearConnectorOverlaps: inspectCollinearConnectorOverlaps(connectors),
    connectorLabelNodeIntersections:
      inspectConnectorLabelNodeIntersections(connectors, nodes),
    connectorLabelIntersections:
      inspectConnectorLabelIntersections(connectors),
    connectorLabelEdgeIntersections:
      inspectConnectorLabelEdgeIntersections(connectors),
  };
}

export function assessBoardSpatialQuality(
  facts: DiagramSpatialFacts,
  constraints: DiagramSpatialConstraints,
): Omit<DiagramSpatialQuality, "facts"> {
  const violations: DiagramSpatialViolation[] = [];
  const minimumNodeGap = nonNegative(constraints.minimumNodeGap, 0);

  for (const pair of facts.nodePairs) {
    if (constraints.forbidNodeOverlap === true && pair.overlaps) {
      violations.push({
        kind: "node_overlap",
        objectIds: [pair.firstId, pair.secondId],
        message: `Nodes ${pair.firstId} and ${pair.secondId} overlap.`,
        measured: 0,
        required: minimumNodeGap,
      });
      continue;
    }
    if (pair.clearance + GEOMETRY_EPSILON < minimumNodeGap) {
      violations.push({
        kind: pair.overlaps ? "node_overlap" : "node_clearance",
        objectIds: [pair.firstId, pair.secondId],
        message:
          `Nodes ${pair.firstId} and ${pair.secondId} have ` +
          `${formatNumber(pair.clearance)} units of clearance; ` +
          `${formatNumber(minimumNodeGap)} are required.`,
        measured: pair.clearance,
        required: minimumNodeGap,
      });
    }
  }

  if (constraints.forbidConnectorThroughUnrelatedNodes === true) {
    for (const intersection of facts.connectorNodeIntersections) {
      violations.push({
        kind: "connector_through_node",
        objectIds: [intersection.connectorId, intersection.nodeId],
        message:
          `Connector ${intersection.connectorId} passes through unrelated ` +
          `node ${intersection.nodeId}.`,
      });
    }
  }

  if (constraints.forbidCollinearConnectorOverlap === true) {
    const maximumOverlap = nonNegative(
      constraints.maximumCollinearConnectorOverlap,
      0,
    );
    for (const overlap of facts.collinearConnectorOverlaps) {
      if (overlap.overlapLength <= maximumOverlap + GEOMETRY_EPSILON) {
        continue;
      }
      violations.push({
        kind: "collinear_connector_overlap",
        objectIds: [overlap.firstId, overlap.secondId],
        message:
          `Connectors ${overlap.firstId} and ${overlap.secondId} share ` +
          `${formatNumber(overlap.overlapLength)} rendered units; at most ` +
          `${formatNumber(maximumOverlap)} are allowed.`,
        measured: overlap.overlapLength,
        required: maximumOverlap,
      });
    }
  }

  if (constraints.forbidConnectorLabelNodeOverlap === true) {
    for (const intersection of facts.connectorLabelNodeIntersections) {
      violations.push({
        kind: "connector_label_node_overlap",
        objectIds: [intersection.connectorId, intersection.nodeId],
        message:
          `The label for connector ${intersection.connectorId} overlaps ` +
          `node ${intersection.nodeId}.`,
      });
    }
  }

  if (constraints.forbidConnectorLabelOverlap === true) {
    for (const intersection of facts.connectorLabelIntersections) {
      violations.push({
        kind: "connector_label_overlap",
        objectIds: [intersection.firstId, intersection.secondId],
        message:
          `Connector labels ${intersection.firstId} and ` +
          `${intersection.secondId} overlap.`,
      });
    }
  }

  if (constraints.forbidConnectorLabelEdgeOverlap === true) {
    for (const intersection of facts.connectorLabelEdgeIntersections) {
      violations.push({
        kind: "connector_label_edge_overlap",
        objectIds: [
          intersection.labelConnectorId,
          intersection.edgeConnectorId,
        ],
        message:
          `The label for connector ${intersection.labelConnectorId} ` +
          `overlaps route ${intersection.edgeConnectorId}.`,
      });
    }
  }

  return { pass: violations.length === 0, violations };
}

export function analyzeBoardSpatialQuality(
  state: BoardState,
  constraints: DiagramSpatialConstraints,
): DiagramSpatialQuality {
  const facts = inspectBoardSpatialQuality(state);
  return {
    ...assessBoardSpatialQuality(facts, constraints),
    facts,
  };
}

/** Shared corpus validation so audio and semantic runners cannot drift. */
export function diagramSpatialConstraintErrors(input: unknown): string[] {
  if (
    typeof input !== "object" ||
    input === null ||
    Array.isArray(input)
  ) {
    return ["must be an object"];
  }
  const errors: string[] = [];
  const entries = Object.entries(input);
  if (entries.length === 0) {
    errors.push("must declare at least one spatial invariant");
  }
  for (const [key, value] of entries) {
    if (!SPATIAL_CONSTRAINT_KEYS.has(key as keyof DiagramSpatialConstraints)) {
      errors.push(`contains unsupported key ${key}`);
      continue;
    }
    if (
      key === "minimumNodeGap" ||
      key === "maximumCollinearConnectorOverlap"
    ) {
      if (
        typeof value !== "number" ||
        !Number.isFinite(value) ||
        value < 0
      ) {
        errors.push(`${key} must be a finite non-negative number`);
      }
      continue;
    }
    if (typeof value !== "boolean") {
      errors.push(`${key} must be boolean`);
    }
  }
  return errors;
}

function inspectNodePairs(nodes: readonly SpatialNode[]): SpatialNodePair[] {
  const pairs: SpatialNodePair[] = [];
  for (let firstIndex = 0; firstIndex < nodes.length; firstIndex += 1) {
    const first = nodes[firstIndex];
    if (!first) continue;
    for (
      let secondIndex = firstIndex + 1;
      secondIndex < nodes.length;
      secondIndex += 1
    ) {
      const second = nodes[secondIndex];
      if (!second) continue;
      const horizontalGap = Math.max(
        second.bounds.x - right(first.bounds),
        first.bounds.x - right(second.bounds),
        0,
      );
      const verticalGap = Math.max(
        second.bounds.y - bottom(first.bounds),
        first.bounds.y - bottom(second.bounds),
        0,
      );
      pairs.push({
        firstId: first.id,
        secondId: second.id,
        overlaps:
          rangesOverlap(
            first.bounds.x,
            right(first.bounds),
            second.bounds.x,
            right(second.bounds),
          ) &&
          rangesOverlap(
            first.bounds.y,
            bottom(first.bounds),
            second.bounds.y,
            bottom(second.bounds),
          ),
        clearance: Math.hypot(horizontalGap, verticalGap),
      });
    }
  }
  return pairs;
}

function inspectConnectorNodeIntersections(
  connectors: readonly SpatialConnector[],
  nodes: readonly SpatialNode[],
): SpatialConnectorNodeIntersection[] {
  const intersections: SpatialConnectorNodeIntersection[] = [];
  for (const connector of connectors) {
    for (const node of nodes) {
      if (node.id === connector.sourceId || node.id === connector.targetId) {
        continue;
      }
      if (polylineIntersectsBounds(connector.route, node.bounds)) {
        intersections.push({ connectorId: connector.id, nodeId: node.id });
      }
    }
  }
  return intersections;
}

function inspectCollinearConnectorOverlaps(
  connectors: readonly SpatialConnector[],
): SpatialConnectorOverlap[] {
  const overlaps: SpatialConnectorOverlap[] = [];
  for (
    let firstIndex = 0;
    firstIndex < connectors.length;
    firstIndex += 1
  ) {
    const first = connectors[firstIndex];
    if (!first) continue;
    for (
      let secondIndex = firstIndex + 1;
      secondIndex < connectors.length;
      secondIndex += 1
    ) {
      const second = connectors[secondIndex];
      if (!second) continue;
      let overlapLength = 0;
      for (const firstSegment of segments(first.route)) {
        for (const secondSegment of segments(second.route)) {
          overlapLength += collinearOverlapLength(
            firstSegment.start,
            firstSegment.end,
            secondSegment.start,
            secondSegment.end,
          );
        }
      }
      if (overlapLength > GEOMETRY_EPSILON) {
        overlaps.push({
          firstId: first.id,
          secondId: second.id,
          overlapLength,
        });
      }
    }
  }
  return overlaps;
}

function inspectConnectorLabelNodeIntersections(
  connectors: readonly SpatialConnector[],
  nodes: readonly SpatialNode[],
): SpatialConnectorLabelNodeIntersection[] {
  const intersections: SpatialConnectorLabelNodeIntersection[] = [];
  for (const connector of connectors) {
    if (!connector.labelBounds) continue;
    for (const node of nodes) {
      if (boundsIntersect(connector.labelBounds, node.bounds)) {
        intersections.push({ connectorId: connector.id, nodeId: node.id });
      }
    }
  }
  return intersections;
}

function inspectConnectorLabelIntersections(
  connectors: readonly SpatialConnector[],
): SpatialConnectorLabelIntersection[] {
  const intersections: SpatialConnectorLabelIntersection[] = [];
  for (
    let firstIndex = 0;
    firstIndex < connectors.length;
    firstIndex += 1
  ) {
    const first = connectors[firstIndex];
    if (!first?.labelBounds) continue;
    for (
      let secondIndex = firstIndex + 1;
      secondIndex < connectors.length;
      secondIndex += 1
    ) {
      const second = connectors[secondIndex];
      if (
        second?.labelBounds &&
        boundsIntersect(first.labelBounds, second.labelBounds)
      ) {
        intersections.push({ firstId: first.id, secondId: second.id });
      }
    }
  }
  return intersections;
}

function inspectConnectorLabelEdgeIntersections(
  connectors: readonly SpatialConnector[],
): SpatialConnectorLabelEdgeIntersection[] {
  const intersections: SpatialConnectorLabelEdgeIntersection[] = [];
  for (const labelConnector of connectors) {
    if (!labelConnector.labelBounds) continue;
    for (const edgeConnector of connectors) {
      if (
        polylineIntersectsBounds(
          edgeConnector.route,
          labelConnector.labelBounds,
        )
      ) {
        intersections.push({
          labelConnectorId: labelConnector.id,
          edgeConnectorId: edgeConnector.id,
        });
      }
    }
  }
  return intersections;
}

/**
 * Conservative deterministic approximation of the renderer's 13px semibold
 * connector labels. Exact font metrics vary by host, but midpoint-in-node and
 * duplicate-anchor failures remain stable across fonts.
 */
function connectorLabelBounds(
  stroke: Stroke,
  route: readonly AnnotationPoint[],
): AnnotationBounds | null {
  const annotation = stroke.annotation;
  const label = annotation?.label?.trim();
  if (!annotation?.start || !annotation.end || !label) return null;
  const midpoint = getRouteMidpoint(route);
  if (!midpoint) return null;
  const maxWidth = Math.max(
    Math.abs(annotation.end.x - annotation.start.x),
    72,
  );
  const lines = wrapEstimatedLabel(label, maxWidth).slice(0, 2);
  if (lines.length === 0) return null;
  const width = Math.max(
    ...lines.map((line) => Math.min(maxWidth, estimateTextWidth(line))),
  );
  const height = lines.length * CONNECTOR_LABEL_LINE_HEIGHT;
  return {
    x: midpoint.x - width / 2 - CONNECTOR_LABEL_PADDING,
    y:
      midpoint.y +
      CONNECTOR_LABEL_OFFSET_Y -
      height / 2 -
      CONNECTOR_LABEL_PADDING,
    width: width + CONNECTOR_LABEL_PADDING * 2,
    height: height + CONNECTOR_LABEL_PADDING * 2,
  };
}

function wrapEstimatedLabel(label: string, maxWidth: number): string[] {
  const lines: string[] = [];
  let current = "";
  for (const word of label.split(/\s+/u).filter(Boolean)) {
    const next = current ? `${current} ${word}` : word;
    if (current && estimateTextWidth(next) > maxWidth) {
      lines.push(current);
      current = word;
    } else {
      current = next;
    }
  }
  if (current) lines.push(current);
  return lines;
}

function estimateTextWidth(value: string): number {
  let width = 0;
  for (const character of value) {
    if (character === " ") width += 3.5;
    else if (/[ilI1.,'|]/u.test(character)) width += 3.7;
    else if (/[MW@#%]/u.test(character)) width += 9.4;
    else if (/[A-Z0-9]/u.test(character)) width += 7.8;
    else width += 7;
  }
  return Math.max(width, 1);
}

function polylineIntersectsBounds(
  points: readonly AnnotationPoint[],
  bounds: AnnotationBounds,
): boolean {
  return segments(points).some(({ start, end }) =>
    segmentIntersectsBounds(start, end, bounds),
  );
}

function segmentIntersectsBounds(
  start: AnnotationPoint,
  end: AnnotationPoint,
  bounds: AnnotationBounds,
): boolean {
  const normalized = normalizeBounds(bounds);
  if (pointInsideBounds(start, normalized) || pointInsideBounds(end, normalized)) {
    return true;
  }
  const corners = [
    { x: normalized.x, y: normalized.y },
    { x: right(normalized), y: normalized.y },
    { x: right(normalized), y: bottom(normalized) },
    { x: normalized.x, y: bottom(normalized) },
  ];
  return corners.some((corner, index) =>
    segmentsIntersect(
      start,
      end,
      corner,
      corners[(index + 1) % corners.length] as AnnotationPoint,
    ),
  );
}

function segmentsIntersect(
  firstStart: AnnotationPoint,
  firstEnd: AnnotationPoint,
  secondStart: AnnotationPoint,
  secondEnd: AnnotationPoint,
): boolean {
  const orientationOne = orientation(firstStart, firstEnd, secondStart);
  const orientationTwo = orientation(firstStart, firstEnd, secondEnd);
  const orientationThree = orientation(secondStart, secondEnd, firstStart);
  const orientationFour = orientation(secondStart, secondEnd, firstEnd);
  if (
    orientationOne * orientationTwo < -GEOMETRY_EPSILON &&
    orientationThree * orientationFour < -GEOMETRY_EPSILON
  ) {
    return true;
  }
  return (
    (Math.abs(orientationOne) <= GEOMETRY_EPSILON &&
      pointOnSegment(secondStart, firstStart, firstEnd)) ||
    (Math.abs(orientationTwo) <= GEOMETRY_EPSILON &&
      pointOnSegment(secondEnd, firstStart, firstEnd)) ||
    (Math.abs(orientationThree) <= GEOMETRY_EPSILON &&
      pointOnSegment(firstStart, secondStart, secondEnd)) ||
    (Math.abs(orientationFour) <= GEOMETRY_EPSILON &&
      pointOnSegment(firstEnd, secondStart, secondEnd))
  );
}

function collinearOverlapLength(
  firstStart: AnnotationPoint,
  firstEnd: AnnotationPoint,
  secondStart: AnnotationPoint,
  secondEnd: AnnotationPoint,
): number {
  const dx = firstEnd.x - firstStart.x;
  const dy = firstEnd.y - firstStart.y;
  const length = Math.hypot(dx, dy);
  const secondLength = Math.hypot(
    secondEnd.x - secondStart.x,
    secondEnd.y - secondStart.y,
  );
  if (length <= GEOMETRY_EPSILON || secondLength <= GEOMETRY_EPSILON) {
    return 0;
  }
  if (
    distanceFromLine(secondStart, firstStart, firstEnd) >
      GEOMETRY_EPSILON ||
    distanceFromLine(secondEnd, firstStart, firstEnd) >
      GEOMETRY_EPSILON
  ) {
    return 0;
  }
  const unitX = dx / length;
  const unitY = dy / length;
  const secondProjectionStart =
    (secondStart.x - firstStart.x) * unitX +
    (secondStart.y - firstStart.y) * unitY;
  const secondProjectionEnd =
    (secondEnd.x - firstStart.x) * unitX +
    (secondEnd.y - firstStart.y) * unitY;
  const overlapStart = Math.max(
    0,
    Math.min(secondProjectionStart, secondProjectionEnd),
  );
  const overlapEnd = Math.min(
    length,
    Math.max(secondProjectionStart, secondProjectionEnd),
  );
  return Math.max(0, overlapEnd - overlapStart);
}

function distanceFromLine(
  point: AnnotationPoint,
  start: AnnotationPoint,
  end: AnnotationPoint,
): number {
  const length = Math.hypot(end.x - start.x, end.y - start.y);
  if (length <= GEOMETRY_EPSILON) {
    return Math.hypot(point.x - start.x, point.y - start.y);
  }
  return (
    Math.abs(
      (end.x - start.x) * (start.y - point.y) -
      (start.x - point.x) * (end.y - start.y),
    ) / length
  );
}

function segments(
  points: readonly AnnotationPoint[],
): Array<{ start: AnnotationPoint; end: AnnotationPoint }> {
  const result: Array<{ start: AnnotationPoint; end: AnnotationPoint }> = [];
  for (let index = 1; index < points.length; index += 1) {
    const start = points[index - 1];
    const end = points[index];
    if (
      start &&
      end &&
      Math.hypot(end.x - start.x, end.y - start.y) > GEOMETRY_EPSILON
    ) {
      result.push({ start, end });
    }
  }
  return result;
}

function pointInsideBounds(
  point: AnnotationPoint,
  bounds: AnnotationBounds,
): boolean {
  return (
    point.x >= bounds.x - GEOMETRY_EPSILON &&
    point.x <= right(bounds) + GEOMETRY_EPSILON &&
    point.y >= bounds.y - GEOMETRY_EPSILON &&
    point.y <= bottom(bounds) + GEOMETRY_EPSILON
  );
}

function boundsIntersect(
  first: AnnotationBounds,
  second: AnnotationBounds,
): boolean {
  return (
    first.x <= right(second) + GEOMETRY_EPSILON &&
    right(first) >= second.x - GEOMETRY_EPSILON &&
    first.y <= bottom(second) + GEOMETRY_EPSILON &&
    bottom(first) >= second.y - GEOMETRY_EPSILON
  );
}

function rangesOverlap(
  firstStart: number,
  firstEnd: number,
  secondStart: number,
  secondEnd: number,
): boolean {
  return (
    firstStart < secondEnd - GEOMETRY_EPSILON &&
    firstEnd > secondStart + GEOMETRY_EPSILON
  );
}

function orientation(
  first: AnnotationPoint,
  second: AnnotationPoint,
  third: AnnotationPoint,
): number {
  return (
    (second.x - first.x) * (third.y - first.y) -
    (second.y - first.y) * (third.x - first.x)
  );
}

function pointOnSegment(
  point: AnnotationPoint,
  start: AnnotationPoint,
  end: AnnotationPoint,
): boolean {
  return (
    point.x >= Math.min(start.x, end.x) - GEOMETRY_EPSILON &&
    point.x <= Math.max(start.x, end.x) + GEOMETRY_EPSILON &&
    point.y >= Math.min(start.y, end.y) - GEOMETRY_EPSILON &&
    point.y <= Math.max(start.y, end.y) + GEOMETRY_EPSILON
  );
}

function normalizeBounds(bounds: AnnotationBounds): AnnotationBounds {
  return {
    x: bounds.width >= 0 ? bounds.x : bounds.x + bounds.width,
    y: bounds.height >= 0 ? bounds.y : bounds.y + bounds.height,
    width: Math.abs(bounds.width),
    height: Math.abs(bounds.height),
  };
}

function clonePoint(point: AnnotationPoint): AnnotationPoint {
  return { x: point.x, y: point.y };
}

function right(bounds: AnnotationBounds): number {
  return bounds.x + bounds.width;
}

function bottom(bounds: AnnotationBounds): number {
  return bounds.y + bounds.height;
}

function nonNegative(value: number | undefined, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : fallback;
}

function formatNumber(value: number): string {
  return Number(value.toFixed(2)).toString();
}
