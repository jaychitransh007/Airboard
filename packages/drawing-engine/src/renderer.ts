import type {
  AnnotationBounds,
  BoardState,
  CursorState,
  Stroke,
  StrokePoint,
  AirboardNodeVisualKind,
  ShapeElement,
  RichTextDocument,
  BoardSceneElement,
  ConnectorElement,
  DrawingElement,
  StickyElement,
  TextElement,
  SectionElement,
  TableElement,
  StampElement,
  MediaElement,
  LinkPreviewElement,
  CodeBlockElement,
  MindMapNodeElement,
  BoardElementTransform,
  RichTextMark,
  RichTextBlock,
} from "@airboard/core";
import { adaptFillForDarkBoard, adaptInkForDarkBoard } from "./neonInk.ts";
import {
  catalogShapeHasIconGlyph,
  catalogShapeLabelBand,
  drawCatalogShape,
  traceCatalogShapeOutline,
} from "./shapeGeometry.ts";
import {
  sampleSceneConnector,
  SCENE_CONNECTOR_LABEL_FONT_SIZE,
  SCENE_CONNECTOR_LABEL_FONT_WEIGHT,
  sceneConnectorCurveControls,
  sceneConnectorLabelLayoutOnBoard,
  type SceneConnectorLabelLayout,
} from "./sceneConnectorGeometry.ts";

export type BoardRenderView = {
  /** Screen offset of the board origin, in CSS pixels. */
  x: number;
  y: number;
  /** Screen pixels per board unit. */
  scale: number;
};

export type BoardRenderTheme = "classic" | "lightboard";

export type ContrastPlate = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type ContrastPlateOptions = {
  /** Darkness of the local glass behind diagram content. */
  opacity?: number;
  /** Space between diagram ink and the plate edge, in board units. */
  padding?: number;
  /** Nearby plates within this distance are combined into one cluster. */
  mergeGap?: number;
};

export type BoardRenderOptions = {
  background: "white" | "dark" | "transparent";
  /**
   * "lightboard" draws content through an offscreen layer composited as a
   * blurred additive halo under a sharp core (neon glow), and adapts dark
   * inks so light-board content stays legible on a dark surface.
   */
  theme?: BoardRenderTheme;
  /**
   * Viewport transform (pan/zoom). Content — elements, overlays, ghosts and
   * guides, cursors — is drawn in board coordinates and mapped through this
   * uniformly; the background always fills the physical canvas.
   */
  view?: BoardRenderView;
  showDeleted?: boolean;
  selectedElementId?: string | null;
  selectedElementIds?: readonly string[];
  hoverElementId?: string | null;
  /**
   * A provisional element drawn translucently, such as the placement preview
   * of a shape that is about to be created. It is never part of the board.
   */
  ghostElement?: BoardSceneElement | null;
  /** Suppress collaboration cursors in audience-facing renders. */
  hideCursors?: boolean;
  /** Draw local dark glass behind diagram clusters without dimming the full underlay. */
  contrastPlates?: ContrastPlateOptions | null;
  /**
   * Optional caller-owned, already-decoded images used by deterministic export.
   * Keys may be an asset id or URL. The renderer never starts network loads.
   */
  resolvedImages?: Readonly<Record<string, CanvasImageSource>>;
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
let fillTransform: (color: string) => string = identityInk;

function themedInk(color: string): string {
  return inkTransform(color);
}

/** Shape-body fills only: light paper fills become dark glass on lightboard. */
function themedFill(color: string): string {
  return fillTransform(color);
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

  // Contrast plates belong below the neon/glow layer. Drawing them into the
  // additive layer would brighten the captured screen instead of locally
  // darkening it.
  if (options.contrastPlates && (options.theme ?? "classic") === "lightboard") {
    drawContrastPlates(context, state, options.contrastPlates, options.view);
  }

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
    fillTransform = adaptFillForDarkBoard;
  }

  try {
    renderBoardContent(target, state, options);
  } finally {
    inkTransform = identityInk;
    fillTransform = identityInk;
  }

  if (layer && target !== context) {
    compositeGlowLayer(context, layer);
  }
}

function renderBoardContent(
  context: CanvasRenderingContext2D,
  state: BoardState,
  options: BoardRenderOptions,
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

  for (const element of sceneElementsForRender(state, options.showDeleted ?? false)) {
    drawSceneElement(
      context,
      element,
      element.status === "deleted" ? 0.12 : 1,
      {
        ...(options.resolvedImages ? { resolvedImages: options.resolvedImages } : {}),
        ...(state.elements ? { elements: state.elements } : {}),
      },
    );
  }

  for (const stroke of Object.values(state.activeStrokes)) {
    drawStroke(context, stroke, 1);
  }

  const hoverElement = options.hoverElementId
    ? state.elements?.[options.hoverElementId]
    : undefined;
  if (
    hoverElement &&
    hoverElement.status === "active" &&
    hoverElement.visible
  ) {
    drawSceneElementOverlay(context, hoverElement, "hover");
  }
  for (const selectedId of options.selectedElementIds ?? []) {
    if (selectedId === options.selectedElementId) continue;
    const element = state.elements?.[selectedId];
    if (
      element &&
      element.status === "active" &&
      element.visible
    ) {
      drawSceneElementOverlay(context, element, "multi-selected");
    }
  }
  const selectedElement = options.selectedElementId
    ? state.elements?.[options.selectedElementId]
    : undefined;
  if (
    selectedElement &&
    selectedElement.status === "active" &&
    selectedElement.visible
  ) {
    drawSceneElementOverlay(context, selectedElement, "selected");
  }

  if (options.ghostElement) {
    drawGhostElement(context, options.ghostElement, state.elements);
  }

  if (!options.hideCursors) {
    for (const cursor of Object.values(state.cursors)) {
      drawCursor(context, cursor);
    }
  }
  if (options.view) {
    context.restore();
  }
}

/** Stable z-order for every canonical scene element. */
export function orderSceneElementsForRender(
  elements: readonly BoardSceneElement[],
): BoardSceneElement[] {
  return elements
    .map((element, index) => ({ element, index }))
    .sort((a, b) => a.element.zIndex - b.element.zIndex || a.index - b.index)
    .map(({ element }) => element);
}

/**
 * Returns the scene elements that should actually be painted: visible, not
 * inside a hidden or collapsed section, and active unless deleted ones are
 * requested.
 */
export function sceneElementsForRender(
  state: BoardState,
  showDeleted = false,
): BoardSceneElement[] {
  const hiddenMemberIds = new Set<string>();
  const hiddenSectionIds = new Set(
    Object.values(state.elements ?? {})
      .filter(
        (element): element is SectionElement =>
          element.kind === "section" &&
          element.status === "active" &&
          (!element.visible || element.collapsed),
      )
      .map(({ id }) => id),
  );
  const pendingSections = [...hiddenSectionIds];
  const visitedSections = new Set<string>();
  while (pendingSections.length > 0) {
    const sectionId = pendingSections.shift()!;
    if (visitedSections.has(sectionId)) continue;
    visitedSections.add(sectionId);
    const section = state.elements[sectionId];
    if (section?.kind === "section") {
      for (const memberId of section.memberIds) {
        hiddenMemberIds.add(memberId);
        if (state.elements[memberId]?.kind === "section") pendingSections.push(memberId);
      }
    }
    for (const element of Object.values(state.elements ?? {})) {
      if (element.sectionId !== sectionId) continue;
      hiddenMemberIds.add(element.id);
      if (element.kind === "section") pendingSections.push(element.id);
    }
  }
  return orderSceneElementsForRender(Object.values(state.elements ?? {})).filter(
    (element) =>
      element.visible &&
      !hiddenMemberIds.has(element.id) &&
      (showDeleted || element.status !== "deleted"),
  );
}

function platesTouch(a: ContrastPlate, b: ContrastPlate, gap: number): boolean {
  return !(
    a.x + a.width + gap < b.x ||
    b.x + b.width + gap < a.x ||
    a.y + a.height + gap < b.y ||
    b.y + b.height + gap < a.y
  );
}

function unionPlate(a: ContrastPlate, b: ContrastPlate): ContrastPlate {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  const right = Math.max(a.x + a.width, b.x + b.width);
  const bottom = Math.max(a.y + a.height, b.y + b.height);
  return { x, y, width: right - x, height: bottom - y };
}

/**
 * Returns stable local contrast regions for committed diagram objects.
 * Connectors, arrows, highlights, group containers, and deleted objects do
 * not create large plates; their bright ink remains supported by nearby node
 * plates without obscuring the shared screen between clusters.
 */
export function calculateContrastPlates(
  state: BoardState,
  options: Pick<ContrastPlateOptions, "padding" | "mergeGap"> = {},
): ContrastPlate[] {
  const padding = Math.max(0, options.padding ?? 14);
  const mergeGap = Math.max(0, options.mergeGap ?? 18);
  const plates: ContrastPlate[] = [];

  for (const element of Object.values(state.elements ?? {})) {
    if (
      element.kind === "drawing" ||
      element.kind === "connector" ||
      element.status !== "active" ||
      !element.visible ||
      element.transform.width <= 0 ||
      element.transform.height <= 0
    ) {
      continue;
    }
    plates.push({
      x: element.transform.x - padding,
      y: element.transform.y - padding,
      width: element.transform.width + padding * 2,
      height: element.transform.height + padding * 2,
    });
  }

  // Repeated passes handle transitive clusters (A touches B, B touches C).
  let merged = plates;
  let changed = true;
  while (changed) {
    changed = false;
    const next: ContrastPlate[] = [];
    for (const plate of merged) {
      const match = next.findIndex((candidate) => platesTouch(candidate, plate, mergeGap));
      if (match === -1) {
        next.push(plate);
      } else {
        next[match] = unionPlate(next[match]!, plate);
        changed = true;
      }
    }
    merged = next;
  }
  return merged;
}

function drawContrastPlates(
  context: CanvasRenderingContext2D,
  state: BoardState,
  options: ContrastPlateOptions,
  view?: BoardRenderView,
): void {
  const plates = calculateContrastPlates(state, options);
  if (!plates.length) {
    return;
  }
  context.save();
  if (view) {
    context.transform(view.scale, 0, 0, view.scale, view.x, view.y);
  }
  context.fillStyle = `rgba(3, 8, 13, ${Math.min(0.92, Math.max(0, options.opacity ?? 0.72))})`;
  context.shadowColor = "rgba(3, 8, 13, 0.78)";
  context.shadowBlur = 18;
  for (const plate of plates) {
    roundRectPath(context, plate.x, plate.y, plate.width, plate.height, 18);
    context.fill();
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

export type SceneElementRenderResources = {
  resolvedImages?: Readonly<Record<string, CanvasImageSource>>;
  /**
   * The board's elements, so a connector's label can keep clear of the
   * shapes it joins, other objects and other lines nearby. Without them it
   * keeps clear of its own ends only.
   */
  elements?: Readonly<Record<string, BoardSceneElement>>;
};

/** Paints any committed v2 scene element using only board-state data. */
export function drawSceneElement(
  context: CanvasRenderingContext2D,
  element: BoardSceneElement,
  alpha = 1,
  resources: SceneElementRenderResources = {},
): void {
  context.save();
  context.globalAlpha = alpha;
  switch (element.kind) {
    case "drawing":
      drawDrawingElement(context, element, resources);
      break;
    case "sticky":
      drawStickyElement(context, element);
      break;
    case "shape":
      drawShapeElement(context, element);
      break;
    case "connector":
      drawConnectorElement(context, element, resources.elements);
      break;
    case "text":
      drawTextElement(context, element);
      break;
    case "section":
      drawSectionElement(context, element);
      break;
    case "table":
      drawTableElement(context, element);
      break;
    case "stamp":
      drawStampElement(context, element, resources);
      break;
    case "media":
      drawMediaElement(context, element, resources);
      break;
    case "link_preview":
      drawLinkPreviewElement(context, element, resources);
      break;
    case "code_block":
      drawCodeBlockElement(context, element);
      break;
    case "mind_map_node":
      drawMindMapNodeElement(context, element);
      break;
  }
  context.restore();
}

function drawDrawingElement(
  context: CanvasRenderingContext2D,
  element: DrawingElement,
  resources: SceneElementRenderResources,
): void {
  if (element.points.length === 0) return;
  withElementRotation(context, element.transform, () => {
    context.save();
    context.globalAlpha *= Math.min(1, Math.max(0, element.style.opacity));
    context.lineCap = "round";
    context.lineJoin = "round";
    context.lineWidth = Math.max(1, element.style.thickness);
    context.strokeStyle = themedInk(element.style.color);

    const patternImage = element.style.patternAsset
      ? resolvedImage(resources, [
          element.style.patternAsset.id,
          element.style.patternAsset.thumbnailUrl,
          element.style.patternAsset.url,
        ])
      : undefined;
    if (element.drawingKind === "washi") {
      context.lineWidth = Math.max(10, element.style.thickness);
      if (patternImage && typeof context.createPattern === "function") {
        const pattern = context.createPattern(patternImage, "repeat");
        if (pattern) context.strokeStyle = pattern;
      } else {
        context.setLineDash([
          Math.max(5, element.style.thickness * 0.7),
          Math.max(3, element.style.thickness * 0.28),
        ]);
      }
    } else if (element.drawingKind === "highlighter") {
      context.globalAlpha *= 0.48;
      context.lineWidth = Math.max(8, element.style.thickness);
    }

    traceSmoothPoints(context, element.points, element.style.straight);
    context.stroke();
    context.restore();
  });
}

function drawStickyElement(
  context: CanvasRenderingContext2D,
  element: StickyElement,
): void {
  const bounds = element.transform;
  withElementRotation(context, bounds, () => {
    context.save();
    context.fillStyle = themedFill(element.color);
    context.strokeStyle = themedInk("rgba(120, 113, 108, 0.24)");
    context.lineWidth = 1;
    roundRectPath(context, bounds.x, bounds.y, bounds.width, bounds.height, 5);
    context.fill();
    context.stroke();
    drawRichTextDocument(context, element.content, insetBounds(bounds, 14, element.authorVisible ? 26 : 14), {
      color: "#292524",
      fontSize: Math.max(13, Math.min(22, bounds.width / 9)),
      align: "left",
      verticalAlign: "top",
    });
    if (element.authorVisible && element.creatorId) {
      const initials = element.creatorId.slice(0, 2).toUpperCase();
      const radius = 9;
      const centerX = bounds.x + 15;
      const centerY = bounds.y + bounds.height - 15;
      context.fillStyle = themedInk("rgba(41, 37, 36, 0.18)");
      context.beginPath();
      context.arc(centerX, centerY, radius, 0, Math.PI * 2);
      context.fill();
      context.fillStyle = themedInk("#44403c");
      context.font = "600 8px Inter, ui-sans-serif, system-ui, sans-serif";
      context.textAlign = "center";
      context.textBaseline = "middle";
      context.fillText(initials, centerX, centerY);
    }
    context.restore();
  });
}

/**
 * Where a connector's label box is drawn: on the line between the two
 * outlines when it fits, otherwise just beside it, clear of nearby shapes.
 * Computed once per elements record and shared with hit testing.
 */
export function sceneConnectorLabelLayout(
  element: ConnectorElement,
  elements?: Readonly<Record<string, BoardSceneElement>>,
): SceneConnectorLabelLayout | null {
  return sceneConnectorLabelLayoutOnBoard(element, elements);
}

function drawConnectorElement(
  context: CanvasRenderingContext2D,
  element: ConnectorElement,
  elements?: Readonly<Record<string, BoardSceneElement>>,
): void {
  withElementRotation(context, element.transform, () => {
    context.save();
    const baseAlpha = context.globalAlpha;
    const connectorAlpha = Math.min(1, Math.max(0, element.style.opacity));
    context.globalAlpha = baseAlpha * connectorAlpha;
    context.strokeStyle = themedInk(element.style.color);
    context.fillStyle = themedInk(element.style.color);
    context.lineWidth = element.style.thickness === "thick" ? 4 : 2;
    context.lineCap = "round";
    context.lineJoin = "round";
    const labelLayout = sceneConnectorLabelLayout(element, elements);

    // A label on the line breaks it: the line stops short of the label box.
    context.save();
    if (labelLayout?.placement === "on_line") {
      const box = labelLayout.bounds;
      context.beginPath();
      context.rect(-1e6, -1e6, 2e6, 2e6);
      context.rect(box.x, box.y, box.width, box.height);
      context.clip("evenodd");
    }
    context.setLineDash(
      element.style.strokeStyle === "dashed"
        ? [10, 7]
        : element.style.strokeStyle === "dotted"
          ? [2, 6]
          : [],
    );
    traceSceneConnector(context, element);
    context.stroke();
    context.restore();
    context.setLineDash([]);

    const samples = sampleSceneConnector(element);
    const firstReference = samples[1];
    const lastReference = samples[samples.length - 2];
    if (firstReference) {
      drawConnectorEndpoint(
        context,
        element.start.decoration,
        element.start.point,
        firstReference,
        context.lineWidth,
      );
    }
    if (lastReference) {
      drawConnectorEndpoint(
        context,
        element.end.decoration,
        element.end.point,
        lastReference,
        context.lineWidth,
      );
    }

    if (labelLayout) {
      const bounds = { ...labelLayout.bounds, rotation: 0 };
      if (element.style.labelBackground === "matching") {
        context.fillStyle = themedFill(element.style.color);
        context.globalAlpha = baseAlpha * connectorAlpha * 0.14;
        roundRectPath(context, bounds.x, bounds.y, bounds.width, bounds.height, 6);
        context.fill();
        context.globalAlpha = baseAlpha * connectorAlpha;
      } else {
        context.fillStyle = themedFill("rgba(255, 255, 255, 0.92)");
        roundRectPath(context, bounds.x, bounds.y, bounds.width, bounds.height, 6);
        context.fill();
      }
      // The text box is a hair wider than the widest line, so the rich-text
      // layout wraps the label exactly where the label layout did.
      drawRichTextDocument(
        context,
        element.label,
        { x: bounds.x + 7, y: bounds.y, width: bounds.width - 14, height: bounds.height, rotation: 0 },
        {
          color: element.style.color,
          fontSize: SCENE_CONNECTOR_LABEL_FONT_SIZE,
          fontWeight: SCENE_CONNECTOR_LABEL_FONT_WEIGHT,
          align: "center",
          verticalAlign: "middle",
        },
      );
    }
    context.restore();
  });
}

function drawTextElement(
  context: CanvasRenderingContext2D,
  element: TextElement,
): void {
  const family =
    element.style.fontFamily ??
    (element.style.preset === "bookish"
      ? "Georgia, serif"
      : element.style.preset === "technical"
        ? "ui-monospace, SFMono-Regular, Menlo, monospace"
        : element.style.preset === "scribbled"
          ? "Comic Sans MS, Chalkboard SE, cursive"
          : "Inter, ui-sans-serif, system-ui, sans-serif");
  withElementRotation(context, element.transform, () => {
    drawRichTextDocument(context, element.content, element.transform, {
      color: element.style.color,
      fontSize: element.style.fontSize,
      fontFamily: family,
      align: element.style.align,
      verticalAlign: element.style.verticalAlign,
    });
  });
}

function drawSectionElement(
  context: CanvasRenderingContext2D,
  element: SectionElement,
): void {
  const bounds = element.transform;
  withElementRotation(context, bounds, () => {
    context.save();
    const baseAlpha = context.globalAlpha;
    context.fillStyle = themedFill(element.style.fill);
    context.globalAlpha = baseAlpha * Math.min(1, Math.max(0, element.style.fillOpacity));
    roundRectPath(context, bounds.x, bounds.y, bounds.width, bounds.height, 12);
    context.fill();
    context.globalAlpha = baseAlpha;
    context.strokeStyle = themedInk(element.style.stroke);
    context.lineWidth = element.lockMode === "all" ? 3 : 2;
    context.setLineDash(element.lockMode === "background" ? [8, 6] : []);
    roundRectPath(context, bounds.x, bounds.y, bounds.width, bounds.height, 12);
    context.stroke();
    context.setLineDash([]);
    if (element.titleVisible) {
      const titleBounds = {
        x: bounds.x + 12,
        y: bounds.y + 8,
        width: Math.max(40, bounds.width - 24),
        height: 32,
        rotation: 0,
      };
      drawRichTextDocument(context, element.title, titleBounds, {
        color: element.style.stroke,
        fontSize: 18,
        fontWeight: 700,
        align: "left",
        verticalAlign: "middle",
      });
    }
    if (element.collapsed) {
      context.fillStyle = themedInk(element.style.stroke);
      context.beginPath();
      context.moveTo(bounds.x + bounds.width - 28, bounds.y + 17);
      context.lineTo(bounds.x + bounds.width - 16, bounds.y + 17);
      context.lineTo(bounds.x + bounds.width - 22, bounds.y + 24);
      context.closePath();
      context.fill();
    }
    context.restore();
  });
}

function drawTableElement(
  context: CanvasRenderingContext2D,
  element: TableElement,
): void {
  const bounds = element.transform;
  if (element.rows.length === 0 || element.columns.length === 0) return;
  withElementRotation(context, bounds, () => {
    context.save();
    const rowTotal = element.rows.reduce((sum, row) => sum + Math.max(1, row.height), 0);
    const columnTotal = element.columns.reduce((sum, column) => sum + Math.max(1, column.width), 0);
    const rowScale = bounds.height / rowTotal;
    const columnScale = bounds.width / columnTotal;
    const rowPositions = cumulativePositions(
      element.rows.map((row) => Math.max(1, row.height) * rowScale),
      bounds.y,
    );
    const columnPositions = cumulativePositions(
      element.columns.map((column) => Math.max(1, column.width) * columnScale),
      bounds.x,
    );
    const rowIndex = new Map(element.rows.map((row, index) => [row.id, index]));
    const columnIndex = new Map(element.columns.map((column, index) => [column.id, index]));
    const mergedMembers = new Map<string, { anchor: string; cellIds: readonly string[] }>();
    for (const merge of element.merges) {
      for (const cellId of merge.cellIds) {
        mergedMembers.set(cellId, { anchor: merge.anchorCellId, cellIds: merge.cellIds });
      }
    }

    for (const row of element.rows) {
      for (const column of element.columns) {
        const cell = Object.values(element.cells).find(
          (candidate) => candidate.rowId === row.id && candidate.columnId === column.id,
        );
        if (!cell) continue;
        const merged = mergedMembers.get(cell.id);
        if (merged && merged.anchor !== cell.id) continue;
        let rows = [rowIndex.get(row.id)!];
        let columns = [columnIndex.get(column.id)!];
        if (merged) {
          const memberCells = merged.cellIds
            .map((cellId) => element.cells[cellId])
            .filter((candidate): candidate is NonNullable<typeof candidate> => Boolean(candidate));
          rows = memberCells
            .map((candidate) => rowIndex.get(candidate.rowId))
            .filter((index): index is number => index !== undefined);
          columns = memberCells
            .map((candidate) => columnIndex.get(candidate.columnId))
            .filter((index): index is number => index !== undefined);
        }
        const firstRow = Math.min(...rows);
        const lastRow = Math.max(...rows);
        const firstColumn = Math.min(...columns);
        const lastColumn = Math.max(...columns);
        const cellBounds = {
          x: columnPositions[firstColumn]!,
          y: rowPositions[firstRow]!,
          width: columnPositions[lastColumn + 1]! - columnPositions[firstColumn]!,
          height: rowPositions[lastRow + 1]! - rowPositions[firstRow]!,
          rotation: 0,
        };
        context.fillStyle = themedFill(cell.style.fill);
        context.strokeStyle = themedInk("#cbd5e1");
        context.lineWidth = 1;
        context.beginPath();
        context.rect(cellBounds.x, cellBounds.y, cellBounds.width, cellBounds.height);
        context.fill();
        context.stroke();
        drawRichTextDocument(context, cell.content, insetBounds(cellBounds, 7), {
          color: cell.style.textColor,
          fontSize: 13,
          align: cell.style.horizontalAlign,
          verticalAlign: cell.style.verticalAlign,
        });
      }
    }
    context.strokeStyle = themedInk("#94a3b8");
    context.lineWidth = 1.5;
    context.beginPath();
    context.rect(bounds.x, bounds.y, bounds.width, bounds.height);
    context.stroke();
    context.restore();
  });
}

function drawStampElement(
  context: CanvasRenderingContext2D,
  element: StampElement,
  resources: SceneElementRenderResources,
): void {
  const bounds = element.transform;
  withElementRotation(context, bounds, () => {
    const image = element.faceAsset
      ? resolvedImage(resources, [element.faceAsset.id, element.faceAsset.thumbnailUrl, element.faceAsset.url])
      : undefined;
    if (image) {
      context.save();
      context.beginPath();
      context.ellipse(
        bounds.x + bounds.width / 2,
        bounds.y + bounds.height / 2,
        bounds.width / 2,
        bounds.height / 2,
        0,
        0,
        Math.PI * 2,
      );
      context.clip();
      context.drawImage(image, bounds.x, bounds.y, bounds.width, bounds.height);
      context.restore();
      return;
    }
    context.font = `${Math.max(12, Math.min(bounds.width, bounds.height) * 0.78)}px Apple Color Emoji, Segoe UI Emoji, sans-serif`;
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.fillText(element.emoji, bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
  });
}

function drawMediaElement(
  context: CanvasRenderingContext2D,
  element: MediaElement,
  resources: SceneElementRenderResources,
): void {
  const bounds = element.transform;
  withElementRotation(context, bounds, () => {
    context.save();
    context.fillStyle = themedFill("#e2e8f0");
    context.strokeStyle = themedInk("#94a3b8");
    context.lineWidth = 1.5;
    roundRectPath(context, bounds.x, bounds.y, bounds.width, bounds.height, 8);
    context.fill();
    context.stroke();
    const image = resolvedImage(resources, [
      element.asset.id,
      element.asset.thumbnailUrl,
      element.asset.posterUrl,
      element.asset.url,
    ]);
    if (image) {
      context.save();
      roundRectPath(context, bounds.x, bounds.y, bounds.width, bounds.height, 8);
      context.clip();
      const zoom = Math.max(0.1, element.crop.zoom);
      const cropWidth = Math.max(0.01, element.crop.width);
      const cropHeight = Math.max(0.01, element.crop.height);
      const drawWidth = (bounds.width * zoom) / cropWidth;
      const drawHeight = (bounds.height * zoom) / cropHeight;
      const drawX = bounds.x - element.crop.x * drawWidth;
      const drawY = bounds.y - element.crop.y * drawHeight;
      context.drawImage(image, drawX, drawY, drawWidth, drawHeight);
      context.restore();
    } else {
      drawMediaPlaceholder(context, element, bounds);
    }
    if (element.mediaKind === "video") {
      drawPlayBadge(context, bounds, element.playing);
    } else if (element.mediaKind === "gif") {
      drawCornerBadge(context, bounds, "GIF");
    }
    context.restore();
  });
}

function drawLinkPreviewElement(
  context: CanvasRenderingContext2D,
  element: LinkPreviewElement,
  resources: SceneElementRenderResources,
): void {
  const bounds = element.transform;
  withElementRotation(context, bounds, () => {
    context.save();
    context.fillStyle = themedFill("#ffffff");
    context.strokeStyle = themedInk("#cbd5e1");
    context.lineWidth = 1.2;
    roundRectPath(context, bounds.x, bounds.y, bounds.width, bounds.height, 10);
    context.fill();
    context.stroke();

    if (element.display === "url") {
      drawPlainCanvasText(context, element.url, insetBounds(bounds, 14), {
        color: "#2563eb",
        fontSize: 14,
        align: "left",
        verticalAlign: "middle",
      });
      context.restore();
      return;
    }

    const image = resolvedImage(resources, [element.imageUrl, element.iconUrl]);
    const vertical = element.layout === "vertical";
    const mediaSize = vertical
      ? { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height * 0.44 }
      : { x: bounds.x, y: bounds.y, width: bounds.width * 0.34, height: bounds.height };
    if (image) {
      context.save();
      roundRectPath(context, mediaSize.x, mediaSize.y, mediaSize.width, mediaSize.height, 9);
      context.clip();
      context.drawImage(image, mediaSize.x, mediaSize.y, mediaSize.width, mediaSize.height);
      context.restore();
    } else {
      context.fillStyle = themedFill("#e0e7ff");
      context.fillRect(mediaSize.x, mediaSize.y, mediaSize.width, mediaSize.height);
      context.fillStyle = themedInk("#6366f1");
      context.font = `700 ${Math.max(18, Math.min(mediaSize.width, mediaSize.height) * 0.28)}px Inter, sans-serif`;
      context.textAlign = "center";
      context.textBaseline = "middle";
      context.fillText("↗", mediaSize.x + mediaSize.width / 2, mediaSize.y + mediaSize.height / 2);
    }
    const content = vertical
      ? {
          x: bounds.x + 12,
          y: bounds.y + mediaSize.height + 10,
          width: bounds.width - 24,
          height: bounds.height - mediaSize.height - 20,
          rotation: 0,
        }
      : {
          x: bounds.x + mediaSize.width + 12,
          y: bounds.y + 10,
          width: bounds.width - mediaSize.width - 24,
          height: bounds.height - 20,
          rotation: 0,
        };
    const copy = [element.title ?? element.siteName ?? element.url, element.description ?? "", element.siteName ?? ""]
      .filter(Boolean)
      .join("\n");
    drawPlainCanvasText(context, copy, content, {
      color: "#0f172a",
      fontSize: 13,
      align: "left",
      verticalAlign: "middle",
      fontWeight: 600,
    });
    if (element.display === "embed") drawCornerBadge(context, bounds, "EMBED");
    context.restore();
  });
}

function drawCodeBlockElement(
  context: CanvasRenderingContext2D,
  element: CodeBlockElement,
): void {
  const bounds = element.transform;
  withElementRotation(context, bounds, () => {
    context.save();
    const dark = element.theme === "dark";
    context.fillStyle = themedFill(dark ? "#111827" : "#f8fafc");
    context.strokeStyle = themedInk(dark ? "#374151" : "#cbd5e1");
    context.lineWidth = 1.2;
    roundRectPath(context, bounds.x, bounds.y, bounds.width, bounds.height, 9);
    context.fill();
    context.stroke();
    context.fillStyle = themedInk(dark ? "#94a3b8" : "#64748b");
    context.font = "600 10px ui-monospace, SFMono-Regular, Menlo, monospace";
    context.textAlign = "right";
    context.textBaseline = "middle";
    context.fillText(element.language.toUpperCase(), bounds.x + bounds.width - 12, bounds.y + 16);
    context.save();
    context.beginPath();
    context.rect(bounds.x + 8, bounds.y + 28, bounds.width - 16, bounds.height - 36);
    context.clip();
    const lineHeight = 18;
    const codeLines = element.code.split("\n");
    for (let index = 0; index < codeLines.length; index += 1) {
      const y = bounds.y + 42 + index * lineHeight;
      if (y > bounds.y + bounds.height - 8) break;
      context.fillStyle = themedInk(dark ? "#64748b" : "#94a3b8");
      context.font = "11px ui-monospace, SFMono-Regular, Menlo, monospace";
      context.textAlign = "right";
      context.fillText(String(index + 1), bounds.x + 30, y);
      drawHighlightedCodeLine(context, codeLines[index] ?? "", bounds.x + 42, y, dark);
    }
    context.restore();
    context.restore();
  });
}

function drawMindMapNodeElement(
  context: CanvasRenderingContext2D,
  element: MindMapNodeElement,
): void {
  const bounds = element.transform;
  withElementRotation(context, bounds, () => {
    context.fillStyle = themedFill(element.style.fill);
    context.strokeStyle = themedInk(element.style.lineColor);
    context.lineWidth = element.relation.parentId ? 2 : 3;
    roundRectPath(context, bounds.x, bounds.y, bounds.width, bounds.height, Math.min(18, bounds.height / 2));
    context.fill();
    context.stroke();
    drawRichTextDocument(context, element.content, insetBounds(bounds, 12), {
      color: element.style.textColor,
      fontSize: element.relation.parentId ? 14 : 16,
      fontWeight: element.relation.parentId ? 600 : 700,
      align: "center",
      verticalAlign: "middle",
    });
  });
}

/** Paints a canonical v2 shape element without requiring a DOM overlay. */
export function drawShapeElement(
  context: CanvasRenderingContext2D,
  element: ShapeElement,
  alpha = 1,
): void {
  context.save();
  context.globalAlpha *= alpha;
  const text = richTextPlainText(element.content);
  const labelBand = Boolean(text) && catalogShapeHasIconGlyph(element.shapeKind);
  drawCatalogShape(context, element.shapeKind, element.transform, {
    fill: themedFill(element.style.fill),
    stroke: themedInk(element.style.stroke),
    fillOpacity: element.style.fillOpacity,
    strokeOpacity: element.style.strokeOpacity,
    strokeWidth: element.style.strokeWidth,
    strokeStyle: element.style.strokeStyle,
    labelBand,
  });

  if (text) {
    const bounds = element.transform;
    const centerX = bounds.x + bounds.width / 2;
    const centerY = bounds.y + bounds.height / 2;
    const band = labelBand ? catalogShapeLabelBand(bounds) : null;
    // A queue's label sits in its front (lower) lane, as Airo's legacy
    // queues drew it, not across the gap between the two lanes.
    const lane = !band && element.shapeKind === "queue" ? nodeLabelPlacement(bounds, "queue") : null;
    context.translate(centerX, centerY);
    context.rotate(((bounds.rotation ?? 0) * Math.PI) / 180);
    context.translate(-centerX, -centerY);
    context.fillStyle = themedInk(element.style.textColor);
    context.font = `${element.style.fontSize ?? 13}px ${element.style.fontFamily ?? "Inter, ui-sans-serif, system-ui, sans-serif"}`;
    drawWrappedLabel(
      context,
      text,
      lane?.centerX ?? centerX,
      band ? band.y + band.height / 2 : lane?.centerY ?? centerY,
      lane ? Math.max(12, lane.maxWidth) : Math.max(12, bounds.width - Math.min(32, bounds.width * 0.2)),
      element.style.textAlign ?? "center",
    );
  }
  context.restore();
}

export function richTextPlainText(document: RichTextDocument): string {
  return document.blocks
    .map((block) => block.runs.map((run) => run.text).join(""))
    .join("\n")
    .trim();
}

type CanvasTextOptions = {
  color: string;
  fontSize: number;
  fontFamily?: string;
  fontWeight?: number;
  align: "left" | "center" | "right";
  verticalAlign: "top" | "middle" | "bottom";
};

type RichTextSegment = {
  text: string;
  marks?: RichTextMark;
  block: RichTextBlock;
  prefix?: boolean;
};

type RichTextLine = {
  segments: RichTextSegment[];
  width: number;
  height: number;
  align: "left" | "center" | "right";
};

function drawRichTextDocument(
  context: CanvasRenderingContext2D,
  document: RichTextDocument,
  bounds: BoardElementTransform,
  options: CanvasTextOptions,
): void {
  const lines = layoutRichText(context, document, Math.max(1, bounds.width), options);
  const totalHeight = lines.reduce((sum, line) => sum + line.height, 0);
  let y =
    options.verticalAlign === "bottom"
      ? bounds.y + bounds.height - totalHeight
      : options.verticalAlign === "middle"
        ? bounds.y + (bounds.height - totalHeight) / 2
        : bounds.y;
  context.save();
  context.beginPath();
  context.rect(bounds.x, bounds.y, Math.max(0, bounds.width), Math.max(0, bounds.height));
  context.clip();
  for (const line of lines) {
    let x =
      line.align === "right"
        ? bounds.x + bounds.width - line.width
        : line.align === "center"
          ? bounds.x + (bounds.width - line.width) / 2
          : bounds.x;
    for (const segment of line.segments) {
      applyRichTextFont(context, segment.block, segment.marks, options);
      const metrics = context.measureText(segment.text);
      const segmentWidth = metrics.width;
      const textY = y + line.height / 2;
      if (segment.marks?.inlineCode && segment.text.trim()) {
        context.fillStyle = themedFill("rgba(148, 163, 184, 0.22)");
        context.fillRect(x - 2, y + 1, segmentWidth + 4, Math.max(1, line.height - 2));
      }
      context.fillStyle = themedInk(segment.marks?.color ?? options.color);
      context.textAlign = "left";
      context.textBaseline = "middle";
      context.fillText(segment.text, x, textY);
      if (segment.marks?.strikethrough || segment.marks?.link) {
        context.save();
        context.strokeStyle = context.fillStyle as string;
        context.lineWidth = 1;
        context.beginPath();
        const decorationY = segment.marks.strikethrough ? textY : textY + line.height * 0.32;
        context.moveTo(x, decorationY);
        context.lineTo(x + segmentWidth, decorationY);
        context.stroke();
        context.restore();
      }
      x += segmentWidth;
    }
    y += line.height;
    if (y > bounds.y + bounds.height) break;
  }
  context.restore();
}

function layoutRichText(
  context: CanvasRenderingContext2D,
  document: RichTextDocument,
  maxWidth: number,
  options: CanvasTextOptions,
): RichTextLine[] {
  const lines: RichTextLine[] = [];
  let orderedIndex = 0;
  for (const block of document.blocks) {
    if (block.type === "ordered_list_item") orderedIndex += 1;
    else if (block.type !== "unordered_list_item") orderedIndex = 0;
    const prefix = block.type === "unordered_list_item"
      ? "• "
      : block.type === "ordered_list_item"
        ? `${orderedIndex}. `
        : block.type === "blockquote"
          ? "▎ "
          : "";
    const sourceSegments: RichTextSegment[] = [];
    if (prefix) sourceSegments.push({ text: prefix, block, prefix: true });
    for (const run of block.runs) {
      const pieces = run.text.split(/(\s+|\n)/).filter((piece) => piece.length > 0);
      for (const piece of pieces) {
        const segment: RichTextSegment = { text: piece, block };
        if (run.marks) segment.marks = run.marks;
        sourceSegments.push(segment);
      }
    }
    if (sourceSegments.length === 0) sourceSegments.push({ text: "", block });

    let current: RichTextLine = {
      segments: [],
      width: 0,
      height: richTextLineHeight(block, options),
      align: block.align ?? options.align,
    };
    for (const segment of sourceSegments) {
      if (segment.text === "\n") {
        lines.push(current);
        current = {
          segments: [],
          width: 0,
          height: richTextLineHeight(block, options),
          align: block.align ?? options.align,
        };
        continue;
      }
      applyRichTextFont(context, block, segment.marks, options);
      const width = context.measureText(segment.text).width;
      const isWhitespace = /^\s+$/.test(segment.text);
      if (current.segments.length > 0 && !isWhitespace && current.width + width > maxWidth) {
        while (current.segments.length > 0 && /^\s+$/.test(current.segments[current.segments.length - 1]!.text)) {
          const removed = current.segments.pop()!;
          applyRichTextFont(context, removed.block, removed.marks, options);
          current.width -= context.measureText(removed.text).width;
        }
        lines.push(current);
        current = {
          segments: [],
          width: 0,
          height: richTextLineHeight(block, options),
          align: block.align ?? options.align,
        };
      }
      if (current.segments.length === 0 && isWhitespace) continue;
      current.segments.push(segment);
      current.width += width;
    }
    lines.push(current);
  }
  return lines;
}

function applyRichTextFont(
  context: CanvasRenderingContext2D,
  block: RichTextBlock,
  marks: RichTextMark | undefined,
  options: CanvasTextOptions,
): void {
  const headingScale = block.type === "heading" ? Math.max(1, 1.55 - ((block.level ?? 1) - 1) * 0.1) : 1;
  const size = Math.max(8, options.fontSize * headingScale);
  const weight = marks?.bold ? 700 : block.type === "heading" ? 700 : options.fontWeight ?? 400;
  const style = marks?.italic ? "italic" : "normal";
  const family = marks?.inlineCode
    ? "ui-monospace, SFMono-Regular, Menlo, monospace"
    : options.fontFamily ?? "Inter, ui-sans-serif, system-ui, sans-serif";
  context.font = `${style} ${weight} ${size}px ${family}`;
}

function richTextLineHeight(block: RichTextBlock, options: CanvasTextOptions): number {
  const headingScale = block.type === "heading" ? Math.max(1, 1.55 - ((block.level ?? 1) - 1) * 0.1) : 1;
  return Math.max(12, options.fontSize * headingScale * 1.32);
}

function drawPlainCanvasText(
  context: CanvasRenderingContext2D,
  text: string,
  bounds: BoardElementTransform,
  options: CanvasTextOptions,
): void {
  drawRichTextDocument(
    context,
    {
      type: "doc",
      blocks: text.split("\n").map((line) => ({ type: "paragraph", runs: [{ text: line }] })),
    },
    bounds,
    options,
  );
}

function traceSmoothPoints(
  context: CanvasRenderingContext2D,
  points: readonly StrokePoint[],
  straight: boolean,
): void {
  const first = points[0];
  if (!first) return;
  context.beginPath();
  context.moveTo(first.x, first.y);
  if (points.length === 1) {
    context.lineTo(first.x + 0.01, first.y + 0.01);
    return;
  }
  if (straight) {
    const last = points[points.length - 1]!;
    context.lineTo(last.x, last.y);
    return;
  }
  for (let index = 1; index < points.length; index += 1) {
    const point = points[index]!;
    const next = points[index + 1];
    if (next) {
      context.quadraticCurveTo(point.x, point.y, (point.x + next.x) / 2, (point.y + next.y) / 2);
    } else {
      context.lineTo(point.x, point.y);
    }
  }
}

function traceSceneConnector(
  context: CanvasRenderingContext2D,
  element: ConnectorElement,
): void {
  const start = element.start.point;
  const end = element.end.point;
  context.beginPath();
  context.moveTo(start.x, start.y);
  if (element.pathKind === "curved") {
    const controls = sceneConnectorCurveControls(element);
    context.bezierCurveTo(controls[0].x, controls[0].y, controls[1].x, controls[1].y, end.x, end.y);
    return;
  }
  const points = sampleSceneConnector(element);
  for (const point of points.slice(1)) context.lineTo(point.x, point.y);
}

function drawConnectorEndpoint(
  context: CanvasRenderingContext2D,
  decoration: ConnectorElement["start"]["decoration"],
  endpoint: { x: number; y: number },
  reference: { x: number; y: number },
  lineWidth: number,
): void {
  if (decoration === "none") return;
  const angle = Math.atan2(endpoint.y - reference.y, endpoint.x - reference.x);
  // A heavier line gets a proportionally larger head, so thick arrows read
  // as boldly as the legacy connectors' 14px heads.
  const scale = 1 + Math.max(0, lineWidth - 2) * 0.2;
  const length = (decoration === "diamond" ? 13 : decoration === "triangle" ? 12 : 11) * scale;
  const wing = decoration === "line_arrow" ? Math.PI / 5 : Math.PI / 6;
  const left = {
    x: endpoint.x - length * Math.cos(angle - wing),
    y: endpoint.y - length * Math.sin(angle - wing),
  };
  const right = {
    x: endpoint.x - length * Math.cos(angle + wing),
    y: endpoint.y - length * Math.sin(angle + wing),
  };
  context.save();
  context.lineWidth = Math.max(1.5, lineWidth);
  context.setLineDash([]);
  context.beginPath();
  context.moveTo(endpoint.x, endpoint.y);
  context.lineTo(left.x, left.y);
  if (decoration === "line_arrow") {
    context.moveTo(endpoint.x, endpoint.y);
    context.lineTo(right.x, right.y);
    context.stroke();
    context.restore();
    return;
  }
  if (decoration === "diamond") {
    const back = {
      x: endpoint.x - length * 1.7 * Math.cos(angle),
      y: endpoint.y - length * 1.7 * Math.sin(angle),
    };
    context.lineTo(back.x, back.y);
    context.lineTo(right.x, right.y);
  } else if (decoration === "solid_arrow") {
    const notch = {
      x: endpoint.x - length * 0.72 * Math.cos(angle),
      y: endpoint.y - length * 0.72 * Math.sin(angle),
    };
    context.lineTo(notch.x, notch.y);
    context.lineTo(right.x, right.y);
  } else {
    context.lineTo(right.x, right.y);
  }
  context.closePath();
  if (decoration === "solid_arrow" || decoration === "triangle" || decoration === "diamond") {
    context.fill();
  }
  context.stroke();
  context.restore();
}

function withElementRotation(
  context: CanvasRenderingContext2D,
  transform: BoardElementTransform,
  draw: () => void,
): void {
  context.save();
  const rotation = transform.rotation ?? 0;
  if (rotation !== 0) {
    const centerX = transform.x + transform.width / 2;
    const centerY = transform.y + transform.height / 2;
    context.translate(centerX, centerY);
    context.rotate((rotation * Math.PI) / 180);
    context.translate(-centerX, -centerY);
  }
  try {
    draw();
  } finally {
    context.restore();
  }
}

function insetBounds(
  bounds: BoardElementTransform,
  padding: number,
  bottomPadding = padding,
): BoardElementTransform {
  return {
    x: bounds.x + padding,
    y: bounds.y + padding,
    width: Math.max(0, bounds.width - padding * 2),
    height: Math.max(0, bounds.height - padding - bottomPadding),
    rotation: 0,
  };
}

function cumulativePositions(values: readonly number[], start: number): number[] {
  const positions = [start];
  let position = start;
  for (const value of values) {
    position += value;
    positions.push(position);
  }
  return positions;
}

function resolvedImage(
  resources: SceneElementRenderResources,
  keys: readonly (string | undefined)[],
): CanvasImageSource | undefined {
  for (const key of keys) {
    if (!key) continue;
    const image = resources.resolvedImages?.[key];
    if (image) return image;
  }
  return undefined;
}

function drawMediaPlaceholder(
  context: CanvasRenderingContext2D,
  element: MediaElement,
  bounds: BoardElementTransform,
): void {
  const centerX = bounds.x + bounds.width / 2;
  const centerY = bounds.y + bounds.height / 2;
  context.strokeStyle = themedInk("#64748b");
  context.fillStyle = themedInk("#64748b");
  context.lineWidth = 2;
  if (element.mediaKind === "image" || element.mediaKind === "gif") {
    const iconWidth = Math.min(64, bounds.width * 0.3);
    const iconHeight = Math.min(48, bounds.height * 0.3);
    context.beginPath();
    context.rect(centerX - iconWidth / 2, centerY - iconHeight / 2, iconWidth, iconHeight);
    context.moveTo(centerX - iconWidth / 2 + 6, centerY + iconHeight / 2 - 7);
    context.lineTo(centerX - 6, centerY - 2);
    context.lineTo(centerX + 5, centerY + 9);
    context.lineTo(centerX + iconWidth / 2 - 5, centerY - iconHeight / 2 + 8);
    context.stroke();
  } else {
    context.beginPath();
    context.moveTo(centerX - 10, centerY - 14);
    context.lineTo(centerX + 15, centerY);
    context.lineTo(centerX - 10, centerY + 14);
    context.closePath();
    context.fill();
  }
  if (element.altText) {
    context.font = "12px Inter, sans-serif";
    context.textAlign = "center";
    context.textBaseline = "top";
    context.fillText(element.altText, centerX, centerY + Math.min(42, bounds.height * 0.24), bounds.width - 20);
  }
}

function drawPlayBadge(
  context: CanvasRenderingContext2D,
  bounds: BoardElementTransform,
  playing: boolean,
): void {
  const x = bounds.x + bounds.width / 2;
  const y = bounds.y + bounds.height / 2;
  const radius = Math.max(14, Math.min(28, Math.min(bounds.width, bounds.height) * 0.14));
  context.save();
  context.fillStyle = themedInk("rgba(15, 23, 42, 0.72)");
  context.beginPath();
  context.arc(x, y, radius, 0, Math.PI * 2);
  context.fill();
  context.fillStyle = themedInk("#ffffff");
  if (playing) {
    context.fillRect(x - 7, y - 9, 5, 18);
    context.fillRect(x + 2, y - 9, 5, 18);
  } else {
    context.beginPath();
    context.moveTo(x - 6, y - 10);
    context.lineTo(x + 11, y);
    context.lineTo(x - 6, y + 10);
    context.closePath();
    context.fill();
  }
  context.restore();
}

function drawCornerBadge(
  context: CanvasRenderingContext2D,
  bounds: BoardElementTransform,
  label: string,
): void {
  context.save();
  context.font = "700 9px Inter, sans-serif";
  const width = context.measureText(label).width + 12;
  const x = bounds.x + bounds.width - width - 7;
  const y = bounds.y + 7;
  context.fillStyle = themedInk("rgba(15, 23, 42, 0.78)");
  roundRectPath(context, x, y, width, 18, 5);
  context.fill();
  context.fillStyle = themedInk("#ffffff");
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.fillText(label, x + width / 2, y + 9);
  context.restore();
}

const CODE_TOKEN_PATTERN = /(\/\/.*|#[^\n]*|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`|\b\d+(?:\.\d+)?\b|\b(?:as|async|await|break|case|catch|class|const|continue|def|else|enum|export|extends|false|fn|for|from|function|if|import|in|interface|let|match|new|null|package|private|public|return|struct|switch|throw|true|try|type|var|while)\b)/g;

function drawHighlightedCodeLine(
  context: CanvasRenderingContext2D,
  line: string,
  startX: number,
  y: number,
  dark: boolean,
): void {
  context.font = "12px ui-monospace, SFMono-Regular, Menlo, monospace";
  context.textAlign = "left";
  context.textBaseline = "middle";
  let x = startX;
  let cursor = 0;
  CODE_TOKEN_PATTERN.lastIndex = 0;
  for (const match of line.matchAll(CODE_TOKEN_PATTERN)) {
    const index = match.index ?? cursor;
    if (index > cursor) {
      const plain = line.slice(cursor, index);
      context.fillStyle = themedInk(dark ? "#e5e7eb" : "#1f2937");
      context.fillText(plain, x, y);
      x += context.measureText(plain).width;
    }
    const token = match[0];
    context.fillStyle = themedInk(codeTokenColor(token, dark));
    context.fillText(token, x, y);
    x += context.measureText(token).width;
    cursor = index + token.length;
  }
  if (cursor < line.length) {
    const rest = line.slice(cursor);
    context.fillStyle = themedInk(dark ? "#e5e7eb" : "#1f2937");
    context.fillText(rest, x, y);
  }
}

function codeTokenColor(token: string, dark: boolean): string {
  if (token.startsWith("//") || token.startsWith("#")) return dark ? "#94a3b8" : "#64748b";
  if (/^["'`]/.test(token)) return dark ? "#86efac" : "#15803d";
  if (/^\d/.test(token)) return dark ? "#fbbf24" : "#b45309";
  return dark ? "#c4b5fd" : "#6d28d9";
}

export type NodeLabelPlacement = {
  centerX: number;
  centerY: number;
  maxWidth: number;
};

/**
 * Returns the label anchor for a semantic node visual.
 *
 * Queue nodes contain two stacked lanes separated at the overall vertical
 * center. The generic center anchor therefore puts text directly on the lane
 * divider. Use the undecorated lower lane instead; the upper lane retains its
 * directional marker. All other visual anchors intentionally remain
 * unchanged.
 */
export function nodeLabelPlacement(
  bounds: AnnotationBounds,
  visualKind: AirboardNodeVisualKind,
): NodeLabelPlacement {
  if (visualKind === "actor") {
    return {
      centerX: bounds.x + bounds.width / 2,
      centerY: bounds.y + bounds.height * 0.88,
      maxWidth: bounds.width - 6,
    };
  }
  if (visualKind === "queue") {
    const gap = Math.min(8, bounds.width * 0.06);
    const laneHeight = (bounds.height - gap) / 2;
    return {
      centerX: bounds.x + gap + (bounds.width - gap) / 2,
      centerY: bounds.y + bounds.height - laneHeight / 2,
      maxWidth: bounds.width - gap - 20,
    };
  }
  return {
    centerX: bounds.x + bounds.width / 2,
    centerY: bounds.y + bounds.height / 2,
    maxWidth: bounds.width - 20,
  };
}

function drawWrappedLabel(
  context: CanvasRenderingContext2D,
  label: string,
  centerX: number,
  centerY: number,
  maxWidth: number,
  alignment: "left" | "center" | "right",
): void {
  context.save();
  context.textAlign = alignment;
  context.textBaseline = "middle";
  const anchorX = alignment === "left"
    ? centerX - maxWidth / 2
    : alignment === "right"
      ? centerX + maxWidth / 2
      : centerX;
  const lines: string[] = [];
  for (const paragraph of label.split("\n")) {
    const words = paragraph.split(/\s+/).filter(Boolean);
    let current = "";
    for (const word of words) {
      const next = current ? `${current} ${word}` : word;
      if (!current || context.measureText(next).width <= maxWidth) current = next;
      else {
        lines.push(current);
        current = word;
      }
    }
    if (current) lines.push(current);
  }
  const visible = lines.slice(0, 4);
  const lineHeight = 16;
  const firstY = centerY - ((visible.length - 1) * lineHeight) / 2;
  visible.forEach((line, index) => context.fillText(line, anchorX, firstY + index * lineHeight, maxWidth));
  context.restore();
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

export type SceneElementOverlayMode = "hover" | "selected" | "multi-selected" | "ghost";

function overlayInk(mode: SceneElementOverlayMode): string {
  if (mode === "hover") return "rgba(15, 118, 110, 0.42)";
  if (mode === "ghost") return "rgba(15, 118, 110, 0.55)";
  return "#0f766e";
}

/**
 * Draws a placement preview: the exact element that is about to be created,
 * translucent, with a dashed outline. The board state is never changed.
 */
function drawGhostElement(
  context: CanvasRenderingContext2D,
  element: BoardSceneElement,
  elements: Readonly<Record<string, BoardSceneElement>> | undefined,
): void {
  drawSceneElement(context, element, 0.42, elements ? { elements } : {});
  drawSceneElementOverlay(context, element, "ghost");
}

export function drawSceneElementOverlay(
  context: CanvasRenderingContext2D,
  element: BoardSceneElement,
  mode: SceneElementOverlayMode,
): void {
  if (element.kind === "shape") {
    drawShapeElementOverlay(context, element, mode);
    return;
  }

  const selected = mode === "selected" || mode === "multi-selected";
  context.save();
  context.strokeStyle = themedInk(overlayInk(mode));
  context.fillStyle = themedInk("#ffffff");
  context.lineWidth = selected ? 1.6 : 1.2;
  context.setLineDash(selected ? [5, 4] : [4, 4]);

  if (element.kind === "connector") {
    traceSceneConnector(context, element);
    context.stroke();
    if (mode === "selected") {
      drawHandle(context, element.start.point.x, element.start.point.y);
      for (const point of element.controlPoints) drawHandle(context, point.x, point.y);
      drawHandle(context, element.end.point.x, element.end.point.y);
    }
    context.restore();
    return;
  }

  if (element.kind === "drawing") {
    withElementRotation(context, element.transform, () => {
      context.lineWidth = Math.max(
        selected ? 7 : 5,
        element.style.thickness + (selected ? 5 : 3),
      );
      traceSmoothPoints(context, element.points, element.style.straight);
      context.stroke();
    });
    context.restore();
    return;
  }

  const { transform } = element;
  withElementRotation(context, transform, () => {
    const padding = 5;
    if (element.kind === "stamp") {
      context.beginPath();
      context.ellipse(
        transform.x + transform.width / 2,
        transform.y + transform.height / 2,
        transform.width / 2 + padding,
        transform.height / 2 + padding,
        0,
        0,
        Math.PI * 2,
      );
    } else {
      roundRectPath(
        context,
        transform.x - padding,
        transform.y - padding,
        transform.width + padding * 2,
        transform.height + padding * 2,
        element.kind === "mind_map_node" ? 18 : 5,
      );
    }
    context.stroke();
    if (mode === "selected") {
      drawHandle(context, transform.x, transform.y);
      drawHandle(context, transform.x + transform.width, transform.y);
      drawHandle(context, transform.x, transform.y + transform.height);
      drawHandle(context, transform.x + transform.width, transform.y + transform.height);
    }
  });
  context.restore();
}

function drawShapeElementOverlay(
  context: CanvasRenderingContext2D,
  element: ShapeElement,
  mode: SceneElementOverlayMode,
): void {
  const padding = 5;
  const { transform } = element;
  const centerX = transform.x + transform.width / 2;
  const centerY = transform.y + transform.height / 2;
  context.save();
  context.translate(centerX, centerY);
  context.rotate(((transform.rotation ?? 0) * Math.PI) / 180);
  context.translate(-centerX, -centerY);
  const selected = mode === "selected" || mode === "multi-selected";
  context.strokeStyle = themedInk(overlayInk(mode));
  context.fillStyle = themedInk("#ffffff");
  context.lineWidth = selected ? 1.6 : 1.2;
  context.setLineDash(selected ? [5, 4] : [4, 4]);
  traceCatalogShapeOutline(context, element.shapeKind, {
    x: transform.x - padding,
    y: transform.y - padding,
    width: transform.width + padding * 2,
    height: transform.height + padding * 2,
  });
  context.stroke();
  if (mode === "selected") {
    drawHandle(context, transform.x, transform.y);
    drawHandle(context, transform.x + transform.width, transform.y);
    drawHandle(context, transform.x, transform.y + transform.height);
    drawHandle(context, transform.x + transform.width, transform.y + transform.height);
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
