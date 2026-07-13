import type {
  BoardState,
  CursorState,
  Stroke,
  StrokeAnnotation,
  StrokePoint,
} from "@airboard/core";
import { getConnectorRoutePoints, getRouteMidpoint } from "./connectorGeometry.js";

export type AnnotationRenderObject = {
  annotation: StrokeAnnotation;
  points: StrokePoint[];
  color: string;
  thickness: number;
  previewKind?: "add" | "change" | "delete";
};

export type BoardAlignmentGuide = {
  axis: "x" | "y";
  position: number;
  kind?: "object" | "grid";
};

export type BoardRenderOptions = {
  background: "white" | "dark" | "transparent";
  showDeleted?: boolean;
  selectedStrokeId?: string | null;
  selectedStrokeIds?: readonly string[];
  hoverStrokeId?: string | null;
  ghostAnnotation?: AnnotationRenderObject | null;
  ghostAnnotations?: readonly AnnotationRenderObject[];
  alignmentGuides?: readonly BoardAlignmentGuide[];
};

export function resizeCanvasToDisplaySize(canvas: HTMLCanvasElement): {
  width: number;
  height: number;
  dpr: number;
} {
  const rect = canvas.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  const width = Math.max(1, Math.floor(rect.width));
  const height = Math.max(1, Math.floor(rect.height));
  const pixelWidth = Math.floor(width * dpr);
  const pixelHeight = Math.floor(height * dpr);

  if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
    canvas.width = pixelWidth;
    canvas.height = pixelHeight;
  }

  const context = canvas.getContext("2d");
  context?.setTransform(dpr, 0, 0, dpr, 0, 0);

  return { width, height, dpr };
}

export function renderBoard(
  canvas: HTMLCanvasElement,
  state: BoardState,
  options: BoardRenderOptions = { background: "white" },
): void {
  const context = canvas.getContext("2d");
  if (!context) {
    return;
  }

  const { width, height } = resizeCanvasToDisplaySize(canvas);
  context.clearRect(0, 0, width, height);
  paintBackground(context, width, height, options.background);

  for (const stroke of Object.values(state.strokes)) {
    if (stroke.status === "deleted" && !options.showDeleted) {
      continue;
    }
    drawStroke(context, stroke, stroke.status === "deleted" ? 0.12 : 1);
  }

  for (const stroke of Object.values(state.activeStrokes)) {
    drawStroke(context, stroke, 1);
  }

  const hoverStroke =
    options.hoverStrokeId && options.hoverStrokeId !== options.selectedStrokeId
      ? state.strokes[options.hoverStrokeId]
      : undefined;
  if (hoverStroke?.annotation && hoverStroke.status === "committed") {
    drawAnnotationOverlay(context, hoverStroke.annotation, "hover");
  }

  const selectedStroke = options.selectedStrokeId ? state.strokes[options.selectedStrokeId] : undefined;
  for (const selectedId of options.selectedStrokeIds ?? []) {
    if (selectedId === options.selectedStrokeId) {
      continue;
    }
    const additionalSelection = state.strokes[selectedId];
    if (additionalSelection?.annotation && additionalSelection.status === "committed") {
      drawAnnotationOverlay(context, additionalSelection.annotation, "multi-selected");
    }
  }
  if (selectedStroke?.annotation && selectedStroke.status === "committed") {
    drawAnnotationOverlay(context, selectedStroke.annotation, "selected");
  }

  if (options.ghostAnnotation) {
    drawGhostAnnotation(context, options.ghostAnnotation);
  }
  for (const ghost of options.ghostAnnotations ?? []) {
    drawGhostAnnotation(context, ghost);
  }

  if (options.alignmentGuides?.length) {
    drawAlignmentGuides(context, options.alignmentGuides, width, height);
  }

  for (const cursor of Object.values(state.cursors)) {
    drawCursor(context, cursor);
  }
}

function drawAlignmentGuides(
  context: CanvasRenderingContext2D,
  guides: readonly BoardAlignmentGuide[],
  width: number,
  height: number,
): void {
  context.save();
  context.lineWidth = 1;
  context.setLineDash([5, 5]);
  for (const guide of guides) {
    context.beginPath();
    context.strokeStyle = guide.kind === "grid" ? "rgba(14, 116, 144, 0.45)" : "rgba(124, 58, 237, 0.62)";
    if (guide.axis === "x") {
      context.moveTo(guide.position, 0);
      context.lineTo(guide.position, height);
    } else {
      context.moveTo(0, guide.position);
      context.lineTo(width, guide.position);
    }
    context.stroke();
  }
  context.restore();
}

export function drawStroke(
  context: CanvasRenderingContext2D,
  stroke: Stroke,
  alpha = 1,
): void {
  if (stroke.points.length === 0) {
    return;
  }

  if (stroke.annotation) {
    drawAnnotationStroke(context, stroke, alpha);
    return;
  }

  context.save();
  context.globalAlpha = alpha;
  context.lineCap = "round";
  context.lineJoin = "round";
  context.strokeStyle = stroke.color;
  context.lineWidth = stroke.thickness;

  context.beginPath();
  const firstPoint = stroke.points[0];
  if (!firstPoint) {
    context.restore();
    return;
  }
  const rest = stroke.points.slice(1);
  context.moveTo(firstPoint.x, firstPoint.y);

  if (rest.length === 0) {
    context.lineTo(firstPoint.x + 0.01, firstPoint.y + 0.01);
  } else {
    for (let index = 0; index < rest.length; index += 1) {
      const point = rest[index];
      const nextPoint = rest[index + 1];
      if (!point) {
        continue;
      }

      if (nextPoint) {
        const midX = (point.x + nextPoint.x) / 2;
        const midY = (point.y + nextPoint.y) / 2;
        context.quadraticCurveTo(point.x, point.y, midX, midY);
      } else {
        context.lineTo(point.x, point.y);
      }
    }
  }

  context.stroke();
  context.restore();
}

function drawAnnotationStroke(
  context: CanvasRenderingContext2D,
  stroke: Stroke,
  alpha: number,
): void {
  const annotation = stroke.annotation;
  if (!annotation) {
    return;
  }

  context.save();
  context.globalAlpha = alpha * (annotation.opacity ?? 1);
  context.lineCap = "round";
  context.lineJoin = "round";
  context.strokeStyle = annotation.strokeColor ?? stroke.color;
  context.fillStyle = annotation.fillColor ?? "transparent";
  context.lineWidth = stroke.thickness;

  if ((annotation.type === "ellipse" || annotation.type === "pointer") && annotation.bounds) {
    const centerX = annotation.bounds.x + annotation.bounds.width / 2;
    const centerY = annotation.bounds.y + annotation.bounds.height / 2;
    context.beginPath();
    context.ellipse(
      centerX,
      centerY,
      Math.max(annotation.bounds.width / 2, 4),
      Math.max(annotation.bounds.height / 2, 4),
      0,
      0,
      Math.PI * 2,
    );
    if (annotation.fillColor) {
      context.fill();
    }
    context.stroke();
    drawAnnotationLabel(context, annotation.label, centerX, centerY, annotation.bounds.width);
    context.restore();
    return;
  }

  if (
    (annotation.type === "rectangle" || annotation.type === "flow_node" || annotation.type === "sticky_note") &&
    annotation.bounds
  ) {
    drawNodeShape(context, stroke);
    context.restore();
    return;
  }

  if (annotation.type === "highlight" && annotation.bounds) {
    context.globalAlpha = alpha * (annotation.opacity ?? 0.28);
    context.fillStyle = annotation.fillColor ?? "#fde68a";
    context.strokeStyle = annotation.strokeColor ?? "rgba(202, 138, 4, 0.45)";
    roundRectPath(
      context,
      annotation.bounds.x,
      annotation.bounds.y,
      annotation.bounds.width,
      annotation.bounds.height,
      6,
    );
    context.fill();
    context.stroke();
    context.restore();
    return;
  }

  if (
    (annotation.type === "arrow" || annotation.type === "connector") &&
    annotation.start &&
    annotation.end
  ) {
    const routePoints = getConnectorRoutePoints(annotation);
    drawArrowRoute(context, routePoints);
    const label = annotation.label;
    if (label) {
      const midpoint = getRouteMidpoint(routePoints) ?? {
        x: (annotation.start.x + annotation.end.x) / 2,
        y: (annotation.start.y + annotation.end.y) / 2,
      };
      drawAnnotationLabel(
        context,
        label,
        midpoint.x,
        midpoint.y - 10,
        Math.max(Math.abs(annotation.end.x - annotation.start.x), 72),
      );
    }
    context.restore();
    return;
  }

  drawFreehandFallback(context, stroke);
  context.restore();
}

function drawNodeShape(context: CanvasRenderingContext2D, stroke: Stroke): void {
  const annotation = stroke.annotation;
  const bounds = annotation?.bounds;
  if (!annotation || !bounds) {
    return;
  }

  context.fillStyle = annotation.fillColor ?? "#f8fafc";
  context.strokeStyle = annotation.strokeColor ?? stroke.color;
  context.lineWidth = stroke.thickness;

  if (annotation.nodeType === "database") {
    drawDatabaseShape(context, bounds.x, bounds.y, bounds.width, bounds.height);
  } else if (annotation.nodeType === "decision") {
    drawDiamondShape(context, bounds.x, bounds.y, bounds.width, bounds.height);
  } else {
    roundRectPath(context, bounds.x, bounds.y, bounds.width, bounds.height, 8);
    context.fill();
    context.stroke();
  }

  drawAnnotationLabel(
    context,
    annotation.label,
    bounds.x + bounds.width / 2,
    bounds.y + bounds.height / 2,
    bounds.width - 12,
  );
}

function drawDatabaseShape(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
): void {
  const capHeight = Math.min(16, height * 0.22);
  context.beginPath();
  context.ellipse(x + width / 2, y + capHeight, width / 2, capHeight, 0, Math.PI, 0);
  context.lineTo(x + width, y + height - capHeight);
  context.ellipse(x + width / 2, y + height - capHeight, width / 2, capHeight, 0, 0, Math.PI);
  context.closePath();
  context.fill();
  context.stroke();
  context.beginPath();
  context.ellipse(x + width / 2, y + capHeight, width / 2, capHeight, 0, 0, Math.PI * 2);
  context.stroke();
}

function drawDiamondShape(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
): void {
  context.beginPath();
  context.moveTo(x + width / 2, y);
  context.lineTo(x + width, y + height / 2);
  context.lineTo(x + width / 2, y + height);
  context.lineTo(x, y + height / 2);
  context.closePath();
  context.fill();
  context.stroke();
}

function drawArrowRoute(
  context: CanvasRenderingContext2D,
  points: readonly { x: number; y: number }[],
): void {
  const start = points[0];
  const end = points[points.length - 1];
  if (!start || !end) {
    return;
  }

  context.beginPath();
  context.moveTo(start.x, start.y);
  for (const point of points.slice(1)) {
    context.lineTo(point.x, point.y);
  }
  context.stroke();

  // Orient the arrowhead from the last point that is actually distinct from the
  // end. A straight two-point route uses the start; a route whose endpoints
  // collapsed onto one node would otherwise have an undefined direction.
  let reference: { x: number; y: number } | null = null;
  for (let index = points.length - 2; index >= 0; index -= 1) {
    const candidate = points[index];
    if (candidate && (candidate.x !== end.x || candidate.y !== end.y)) {
      reference = candidate;
      break;
    }
  }

  if (!reference) {
    // Degenerate zero-length connector: draw a small marker so it stays visible
    // and selectable instead of silently rendering nothing.
    context.beginPath();
    context.arc(end.x, end.y, 3, 0, Math.PI * 2);
    context.stroke();
    return;
  }

  const angle = Math.atan2(end.y - reference.y, end.x - reference.x);
  const headLength = 14;
  context.beginPath();
  context.moveTo(end.x, end.y);
  context.lineTo(
    end.x - headLength * Math.cos(angle - Math.PI / 6),
    end.y - headLength * Math.sin(angle - Math.PI / 6),
  );
  context.moveTo(end.x, end.y);
  context.lineTo(
    end.x - headLength * Math.cos(angle + Math.PI / 6),
    end.y - headLength * Math.sin(angle + Math.PI / 6),
  );
  context.stroke();
}

function drawAnnotationLabel(
  context: CanvasRenderingContext2D,
  label: string | undefined,
  centerX: number,
  centerY: number,
  maxWidth: number,
): void {
  if (!label) {
    return;
  }

  context.save();
  context.globalAlpha = 1;
  context.fillStyle = "#111827";
  context.font = "600 13px Inter, ui-sans-serif, system-ui, sans-serif";
  context.textAlign = "center";
  context.textBaseline = "middle";
  const words = label.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let currentLine = "";
  for (const word of words) {
    const nextLine = currentLine ? `${currentLine} ${word}` : word;
    if (context.measureText(nextLine).width <= maxWidth || currentLine === "") {
      currentLine = nextLine;
    } else {
      lines.push(currentLine);
      currentLine = word;
    }
  }
  if (currentLine) {
    lines.push(currentLine);
  }
  const visibleLines = lines.slice(0, 2);
  const lineHeight = 15;
  const firstY = centerY - ((visibleLines.length - 1) * lineHeight) / 2;
  visibleLines.forEach((line, index) => {
    context.fillText(line, centerX, firstY + index * lineHeight, maxWidth);
  });
  context.restore();
}

function drawFreehandFallback(context: CanvasRenderingContext2D, stroke: Stroke): void {
  const firstPoint = stroke.points[0];
  if (!firstPoint) {
    return;
  }
  context.beginPath();
  context.moveTo(firstPoint.x, firstPoint.y);
  stroke.points.slice(1).forEach((point) => {
    context.lineTo(point.x, point.y);
  });
  context.stroke();
}

function roundRectPath(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
): void {
  const r = Math.min(radius, width / 2, height / 2);
  context.beginPath();
  context.moveTo(x + r, y);
  context.lineTo(x + width - r, y);
  context.quadraticCurveTo(x + width, y, x + width, y + r);
  context.lineTo(x + width, y + height - r);
  context.quadraticCurveTo(x + width, y + height, x + width - r, y + height);
  context.lineTo(x + r, y + height);
  context.quadraticCurveTo(x, y + height, x, y + height - r);
  context.lineTo(x, y + r);
  context.quadraticCurveTo(x, y, x + r, y);
  context.closePath();
}

function drawGhostAnnotation(
  context: CanvasRenderingContext2D,
  ghost: AnnotationRenderObject,
): void {
  const stroke = annotationObjectToStroke(ghost);
  drawAnnotationStroke(context, stroke, ghost.previewKind === "delete" ? 0.16 : 0.42);
  drawAnnotationOverlay(
    context,
    ghost.annotation,
    ghost.previewKind === "delete" ? "delete-ghost" : "ghost",
  );
  if (ghost.previewKind === "delete") {
    drawDeletePreviewMark(context, ghost.annotation);
  }
}

function drawDeletePreviewMark(
  context: CanvasRenderingContext2D,
  annotation: StrokeAnnotation,
): void {
  context.save();
  context.strokeStyle = "rgba(220, 38, 38, 0.82)";
  context.lineWidth = 2.4;
  context.setLineDash([8, 6]);
  context.beginPath();
  if (annotation.bounds) {
    const { x, y, width, height } = annotation.bounds;
    context.moveTo(x, y);
    context.lineTo(x + width, y + height);
    context.moveTo(x + width, y);
    context.lineTo(x, y + height);
  } else if (annotation.start && annotation.end) {
    const midpoint = {
      x: (annotation.start.x + annotation.end.x) / 2,
      y: (annotation.start.y + annotation.end.y) / 2,
    };
    context.moveTo(midpoint.x - 12, midpoint.y - 12);
    context.lineTo(midpoint.x + 12, midpoint.y + 12);
    context.moveTo(midpoint.x + 12, midpoint.y - 12);
    context.lineTo(midpoint.x - 12, midpoint.y + 12);
  }
  context.stroke();
  context.restore();
}

function drawAnnotationOverlay(
  context: CanvasRenderingContext2D,
  annotation: StrokeAnnotation,
  mode: "hover" | "selected" | "multi-selected" | "ghost" | "delete-ghost",
): void {
  context.save();
  context.lineWidth = mode === "selected" || mode === "multi-selected" ? 1.6 : 1.2;
  context.strokeStyle =
    mode === "selected" || mode === "multi-selected"
      ? "#0f766e"
      : mode === "delete-ghost"
        ? "rgba(220, 38, 38, 0.72)"
      : mode === "ghost"
        ? "rgba(15, 118, 110, 0.55)"
        : "rgba(15, 118, 110, 0.42)";
  context.fillStyle = "#ffffff";
  context.setLineDash(mode === "selected" || mode === "multi-selected" ? [5, 4] : [4, 4]);

  if (annotation.bounds) {
    roundRectPath(
      context,
      annotation.bounds.x - 5,
      annotation.bounds.y - 5,
      annotation.bounds.width + 10,
      annotation.bounds.height + 10,
      8,
    );
    context.stroke();

    if (mode === "selected") {
      drawHandle(context, annotation.bounds.x, annotation.bounds.y);
      drawHandle(context, annotation.bounds.x + annotation.bounds.width, annotation.bounds.y);
      drawHandle(context, annotation.bounds.x, annotation.bounds.y + annotation.bounds.height);
      drawHandle(
        context,
        annotation.bounds.x + annotation.bounds.width,
        annotation.bounds.y + annotation.bounds.height,
      );
    }
    context.restore();
    return;
  }

  if (annotation.start && annotation.end) {
    const routePoints = getConnectorRoutePoints(annotation);
    const first = routePoints[0];
    context.beginPath();
    if (first) {
      context.moveTo(first.x, first.y);
      for (const point of routePoints.slice(1)) {
        context.lineTo(point.x, point.y);
      }
    }
    context.stroke();
    if (mode === "selected") {
      drawHandle(context, annotation.start.x, annotation.start.y);
      drawHandle(context, annotation.end.x, annotation.end.y);
    }
  }

  context.restore();
}

function drawHandle(context: CanvasRenderingContext2D, x: number, y: number): void {
  context.save();
  context.setLineDash([]);
  context.fillStyle = "#ffffff";
  context.strokeStyle = "#0f766e";
  context.lineWidth = 1.6;
  context.beginPath();
  context.rect(x - 4, y - 4, 8, 8);
  context.fill();
  context.stroke();
  context.restore();
}

function annotationObjectToStroke(object: AnnotationRenderObject): Stroke {
  return {
    id: "ghost-annotation",
    boardId: "render-only",
    userId: "render-only",
    tool: "marker",
    color: object.color,
    thickness: object.thickness,
    points: object.points,
    createdAt: "",
    updatedAt: "",
    status: "committed",
    annotation: object.annotation,
  };
}

export function drawCursor(context: CanvasRenderingContext2D, cursor: CursorState): void {
  context.save();

  if (cursor.mode === "idle" || cursor.mode === "paused") {
    context.restore();
    return;
  }

  if (cursor.mode === "panning") {
    context.strokeStyle = "rgba(31, 37, 32, 0.7)";
    context.fillStyle = "rgba(31, 37, 32, 0.06)";
    context.lineWidth = 2;
    context.beginPath();
    context.arc(cursor.x, cursor.y, 10, 0, Math.PI * 2);
    context.fill();
    context.stroke();
    context.restore();
    return;
  }

  if (cursor.mode === "erasing" || cursor.mode === "duster_ready") {
    context.strokeStyle = cursor.mode === "erasing" ? "#ef4444" : "rgba(239, 68, 68, 0.55)";
    context.fillStyle = "rgba(239, 68, 68, 0.08)";
    context.lineWidth = 2;
    context.beginPath();
    context.arc(cursor.x, cursor.y, cursor.mode === "erasing" ? 42 : 34, 0, Math.PI * 2);
    context.fill();
    context.stroke();
    context.restore();
    return;
  }

  if (cursor.mode === "repositioning") {
    context.strokeStyle = "rgba(15, 118, 110, 0.78)";
    context.fillStyle = "transparent";
    context.lineWidth = 2;
    context.setLineDash([5, 4]);
    context.beginPath();
    context.arc(cursor.x, cursor.y, 9, 0, Math.PI * 2);
    context.stroke();
    context.restore();
    return;
  }

  if (cursor.mode === "low_confidence") {
    context.strokeStyle = "rgba(180, 83, 9, 0.85)";
    context.fillStyle = "rgba(180, 83, 9, 0.08)";
    context.lineWidth = 2;
    context.beginPath();
    context.arc(cursor.x, cursor.y, 8, 0, Math.PI * 2);
    context.fill();
    context.stroke();
    context.restore();
    return;
  }

  if (cursor.mode === "hand_detected") {
    context.fillStyle = "rgba(17, 24, 39, 0.18)";
    context.beginPath();
    context.arc(cursor.x, cursor.y, 4, 0, Math.PI * 2);
    context.fill();
    context.restore();
    return;
  }

  if (cursor.mode === "contact_ready") {
    context.strokeStyle = "rgba(15, 118, 110, 0.72)";
    context.fillStyle = "rgba(15, 118, 110, 0.18)";
    context.lineWidth = 2;
    context.beginPath();
    context.arc(cursor.x, cursor.y, 12, 0, Math.PI * 2);
    context.stroke();
    context.beginPath();
    context.arc(cursor.x, cursor.y, 6, 0, Math.PI * 2);
    context.fill();
    context.stroke();
    context.restore();
    return;
  }

  context.strokeStyle = cursor.mode === "writing" ? "#111827" : "rgba(17, 24, 39, 0.55)";
  context.fillStyle = cursor.mode === "writing" ? "#111827" : "transparent";
  context.lineWidth = 2;
  context.beginPath();
  context.arc(cursor.x, cursor.y, cursor.mode === "writing" ? 5 : 7, 0, Math.PI * 2);
  context.fill();
  context.stroke();
  context.restore();
}

export function exportCanvasPng(canvas: HTMLCanvasElement): string {
  return canvas.toDataURL("image/png");
}

function paintBackground(
  context: CanvasRenderingContext2D,
  width: number,
  height: number,
  background: BoardRenderOptions["background"],
): void {
  if (background === "transparent") {
    return;
  }

  context.fillStyle = background === "dark" ? "#111827" : "#ffffff";
  context.fillRect(0, 0, width, height);
}
