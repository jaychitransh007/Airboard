import type {
  BoardState,
  CursorState,
  Stroke,
  StrokeAnnotation,
  StrokePoint,
} from "@airboard/core";
import { getConnectorRoutePoints, getRouteMidpoint } from "./connectorGeometry.ts";
import { adaptInkForDarkBoard } from "./neonInk.ts";

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

export type BoardRenderView = {
  /** Screen offset of the board origin, in CSS pixels. */
  x: number;
  y: number;
  /** Screen pixels per board unit. */
  scale: number;
};

export type BoardRenderTheme = "classic" | "lightboard";

export type BoardRenderOptions = {
  background: "white" | "dark" | "transparent";
  /**
   * "lightboard" draws content through an offscreen layer composited as a
   * blurred additive halo under a sharp core (neon glow), and adapts dark
   * inks so light-board content stays legible on a dark surface.
   */
  theme?: BoardRenderTheme;
  /**
   * Viewport transform (pan/zoom). Content — strokes, overlays, ghosts,
   * guides, cursors — is drawn in board coordinates and mapped through this
   * uniformly; the background always fills the physical canvas.
   */
  view?: BoardRenderView;
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

const identityInk = (color: string): string => color;
// Set per renderBoard call; drawing helpers route content colors through it.
let inkTransform: (color: string) => string = identityInk;

function themedInk(color: string): string {
  return inkTransform(color);
}

const glowLayerCache = new WeakMap<HTMLCanvasElement, HTMLCanvasElement>();

function acquireGlowLayer(canvas: HTMLCanvasElement): HTMLCanvasElement {
  let layer = glowLayerCache.get(canvas);
  if (!layer) {
    layer = document.createElement("canvas");
    glowLayerCache.set(canvas, layer);
  }
  if (layer.width !== canvas.width || layer.height !== canvas.height) {
    layer.width = canvas.width;
    layer.height = canvas.height;
  }
  return layer;
}

function compositeGlowLayer(context: CanvasRenderingContext2D, layer: HTMLCanvasElement): void {
  context.save();
  context.setTransform(1, 0, 0, 1, 0, 0);
  context.globalCompositeOperation = "lighter";
  if (typeof context.filter === "string") {
    context.filter = "blur(7px)";
    context.globalAlpha = 0.9;
    context.drawImage(layer, 0, 0);
    context.filter = "none";
  }
  context.globalAlpha = 1;
  context.drawImage(layer, 0, 0);
  context.restore();
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

  const { width, height, dpr } = resizeCanvasToDisplaySize(canvas);
  context.clearRect(0, 0, width, height);
  paintBackground(context, width, height, options.background);

  // Lightboard: draw content into an offscreen layer, then composite it as a
  // blurred additive halo under a sharp core so every primitive glows without
  // touching the individual draw functions.
  let target = context;
  let layer: HTMLCanvasElement | null = null;
  if ((options.theme ?? "classic") === "lightboard") {
    const candidate = acquireGlowLayer(canvas);
    const layerContext = candidate.getContext("2d");
    if (layerContext) {
      layerContext.setTransform(dpr, 0, 0, dpr, 0, 0);
      layerContext.clearRect(0, 0, width, height);
      layer = candidate;
      target = layerContext;
    }
    inkTransform = adaptInkForDarkBoard;
  }

  try {
    renderBoardContent(target, state, options, width, height);
  } finally {
    inkTransform = identityInk;
  }

  if (layer && target !== context) {
    compositeGlowLayer(context, layer);
  }
}

function renderBoardContent(
  context: CanvasRenderingContext2D,
  state: BoardState,
  options: BoardRenderOptions,
  width: number,
  height: number,
): void {
  if (options.view) {
    context.save();
    context.transform(
      options.view.scale,
      0,
      0,
      options.view.scale,
      options.view.x,
      options.view.y,
    );
  }

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
  if (options.view) {
    context.restore();
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
  context.strokeStyle = themedInk(stroke.color);
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
  context.strokeStyle = themedInk(annotation.strokeColor ?? stroke.color);
  context.fillStyle = themedInk(annotation.fillColor ?? "transparent");
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
    context.fillStyle = themedInk(annotation.fillColor ?? "#fde68a");
    context.strokeStyle = themedInk(annotation.strokeColor ?? "rgba(202, 138, 4, 0.45)");
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

  context.fillStyle = themedInk(annotation.fillColor ?? "#f8fafc");
  context.strokeStyle = themedInk(annotation.strokeColor ?? stroke.color);
  context.lineWidth = stroke.thickness;

  if (annotation.nodeType === "database") {
    drawDatabaseShape(context, bounds.x, bounds.y, bounds.width, bounds.height);
  } else if (annotation.nodeType === "decision") {
    drawDiamondShape(context, bounds.x, bounds.y, bounds.width, bounds.height);
  } else if (annotation.nodeType === "terminator") {
    drawStadiumShape(context, bounds.x, bounds.y, bounds.width, bounds.height);
  } else if (annotation.nodeType === "io") {
    drawParallelogramShape(context, bounds.x, bounds.y, bounds.width, bounds.height);
  } else if (annotation.nodeType === "document") {
    drawDocumentShape(context, bounds.x, bounds.y, bounds.width, bounds.height);
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

/** Flowchart terminator (start/end): a stadium / pill. */
function drawStadiumShape(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
): void {
  const radius = Math.min(height / 2, width / 2);
  context.beginPath();
  context.moveTo(x + radius, y);
  context.lineTo(x + width - radius, y);
  context.arc(x + width - radius, y + height / 2, radius, -Math.PI / 2, Math.PI / 2);
  context.lineTo(x + radius, y + height);
  context.arc(x + radius, y + height / 2, radius, Math.PI / 2, (3 * Math.PI) / 2);
  context.closePath();
  context.fill();
  context.stroke();
}

/** Flowchart input/output: a parallelogram. */
function drawParallelogramShape(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
): void {
  const skew = Math.min(width * 0.18, 26);
  context.beginPath();
  context.moveTo(x + skew, y);
  context.lineTo(x + width, y);
  context.lineTo(x + width - skew, y + height);
  context.lineTo(x, y + height);
  context.closePath();
  context.fill();
  context.stroke();
}

/** Flowchart document: a rectangle with a wave along the bottom edge. */
function drawDocumentShape(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
): void {
  const wave = Math.min(14, height * 0.18);
  const bottom = y + height - wave;
  context.beginPath();
  context.moveTo(x, y);
  context.lineTo(x + width, y);
  context.lineTo(x + width, bottom);
  context.bezierCurveTo(
    x + width * 0.72,
    bottom + wave * 1.6,
    x + width * 0.28,
    bottom - wave * 1.2,
    x,
    bottom + wave * 0.6,
  );
  context.closePath();
  context.fill();
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
  context.fillStyle = themedInk("#111827");
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
  context.strokeStyle = themedInk("rgba(220, 38, 38, 0.82)");
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
  context.strokeStyle = themedInk(
    mode === "selected" || mode === "multi-selected"
      ? "#0f766e"
      : mode === "delete-ghost"
        ? "rgba(220, 38, 38, 0.72)"
      : mode === "ghost"
        ? "rgba(15, 118, 110, 0.55)"
        : "rgba(15, 118, 110, 0.42)",
  );
  context.fillStyle = themedInk("#ffffff");
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
  context.fillStyle = themedInk("#ffffff");
  context.strokeStyle = themedInk("#0f766e");
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
    context.strokeStyle = themedInk("rgba(31, 37, 32, 0.7)");
    context.fillStyle = themedInk("rgba(31, 37, 32, 0.06)");
    context.lineWidth = 2;
    context.beginPath();
    context.arc(cursor.x, cursor.y, 10, 0, Math.PI * 2);
    context.fill();
    context.stroke();
    context.restore();
    return;
  }

  if (cursor.mode === "erasing" || cursor.mode === "duster_ready") {
    context.strokeStyle = themedInk(cursor.mode === "erasing" ? "#ef4444" : "rgba(239, 68, 68, 0.55)");
    context.fillStyle = themedInk("rgba(239, 68, 68, 0.08)");
    context.lineWidth = 2;
    context.beginPath();
    context.arc(cursor.x, cursor.y, cursor.mode === "erasing" ? 42 : 34, 0, Math.PI * 2);
    context.fill();
    context.stroke();
    context.restore();
    return;
  }

  if (cursor.mode === "repositioning") {
    context.strokeStyle = themedInk("rgba(15, 118, 110, 0.78)");
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
    context.strokeStyle = themedInk("rgba(180, 83, 9, 0.85)");
    context.fillStyle = themedInk("rgba(180, 83, 9, 0.08)");
    context.lineWidth = 2;
    context.beginPath();
    context.arc(cursor.x, cursor.y, 8, 0, Math.PI * 2);
    context.fill();
    context.stroke();
    context.restore();
    return;
  }

  if (cursor.mode === "hand_detected") {
    context.fillStyle = themedInk("rgba(17, 24, 39, 0.18)");
    context.beginPath();
    context.arc(cursor.x, cursor.y, 4, 0, Math.PI * 2);
    context.fill();
    context.restore();
    return;
  }

  if (cursor.mode === "contact_ready") {
    context.strokeStyle = themedInk("rgba(15, 118, 110, 0.72)");
    context.fillStyle = themedInk("rgba(15, 118, 110, 0.18)");
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

  context.strokeStyle = themedInk(cursor.mode === "writing" ? "#111827" : "rgba(17, 24, 39, 0.55)");
  context.fillStyle = themedInk(cursor.mode === "writing" ? "#111827" : "transparent");
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
