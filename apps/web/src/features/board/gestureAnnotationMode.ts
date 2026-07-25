import {
  nodeVisualDefaultSize,
  nodeVisualCapability,
  pointOnNodeBoundary,
  type AnnotationBounds,
  type AnnotationNodeType,
  type AnnotationPoint,
  type BoardState,
  type Stroke,
  type StrokeAnnotation,
  type StrokePoint,
} from "@airboard/core";

export type AnnotationIntent =
  | "pointer"
  | "circle"
  | "arrow"
  | "highlight"
  | "box"
  | "flow_node"
  | "connector"
  | "erase"
  | "select"
  | "cancel"
  | "unknown";

export type GestureAnnotationResult = {
  intent: AnnotationIntent;
  confidence: number;
  points: StrokePoint[];
  annotation: StrokeAnnotation;
  color: string;
  thickness: number;
  needsLabel: boolean;
};

type GestureMetrics = {
  points: StrokePoint[];
  bounds: AnnotationBounds;
  start: StrokePoint;
  end: StrokePoint;
  pathLength: number;
  directDistance: number;
  closureRatio: number;
  averageLineError: number;
  directionChanges: number;
  axisAlignedRatio: number;
  aspectRatio: number;
};

type NodeCandidate = {
  strokeId: string;
  bounds: AnnotationBounds;
  nodeType?: AnnotationNodeType;
};

export type ObjectDockTool =
  | "select"
  | "flow"
  | "service"
  | "database"
  | "queue"
  | "user"
  | "api"
  | "decision"
  | "terminator"
  | "io"
  | "document"
  | "note"
  | "circle"
  | "box"
  | "arrow"
  | "highlight"
  | "connector"
  | "eraser";

export type AnnotationResizeHandle =
  | "nw"
  | "ne"
  | "sw"
  | "se"
  | "start"
  | "end";

export type AnnotationRenderObject = {
  annotation: StrokeAnnotation;
  points: StrokePoint[];
  color: string;
  thickness: number;
};

export type AlignmentGuide = {
  axis: "x" | "y";
  position: number;
  kind: "object" | "grid";
};

export type AnnotationUpdate = {
  strokeId: string;
  annotation: StrokeAnnotation;
};

const MIN_OBJECT_SIZE_PX = 28;
const NODE_SNAP_THRESHOLD_PX = 52;
const DEFAULT_HIGHLIGHT_WIDTH = 168;
const DEFAULT_HIGHLIGHT_HEIGHT = 26;
const DEFAULT_ARROW_LENGTH = 148;

export function isPlacementTool(tool: ObjectDockTool): boolean {
  return tool !== "select" && tool !== "eraser";
}

export function createObjectFromPlacement(input: {
  tool: ObjectDockTool;
  start: AnnotationPoint;
  end?: AnnotationPoint;
  boardState: BoardState;
  color: string;
  autoSnapConnectors?: boolean;
  timestampMs?: number;
}): GestureAnnotationResult | null {
  if (!isPlacementTool(input.tool)) {
    return null;
  }

  const timestampMs = input.timestampMs ?? Date.now();
  const center = input.end ?? input.start;
  const nodeType = nodeTypeForTool(input.tool);
  if (nodeType) {
    const bounds = nodeBoundsForType(nodeType, center);
    const label = defaultLabelForNodeType(nodeType);
    const annotation: StrokeAnnotation = {
      type: nodeType === "circle" ? "ellipse" : "flow_node",
      source: "gesture",
      confidence: 1,
      bounds,
      nodeType,
      strokeColor: input.color,
      fillColor: nodeType === "note" ? "#fef9c3" : "#f8fafc",
    };
    if (label) {
      annotation.label = label;
    }
    return buildResult({
      intent: "flow_node",
      confidence: 1,
      points: buildAnnotationPoints(annotation, timestampMs),
      color: input.color,
      thickness: 3,
      annotation,
      needsLabel: true,
    });
  }

  if (input.tool === "highlight") {
    const bounds = centeredBounds(center, DEFAULT_HIGHLIGHT_WIDTH, DEFAULT_HIGHLIGHT_HEIGHT);
    const annotation: StrokeAnnotation = {
      type: "highlight",
      source: "gesture",
      confidence: 1,
      bounds,
      fillColor: "#fde047",
      strokeColor: "rgba(202, 138, 4, 0.42)",
      opacity: 0.34,
    };
    return buildResult({
      intent: "highlight",
      confidence: 1,
      points: buildAnnotationPoints(annotation, timestampMs),
      color: "#eab308",
      thickness: 2,
      annotation,
      needsLabel: false,
    });
  }

  if (input.tool === "arrow" || input.tool === "connector") {
    const fallbackEnd = {
      x: input.start.x + DEFAULT_ARROW_LENGTH,
      y: input.start.y,
    };
    const end = input.end && distance(input.start, input.end) >= 12 ? input.end : fallbackEnd;
    const annotation: StrokeAnnotation = {
      type: input.tool,
      source: "gesture",
      confidence: 1,
      start: pointOf(input.start),
      end: pointOf(end),
      strokeColor: input.color,
    };
    if (input.tool === "connector" && input.autoSnapConnectors !== false) {
      snapConnectorAnnotation(annotation, input.boardState);
    }
    return buildResult({
      intent: input.tool,
      confidence: 1,
      points: buildAnnotationPoints(annotation, timestampMs),
      color: input.color,
      thickness: 3,
      annotation,
      needsLabel: input.tool === "connector",
    });
  }

  return null;
}

export function buildAnnotationPoints(
  annotation: StrokeAnnotation,
  timestampMs = Date.now(),
): StrokePoint[] {
  if (
    (annotation.type === "ellipse" || annotation.type === "pointer") &&
    annotation.bounds
  ) {
    return ellipsePoints(annotation.bounds, timestampMs);
  }

  if (
    (annotation.type === "rectangle" ||
      annotation.type === "flow_node" ||
      annotation.type === "sticky_note" ||
      annotation.type === "highlight") &&
    annotation.bounds
  ) {
    return rectanglePoints(annotation.bounds, timestampMs);
  }

  if (
    (annotation.type === "arrow" || annotation.type === "connector") &&
    annotation.start &&
    annotation.end
  ) {
    return linePoints(annotation.start, annotation.end, timestampMs);
  }

  return [];
}

export function translateAnnotation(
  annotation: StrokeAnnotation,
  dx: number,
  dy: number,
): StrokeAnnotation {
  const updated: StrokeAnnotation = { ...annotation };
  if (annotation.bounds) {
    updated.bounds = {
      x: annotation.bounds.x + dx,
      y: annotation.bounds.y + dy,
      width: annotation.bounds.width,
      height: annotation.bounds.height,
    };
  }
  if (annotation.start) {
    updated.start = {
      x: annotation.start.x + dx,
      y: annotation.start.y + dy,
    };
  }
  if (annotation.end) {
    updated.end = {
      x: annotation.end.x + dx,
      y: annotation.end.y + dy,
    };
  }
  return updated;
}

export function snapAnnotationToBoard(input: {
  annotation: StrokeAnnotation;
  boardState: BoardState;
  excludeStrokeId?: string;
  thresholdPx?: number;
  gridSizePx?: number;
}): { annotation: StrokeAnnotation; guides: AlignmentGuide[] } {
  const bounds = input.annotation.bounds;
  if (!bounds) {
    return { annotation: input.annotation, guides: [] };
  }

  const thresholdPx = input.thresholdPx ?? 9;
  const gridSizePx = input.gridSizePx ?? 16;
  const xAnchors = [bounds.x, bounds.x + bounds.width / 2, bounds.x + bounds.width];
  const yAnchors = [bounds.y, bounds.y + bounds.height / 2, bounds.y + bounds.height];
  const candidateX: number[] = [];
  const candidateY: number[] = [];

  for (const stroke of Object.values(input.boardState.strokes)) {
    if (
      stroke.id === input.excludeStrokeId ||
      stroke.status !== "committed" ||
      !stroke.annotation?.bounds
    ) {
      continue;
    }

    const candidateBounds = stroke.annotation.bounds;
    candidateX.push(
      candidateBounds.x,
      candidateBounds.x + candidateBounds.width / 2,
      candidateBounds.x + candidateBounds.width,
    );
    candidateY.push(
      candidateBounds.y,
      candidateBounds.y + candidateBounds.height / 2,
      candidateBounds.y + candidateBounds.height,
    );
  }

  const xSnap = nearestAnchorDelta(xAnchors, candidateX, thresholdPx);
  const ySnap = nearestAnchorDelta(yAnchors, candidateY, thresholdPx);
  const gridX = nearestGridDelta(bounds.x + bounds.width / 2, gridSizePx, thresholdPx / 2);
  const gridY = nearestGridDelta(bounds.y + bounds.height / 2, gridSizePx, thresholdPx / 2);
  const dx = xSnap?.delta ?? gridX?.delta ?? 0;
  const dy = ySnap?.delta ?? gridY?.delta ?? 0;
  const guides: AlignmentGuide[] = [];

  if (xSnap) {
    guides.push({ axis: "x", position: xSnap.position, kind: "object" });
  } else if (gridX) {
    guides.push({ axis: "x", position: gridX.position, kind: "grid" });
  }
  if (ySnap) {
    guides.push({ axis: "y", position: ySnap.position, kind: "object" });
  } else if (gridY) {
    guides.push({ axis: "y", position: gridY.position, kind: "grid" });
  }

  return {
    annotation: dx === 0 && dy === 0 ? input.annotation : translateAnnotation(input.annotation, dx, dy),
    guides,
  };
}

export function getBoundConnectorUpdates(input: {
  boardState: BoardState;
  nodeStrokeId: string;
  previousAnnotation: StrokeAnnotation;
  nextAnnotation: StrokeAnnotation;
}): AnnotationUpdate[] {
  const previousBounds = input.previousAnnotation.bounds;
  const nextBounds = input.nextAnnotation.bounds;
  if (!previousBounds || !nextBounds) {
    return [];
  }

  const updates: AnnotationUpdate[] = [];
  for (const stroke of Object.values(input.boardState.strokes)) {
    const connector = stroke.annotation;
    if (
      stroke.status !== "committed" ||
      connector?.type !== "connector" ||
      !connector.start ||
      !connector.end
    ) {
      continue;
    }

    let changed = false;
    const annotation: StrokeAnnotation = { ...connector };
    const startMoved = connector.snappedStartStrokeId === input.nodeStrokeId;
    const endMoved = connector.snappedEndStrokeId === input.nodeStrokeId;
    if (startMoved || endMoved) {
      const startBounds = startMoved
        ? nextBounds
        : connector.snappedStartStrokeId
          ? input.boardState.strokes[connector.snappedStartStrokeId]?.annotation?.bounds
          : undefined;
      const endBounds = endMoved
        ? nextBounds
        : connector.snappedEndStrokeId
          ? input.boardState.strokes[connector.snappedEndStrokeId]?.annotation?.bounds
          : undefined;
      const startNodeType = startMoved
        ? input.boardState.strokes[input.nodeStrokeId]?.annotation?.nodeType
        : connector.snappedStartStrokeId
          ? input.boardState.strokes[connector.snappedStartStrokeId]?.annotation?.nodeType
          : undefined;
      const endNodeType = endMoved
        ? input.boardState.strokes[input.nodeStrokeId]?.annotation?.nodeType
        : connector.snappedEndStrokeId
          ? input.boardState.strokes[connector.snappedEndStrokeId]?.annotation?.nodeType
          : undefined;

      if (startBounds && endBounds) {
        const endpoints = connectorEndpoints(
          startBounds,
          endBounds,
          startNodeType,
          endNodeType,
        );
        annotation.start = endpoints.start;
        annotation.end = endpoints.end;
      } else {
        // Only one end is bound to a node. Keep that endpoint on the moved
        // node's edge facing the fixed endpoint, rather than remapping it
        // proportionally inside the box (which drifts it across the node face).
        if (startMoved) {
          annotation.start = pointOnNodeBoundary(nextBounds, startNodeType, connector.end);
        }
        if (endMoved) {
          annotation.end = pointOnNodeBoundary(nextBounds, endNodeType, connector.start);
        }
      }
      changed = true;
    }

    if (changed) {
      updates.push({ strokeId: stroke.id, annotation });
    }
  }
  return updates;
}

export function resizeBoundsAnnotation(
  annotation: StrokeAnnotation,
  handle: Exclude<AnnotationResizeHandle, "start" | "end">,
  point: AnnotationPoint,
): StrokeAnnotation {
  const bounds = annotation.bounds;
  if (!bounds) {
    return annotation;
  }

  const right = bounds.x + bounds.width;
  const bottom = bounds.y + bounds.height;
  const fixed = {
    x: handle.includes("w") ? right : bounds.x,
    y: handle.includes("n") ? bottom : bounds.y,
  };
  const resized = normalizeBounds(fixed, point, minimumSizeForAnnotation(annotation));
  return {
    ...annotation,
    bounds: resized,
  };
}

export function updateLineEndpoint(input: {
  annotation: StrokeAnnotation;
  endpoint: Extract<AnnotationResizeHandle, "start" | "end">;
  point: AnnotationPoint;
  boardState?: BoardState;
  autoSnapConnectors?: boolean;
}): StrokeAnnotation {
  const updated: StrokeAnnotation = {
    ...input.annotation,
  };
  const snapped =
    input.annotation.type === "connector" &&
    input.boardState &&
    input.autoSnapConnectors !== false
      ? findNearestNode(input.boardState, input.point, NODE_SNAP_THRESHOLD_PX)
      : null;
  const nextPoint = snapped
    ? pointOnNodeBoundary(snapped.bounds, snapped.nodeType, input.point)
    : pointOf(input.point);

  if (input.endpoint === "start") {
    updated.start = nextPoint;
    if (snapped) {
      updated.snappedStartStrokeId = snapped.strokeId;
    } else {
      delete updated.snappedStartStrokeId;
    }
  } else {
    updated.end = nextPoint;
    if (snapped) {
      updated.snappedEndStrokeId = snapped.strokeId;
    } else {
      delete updated.snappedEndStrokeId;
    }
  }

  return updated;
}

export function annotationNeedsLabel(annotation: StrokeAnnotation): boolean {
  return (
    annotation.type === "flow_node" ||
    annotation.type === "connector" ||
    annotation.type === "sticky_note"
  );
}

export function getAnnotationLabelAnchor(annotation: StrokeAnnotation): AnnotationPoint | null {
  if (annotation.bounds) {
    return {
      x: annotation.bounds.x + annotation.bounds.width / 2,
      y: annotation.bounds.y - 12,
    };
  }
  if (annotation.start && annotation.end) {
    return {
      x: (annotation.start.x + annotation.end.x) / 2,
      y: (annotation.start.y + annotation.end.y) / 2 - 22,
    };
  }
  return null;
}

export function createAnnotationFromGesture(input: {
  points: readonly StrokePoint[];
  boardState: BoardState;
  color: string;
  autoSnapConnectors?: boolean;
}): GestureAnnotationResult | null {
  const metrics = getGestureMetrics(input.points);
  if (!metrics) {
    return null;
  }

  const color = input.color;
  const { bounds, start, end, pathLength, directDistance } = metrics;
  const closed =
    metrics.closureRatio <= 0.28 &&
    bounds.width >= MIN_OBJECT_SIZE_PX &&
    bounds.height >= MIN_OBJECT_SIZE_PX * 0.75 &&
    pathLength >= 80;
  const lineLike =
    directDistance >= 46 &&
    metrics.averageLineError <= Math.max(14, directDistance * 0.14) &&
    pathLength <= directDistance * 1.42;

  if (closed) {
    const paddedBounds = padBounds(bounds, 8, 54, 40);
    if (looksLikeFlowNode(metrics)) {
      return buildResult({
        intent: "flow_node",
        confidence: 0.78,
        points: rectanglePoints(paddedBounds, start.t),
        color,
        thickness: 3,
        annotation: {
          type: "flow_node",
          source: "gesture",
          confidence: 0.78,
          bounds: paddedBounds,
          nodeType: "process",
          strokeColor: color,
          fillColor: "#f8fafc",
        },
        needsLabel: true,
      });
    }

    return buildResult({
      intent: "circle",
      confidence: 0.76,
      points: ellipsePoints(paddedBounds, start.t),
      color,
      thickness: 3,
      annotation: {
        type: "ellipse",
        source: "gesture",
        confidence: 0.76,
        bounds: paddedBounds,
        strokeColor: color,
      },
      needsLabel: false,
    });
  }

  if (lineLike) {
    const startNode =
      input.autoSnapConnectors === false
        ? null
        : findNearestNode(input.boardState, start, NODE_SNAP_THRESHOLD_PX);
    const endNode =
      input.autoSnapConnectors === false
        ? null
        : findNearestNode(input.boardState, end, NODE_SNAP_THRESHOLD_PX);
    if (startNode && endNode && startNode.strokeId !== endNode.strokeId) {
      const snappedStart = pointOnNodeBoundary(
        startNode.bounds,
        startNode.nodeType,
        pointOf(start),
      );
      const snappedEnd = pointOnNodeBoundary(
        endNode.bounds,
        endNode.nodeType,
        pointOf(end),
      );
      return buildResult({
        intent: "connector",
        confidence: 0.82,
        points: linePoints(snappedStart, snappedEnd, start.t),
        color,
        thickness: 3,
        annotation: {
          type: "connector",
          source: "gesture",
          confidence: 0.82,
          start: snappedStart,
          end: snappedEnd,
          snappedStartStrokeId: startNode.strokeId,
          snappedEndStrokeId: endNode.strokeId,
          strokeColor: color,
        },
        needsLabel: true,
      });
    }

    if (looksLikeHighlight(metrics)) {
      const highlightBounds = padBounds(bounds, 6, 40, 14);
      return buildResult({
        intent: "highlight",
        confidence: 0.72,
        points: rectanglePoints(highlightBounds, start.t),
        color: "#eab308",
        thickness: 2,
        annotation: {
          type: "highlight",
          source: "gesture",
          confidence: 0.72,
          bounds: highlightBounds,
          fillColor: "#fde047",
          strokeColor: "rgba(202, 138, 4, 0.42)",
          opacity: 0.34,
        },
        needsLabel: false,
      });
    }

    return buildResult({
      intent: "arrow",
      confidence: 0.74,
      points: linePoints(start, end, start.t),
      color,
      thickness: 3,
      annotation: {
        type: "arrow",
        source: "gesture",
        confidence: 0.74,
        start: pointOf(start),
        end: pointOf(end),
        strokeColor: color,
      },
      needsLabel: false,
    });
  }

  if (looksLikeHighlight(metrics)) {
    const highlightBounds = padBounds(bounds, 6, 40, 14);
    return buildResult({
      intent: "highlight",
      confidence: 0.68,
      points: rectanglePoints(highlightBounds, start.t),
      color: "#eab308",
      thickness: 2,
      annotation: {
        type: "highlight",
        source: "gesture",
        confidence: 0.68,
        bounds: highlightBounds,
        fillColor: "#fde047",
        strokeColor: "rgba(202, 138, 4, 0.42)",
        opacity: 0.34,
      },
      needsLabel: false,
    });
  }

  return null;
}

export function createPaletteNode(input: {
  boardState: BoardState;
  nodeType: AnnotationNodeType;
  center: AnnotationPoint;
  color: string;
}): GestureAnnotationResult {
  const bounds = nodeBoundsForType(input.nodeType, input.center);
  const label = defaultLabelForNodeType(input.nodeType);
  return buildResult({
    intent: "flow_node",
    confidence: 1,
    points: rectanglePoints(bounds, Date.now()),
    color: input.color,
    thickness: 3,
    annotation: {
      type: "flow_node",
      source: "gesture",
      confidence: 1,
      bounds,
      nodeType: input.nodeType,
      label,
      strokeColor: input.color,
      fillColor: input.nodeType === "note" ? "#fef9c3" : "#f8fafc",
    },
    needsLabel: true,
  });
}

function buildResult(input: GestureAnnotationResult): GestureAnnotationResult {
  return input;
}

function nodeTypeForTool(tool: ObjectDockTool): AnnotationNodeType | null {
  switch (tool) {
    case "flow":
      return "process";
    case "service":
      return "service";
    case "database":
      return "database";
    case "queue":
      return "queue";
    case "user":
      return "user";
    case "api":
      return "api";
    case "decision":
      return "decision";
    case "terminator":
      return "terminator";
    case "io":
      return "io";
    case "document":
      return "document";
    case "note":
      return "note";
    case "circle":
      return "circle";
    case "box":
      return "custom";
    case "select":
    case "arrow":
    case "highlight":
    case "connector":
    case "eraser":
      return null;
  }
}

function centeredBounds(center: AnnotationPoint, width: number, height: number): AnnotationBounds {
  return {
    x: center.x - width / 2,
    y: center.y - height / 2,
    width,
    height,
  };
}

function nearestAnchorDelta(
  movingAnchors: readonly number[],
  candidateAnchors: readonly number[],
  thresholdPx: number,
): { delta: number; position: number } | null {
  let best: { delta: number; position: number } | null = null;
  for (const movingAnchor of movingAnchors) {
    for (const candidateAnchor of candidateAnchors) {
      const delta = candidateAnchor - movingAnchor;
      if (Math.abs(delta) > thresholdPx || (best && Math.abs(delta) >= Math.abs(best.delta))) {
        continue;
      }
      best = { delta, position: candidateAnchor };
    }
  }
  return best;
}

function nearestGridDelta(
  value: number,
  gridSizePx: number,
  thresholdPx: number,
): { delta: number; position: number } | null {
  const position = Math.round(value / gridSizePx) * gridSizePx;
  const delta = position - value;
  return Math.abs(delta) <= thresholdPx ? { delta, position } : null;
}

function connectorEndpoints(
  from: AnnotationBounds,
  to: AnnotationBounds,
  fromNodeType?: AnnotationNodeType,
  toNodeType?: AnnotationNodeType,
): { start: AnnotationPoint; end: AnnotationPoint } {
  const fromCenter = boundsCenter(from);
  const toCenter = boundsCenter(to);
  if (fromCenter.x === toCenter.x && fromCenter.y === toCenter.y) {
    return {
      start: { x: from.x + from.width, y: fromCenter.y },
      end: { x: to.x, y: toCenter.y },
    };
  }
  return {
    start: pointOnNodeBoundary(from, fromNodeType, toCenter),
    end: pointOnNodeBoundary(to, toNodeType, fromCenter),
  };
}

function boundsCenter(bounds: AnnotationBounds): AnnotationPoint {
  return {
    x: bounds.x + bounds.width / 2,
    y: bounds.y + bounds.height / 2,
  };
}

function normalizeBounds(
  a: AnnotationPoint,
  b: AnnotationPoint,
  minimumSize: { width: number; height: number },
): AnnotationBounds {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  const width = Math.max(Math.abs(a.x - b.x), minimumSize.width);
  const height = Math.max(Math.abs(a.y - b.y), minimumSize.height);
  return {
    x: a.x <= b.x ? x : a.x - width,
    y: a.y <= b.y ? y : a.y - height,
    width,
    height,
  };
}

function minimumSizeForAnnotation(annotation: StrokeAnnotation): { width: number; height: number } {
  if (annotation.type === "highlight") {
    return { width: 40, height: 14 };
  }
  if (annotation.nodeType === "decision") {
    return { width: 70, height: 54 };
  }
  return { width: 54, height: 40 };
}

function snapConnectorAnnotation(annotation: StrokeAnnotation, boardState: BoardState): void {
  if (!annotation.start || !annotation.end) {
    return;
  }

  const startNode = findNearestNode(boardState, annotation.start, NODE_SNAP_THRESHOLD_PX);
  if (startNode) {
    annotation.start = pointOnNodeBoundary(
      startNode.bounds,
      startNode.nodeType,
      annotation.start,
    );
    annotation.snappedStartStrokeId = startNode.strokeId;
  }

  const endNode = findNearestNode(boardState, annotation.end, NODE_SNAP_THRESHOLD_PX);
  if (endNode) {
    annotation.end = pointOnNodeBoundary(
      endNode.bounds,
      endNode.nodeType,
      annotation.end,
    );
    annotation.snappedEndStrokeId = endNode.strokeId;
  }
}

function getGestureMetrics(points: readonly StrokePoint[]): GestureMetrics | null {
  const normalized = removeDuplicatePoints(points);
  if (normalized.length < 2) {
    return null;
  }

  const start = normalized[0];
  const end = normalized[normalized.length - 1];
  if (!start || !end) {
    return null;
  }

  const bounds = boundsForPoints(normalized);
  const pathLength = getPathLength(normalized);
  const directDistance = distance(start, end);
  const diagonal = Math.hypot(bounds.width, bounds.height);
  if (pathLength < 24 || diagonal < 14) {
    return null;
  }

  const averageLineError = averageDistanceFromLine(normalized, start, end);
  const sampled = resampleByDistance(normalized, 14);
  const shortSide = Math.max(Math.min(bounds.width, bounds.height), 1);
  const longSide = Math.max(bounds.width, bounds.height);
  return {
    points: normalized,
    bounds,
    start,
    end,
    pathLength,
    directDistance,
    closureRatio: distance(start, end) / Math.max(diagonal, 1),
    averageLineError,
    directionChanges: countDirectionChanges(sampled),
    axisAlignedRatio: getAxisAlignedRatio(sampled),
    aspectRatio: longSide / shortSide,
  };
}

function looksLikeFlowNode(metrics: GestureMetrics): boolean {
  const { aspectRatio, axisAlignedRatio, directionChanges } = metrics;
  return aspectRatio <= 3.2 && directionChanges >= 3 && axisAlignedRatio >= 0.42;
}

function looksLikeHighlight(metrics: GestureMetrics): boolean {
  const shortSide = Math.min(metrics.bounds.width, metrics.bounds.height);
  return metrics.aspectRatio >= 3.2 && shortSide <= 34 && metrics.pathLength <= 340;
}

function findNearestNode(
  state: BoardState,
  point: Pick<StrokePoint, "x" | "y">,
  thresholdPx: number,
): NodeCandidate | null {
  let nearest: NodeCandidate | null = null;
  let nearestDistance = Number.POSITIVE_INFINITY;

  for (const stroke of Object.values(state.strokes)) {
    if (stroke.status !== "committed" || !isConnectorSnapTarget(stroke)) {
      continue;
    }

    const bounds = stroke.annotation?.bounds;
    if (!bounds) {
      continue;
    }

    const distanceToNode = distanceToBounds(point, bounds);
    if (distanceToNode < nearestDistance && distanceToNode <= thresholdPx) {
      nearestDistance = distanceToNode;
      nearest = {
        strokeId: stroke.id,
        bounds,
        ...(stroke.annotation?.nodeType ? { nodeType: stroke.annotation.nodeType } : {}),
      };
    }
  }

  return nearest;
}

function isConnectorSnapTarget(stroke: Stroke): boolean {
  const type = stroke.annotation?.type;
  return type === "flow_node" || type === "rectangle" || type === "sticky_note";
}

function nodeBoundsForType(
  nodeType: AnnotationNodeType,
  center: AnnotationPoint,
): AnnotationBounds {
  const { width, height } = nodeVisualDefaultSize(nodeType);
  return {
    x: center.x - width / 2,
    y: center.y - height / 2,
    width,
    height,
  };
}

function defaultLabelForNodeType(nodeType: AnnotationNodeType): string {
  return nodeVisualCapability(nodeType).defaultLabel;
}

function removeDuplicatePoints(points: readonly StrokePoint[]): StrokePoint[] {
  const result: StrokePoint[] = [];
  for (const point of points) {
    const previousPoint = result[result.length - 1];
    if (!previousPoint || distance(previousPoint, point) >= 2) {
      result.push({
        ...point,
        inputSource: point.inputSource ?? "air_gesture",
      });
    }
  }
  return result;
}

function boundsForPoints(points: readonly StrokePoint[]): AnnotationBounds {
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;

  for (const point of points) {
    minX = Math.min(minX, point.x);
    minY = Math.min(minY, point.y);
    maxX = Math.max(maxX, point.x);
    maxY = Math.max(maxY, point.y);
  }

  return {
    x: minX,
    y: minY,
    width: Math.max(1, maxX - minX),
    height: Math.max(1, maxY - minY),
  };
}

function padBounds(
  bounds: AnnotationBounds,
  padding: number,
  minWidth: number,
  minHeight: number,
): AnnotationBounds {
  const width = Math.max(bounds.width + padding * 2, minWidth);
  const height = Math.max(bounds.height + padding * 2, minHeight);
  return {
    x: bounds.x + bounds.width / 2 - width / 2,
    y: bounds.y + bounds.height / 2 - height / 2,
    width,
    height,
  };
}

function ellipsePoints(bounds: AnnotationBounds, timestampMs: number): StrokePoint[] {
  const points: StrokePoint[] = [];
  const centerX = bounds.x + bounds.width / 2;
  const centerY = bounds.y + bounds.height / 2;
  const radiusX = bounds.width / 2;
  const radiusY = bounds.height / 2;
  for (let index = 0; index <= 48; index += 1) {
    const angle = (Math.PI * 2 * index) / 48;
    points.push({
      x: centerX + Math.cos(angle) * radiusX,
      y: centerY + Math.sin(angle) * radiusY,
      t: timestampMs + index,
      inputSource: "air_gesture",
    });
  }
  return points;
}

function rectanglePoints(bounds: AnnotationBounds, timestampMs: number): StrokePoint[] {
  return [
    point(bounds.x, bounds.y, timestampMs),
    point(bounds.x + bounds.width, bounds.y, timestampMs + 1),
    point(bounds.x + bounds.width, bounds.y + bounds.height, timestampMs + 2),
    point(bounds.x, bounds.y + bounds.height, timestampMs + 3),
    point(bounds.x, bounds.y, timestampMs + 4),
  ];
}

function linePoints(
  start: Pick<StrokePoint, "x" | "y">,
  end: Pick<StrokePoint, "x" | "y">,
  timestampMs: number,
): StrokePoint[] {
  return [point(start.x, start.y, timestampMs), point(end.x, end.y, timestampMs + 1)];
}

function point(x: number, y: number, timestampMs: number): StrokePoint {
  return {
    x,
    y,
    t: timestampMs,
    inputSource: "air_gesture",
  };
}

function pointOf(pointLike: Pick<StrokePoint, "x" | "y">): AnnotationPoint {
  return {
    x: pointLike.x,
    y: pointLike.y,
  };
}

function getPathLength(points: readonly StrokePoint[]): number {
  let length = 0;
  for (let index = 1; index < points.length; index += 1) {
    const previous = points[index - 1];
    const current = points[index];
    if (previous && current) {
      length += distance(previous, current);
    }
  }
  return length;
}

function averageDistanceFromLine(
  points: readonly StrokePoint[],
  start: Pick<StrokePoint, "x" | "y">,
  end: Pick<StrokePoint, "x" | "y">,
): number {
  if (points.length === 0) {
    return 0;
  }
  return (
    points.reduce((sum, currentPoint) => sum + distanceToSegment(currentPoint, start, end), 0) /
    points.length
  );
}

function resampleByDistance(points: readonly StrokePoint[], minDistancePx: number): StrokePoint[] {
  const result: StrokePoint[] = [];
  for (const point of points) {
    const previousPoint = result[result.length - 1];
    if (!previousPoint || distance(previousPoint, point) >= minDistancePx) {
      result.push(point);
    }
  }
  const lastPoint = points[points.length - 1];
  if (lastPoint && result[result.length - 1] !== lastPoint) {
    result.push(lastPoint);
  }
  return result;
}

function countDirectionChanges(points: readonly StrokePoint[]): number {
  if (points.length < 3) {
    return 0;
  }

  let changes = 0;
  let previousAngle: number | null = null;
  for (let index = 1; index < points.length; index += 1) {
    const previousPoint = points[index - 1];
    const currentPoint = points[index];
    if (!previousPoint || !currentPoint) {
      continue;
    }
    const segmentLength = distance(previousPoint, currentPoint);
    if (segmentLength < 6) {
      continue;
    }
    const angle = Math.atan2(currentPoint.y - previousPoint.y, currentPoint.x - previousPoint.x);
    if (previousAngle !== null && Math.abs(normalizeAngle(angle - previousAngle)) > Math.PI / 3) {
      changes += 1;
    }
    previousAngle = angle;
  }
  return changes;
}

function getAxisAlignedRatio(points: readonly StrokePoint[]): number {
  if (points.length < 2) {
    return 0;
  }

  let axisAligned = 0;
  let total = 0;
  for (let index = 1; index < points.length; index += 1) {
    const previousPoint = points[index - 1];
    const currentPoint = points[index];
    if (!previousPoint || !currentPoint) {
      continue;
    }
    const segmentLength = distance(previousPoint, currentPoint);
    if (segmentLength < 6) {
      continue;
    }
    total += 1;
    const angle = Math.abs(Math.atan2(currentPoint.y - previousPoint.y, currentPoint.x - previousPoint.x));
    const angleToHorizontal = Math.min(angle, Math.abs(Math.PI - angle));
    const angleToVertical = Math.abs(Math.PI / 2 - angle);
    if (Math.min(angleToHorizontal, angleToVertical) <= Math.PI / 7) {
      axisAligned += 1;
    }
  }

  return total === 0 ? 0 : axisAligned / total;
}

function distanceToBounds(pointLike: Pick<StrokePoint, "x" | "y">, bounds: AnnotationBounds): number {
  const closestX = clamp(pointLike.x, bounds.x, bounds.x + bounds.width);
  const closestY = clamp(pointLike.y, bounds.y, bounds.y + bounds.height);
  return Math.hypot(pointLike.x - closestX, pointLike.y - closestY);
}

function distanceToSegment(
  pointLike: Pick<StrokePoint, "x" | "y">,
  start: Pick<StrokePoint, "x" | "y">,
  end: Pick<StrokePoint, "x" | "y">,
): number {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared === 0) {
    return distance(pointLike, start);
  }

  const t = clamp(((pointLike.x - start.x) * dx + (pointLike.y - start.y) * dy) / lengthSquared, 0, 1);
  return distance(pointLike, {
    x: start.x + t * dx,
    y: start.y + t * dy,
  });
}

function normalizeAngle(angle: number): number {
  let normalized = angle;
  while (normalized > Math.PI) {
    normalized -= Math.PI * 2;
  }
  while (normalized < -Math.PI) {
    normalized += Math.PI * 2;
  }
  return normalized;
}

function distance(
  a: Pick<StrokePoint, "x" | "y">,
  b: Pick<StrokePoint, "x" | "y">,
): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
