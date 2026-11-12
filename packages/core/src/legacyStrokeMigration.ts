import { boardDiagramGraph, type BoardDiagramGraph } from "./boardDiagramGraph.ts";
import { createRichTextDocument, DEFAULT_SHAPE_STYLE, shapeKindForNodeType } from "./sceneElements.ts";
import { isBoardSceneElement, SHAPE_KINDS } from "./sceneValidation.ts";
import { BOARD_SCENE_VERSION } from "./types.ts";
import type {
  AnnotationBounds,
  AnnotationPoint,
  BoardElementTransform,
  BoardJsonValue,
  BoardSceneElement,
  BoardState,
  ConnectorElement,
  DrawingElement,
  SectionElement,
  ShapeElement,
  ShapeKind,
  StickyElement,
  Stroke,
  StrokeAnnotation,
  TextElement,
} from "./types.ts";

/**
 * One-off conversion of saved boards from the legacy stroke model to v2
 * scene elements (shape-merge phase 2, run once over production with the
 * owner's approval; see Docs/Refactoring Plan.md).
 *
 * Every committed or deleted stroke in `state.strokes` becomes the v2
 * element it stands for, under the same id, and leaves `strokes`:
 *
 * - a diagram node (flow_node, rectangle, ellipse; the 13 node types) becomes
 *   a shape of the catalogue kind Airo draws for that node type now, with the
 *   same label, box and colours, and `metadata.nodeType`/`nodeShape` so Airo
 *   and the evals still call it a "decision", "database" and so on;
 * - a pointer (an outlined ellipse) and a boxed highlight become shapes too
 *   (an ellipse; a translucent rounded rectangle), named "pointer" and
 *   "highlight" in their metadata so the diagram graph keeps them as marks;
 * - a sticky note becomes a sticky, a text label a text element;
 * - a connector or arrow becomes a v2 connector bound to the same two
 *   objects (now v2 under the same ids), with the same label, direction,
 *   line style, lane (routeOffset) and colour, in the bold weight Airo draws;
 * - a group container becomes a section holding its members (each member's
 *   sectionId points at it);
 * - ink: plain marker strokes and the annotation types drawn as ink
 *   (freehand, cross_mark, a highlight with no box) become v2 drawing
 *   elements with the same points, colour, width and opacity. The board
 *   already draws v2 drawings (freehand drawing has committed them since
 *   before phase 1), and phase 3 drops `strokes` altogether, so nothing is
 *   left behind in the legacy model.
 *
 * The scene "mirror" the reducer kept for each stroke (an element with
 * `legacyStrokeId`, or under the stroke's id) is replaced by the converted
 * element, so nothing is drawn twice. A mirror whose stroke is gone was
 * already drawn as a v2 element; it only loses its `legacyStrokeId`.
 *
 * Converted elements sit below every existing v2 element (the legacy painter
 * drew all strokes first), sections lowest, then connectors, then the rest,
 * each in stroke order, as the legacy painter ordered them.
 *
 * The function is pure and idempotent: a board with no legacy data comes
 * back unchanged (`changed: false`), and converting a converted board again
 * changes nothing.
 */

/** A saved board as stored: any part may be missing on very old rows. */
export type LegacyBoardStateInput =
  Partial<Omit<BoardState, "strokes" | "elements">> & {
    boardId?: string;
    strokes?: Record<string, Stroke>;
    elements?: Record<string, BoardSceneElement>;
  };

export type LegacyBoardConversion = {
  state: BoardState;
  /** False when the board held no legacy data; `state` then equals the input. */
  changed: boolean;
  /** Committed strokes with an annotation that were converted (the count the migration is approved for). */
  annotationStrokeIds: string[];
  /** Every stroke converted, annotation or ink, committed or deleted. */
  convertedStrokeIds: string[];
  /** Ids of the elements the conversion wrote (the same ids as the strokes). */
  addedElementIds: string[];
  /** Mirror elements replaced by the converted element of the same id. */
  replacedMirrorIds: string[];
  /** Mirrors whose stroke was gone, kept as v2 elements without legacyStrokeId. */
  orphanMirrorIds: string[];
};

/** The weight Airo's connectors are drawn in (diagramCommands AIRO_CONNECTOR_THICKNESS). */
const AIRO_CONNECTOR_THICKNESS: ConnectorElement["style"]["thickness"] = "thick";
/** Legacy node defaults, as the legacy painter filled a node with no colour. */
const LEGACY_NODE_FILL = "#f8fafc";
const LEGACY_HIGHLIGHT_FILL = "#fde68a";
const LEGACY_HIGHLIGHT_STROKE = "rgba(202, 138, 4, 0.45)";
const LEGACY_HIGHLIGHT_OPACITY = 0.28;
const LEGACY_GROUP_FILL = "rgba(248, 250, 252, 0.08)";
const SHAPE_KIND_SET = new Set<string>(SHAPE_KINDS);
const NODE_ANNOTATION_TYPES = new Set<string>(["flow_node", "rectangle", "ellipse"]);
/** Annotation types the legacy painter drew as ink along the stroke's points. */
const INK_ANNOTATION_TYPES = new Set<string>(["freehand", "cross_mark"]);

export function isLegacyEdgeAnnotation(annotation: StrokeAnnotation | undefined): boolean {
  return annotation?.type === "connector" || annotation?.type === "arrow";
}

function isLegacyGroupAnnotation(annotation: StrokeAnnotation | undefined): boolean {
  return Boolean(annotation?.bounds) && !isLegacyEdgeAnnotation(annotation) &&
    (annotation?.groupMemberStrokeIds?.length ?? 0) > 0;
}

/** Strokes the conversion rewrites: committed or deleted (an in-progress stroke is left alone). */
function isConvertibleStroke(stroke: Stroke | undefined): stroke is Stroke {
  return Boolean(stroke && typeof stroke === "object" && (stroke.status === "committed" || stroke.status === "deleted"));
}

/** Committed annotation strokes: what the approved production count counts. */
export function legacyAnnotationStrokeIds(state: LegacyBoardStateInput): string[] {
  return Object.values(state.strokes ?? {})
    .filter((stroke) => stroke?.status === "committed" && Boolean(stroke.annotation))
    .map((stroke) => stroke.id);
}

/** True when the board still holds anything in the legacy model. */
export function boardHasLegacyData(state: LegacyBoardStateInput): boolean {
  return Object.values(state.strokes ?? {}).some(isConvertibleStroke) ||
    Object.values(state.elements ?? {}).some((element) => Boolean(element?.legacyStrokeId));
}

export function convertLegacyBoardState(input: LegacyBoardStateInput): LegacyBoardConversion {
  const strokes = input.strokes ?? {};
  const sourceElements = input.elements ?? {};
  const boardId = input.boardId ?? Object.values(strokes)[0]?.boardId ?? "";
  const converting = Object.values(strokes).filter(isConvertibleStroke);
  const convertingIds = new Set(converting.map((stroke) => stroke.id));

  const base: BoardState = {
    ...(input as BoardState),
    boardId,
    sceneVersion: BOARD_SCENE_VERSION,
    elements: sourceElements,
    strokes,
    activeStrokes: input.activeStrokes ?? {},
    eraseActions: input.eraseActions ?? {},
    participants: input.participants ?? {},
    cursors: input.cursors ?? {},
    lastSequence: Number.isSafeInteger(input.lastSequence) ? Number(input.lastSequence) : 0,
  };
  if (!boardHasLegacyData(input)) {
    return {
      state: base,
      changed: false,
      annotationStrokeIds: [],
      convertedStrokeIds: [],
      addedElementIds: [],
      replacedMirrorIds: [],
      orphanMirrorIds: [],
    };
  }

  // Mirrors of strokes being converted go; v2 elements of their own stay.
  const replacedMirrorIds: string[] = [];
  const orphanMirrorIds: string[] = [];
  const kept: Record<string, BoardSceneElement> = {};
  for (const [id, element] of Object.entries(sourceElements)) {
    const mirroredStrokeId = element.legacyStrokeId;
    if (convertingIds.has(id) || (mirroredStrokeId && convertingIds.has(mirroredStrokeId))) {
      replacedMirrorIds.push(id);
      continue;
    }
    if (mirroredStrokeId) {
      // Its stroke is gone (or still being drawn): the board already shows
      // this element as v2, so it only drops the bridge field.
      const { legacyStrokeId: _bridge, ...rest } = element;
      kept[id] = rest as BoardSceneElement;
      orphanMirrorIds.push(id);
      continue;
    }
    kept[id] = element;
  }

  // Legacy painter order: every stroke under every v2 element, connectors
  // under nodes; sections go lowest so they never cover their members.
  const groups = converting.filter((stroke) => isLegacyGroupAnnotation(stroke.annotation));
  const edges = converting.filter((stroke) => isLegacyEdgeAnnotation(stroke.annotation));
  const rest = converting.filter((stroke) => !groups.includes(stroke) && !edges.includes(stroke));
  const ordered = [...groups, ...edges, ...rest];
  const keptZ = Object.values(kept).map((element) => element.zIndex).filter(Number.isFinite);
  const firstZ = keptZ.length > 0 ? Math.min(...keptZ) - ordered.length : 0;

  const converted: Record<string, BoardSceneElement> = {};
  ordered.forEach((stroke, index) => {
    const mirror = sourceElements[stroke.id];
    converted[stroke.id] = convertStroke(stroke, {
      boardId: stroke.boardId || boardId,
      zIndex: firstZ + index,
      revision: Math.max(0, Number.isSafeInteger(mirror?.revision) ? Number(mirror?.revision) : 0) + 1,
    });
  });

  const elements: Record<string, BoardSceneElement> = { ...kept, ...converted };

  // Sections own their members: drop members that no longer exist and point
  // each member back at its section (the first, when a stroke was in two).
  for (const stroke of groups) {
    const section = elements[stroke.id] as SectionElement;
    section.memberIds = section.memberIds.filter((memberId) => memberId !== section.id && Boolean(elements[memberId]));
    for (const memberId of section.memberIds) {
      const member = elements[memberId]!;
      if (member.sectionId && elements[member.sectionId]?.kind === "section") continue;
      elements[memberId] = { ...member, sectionId: section.id } as BoardSceneElement;
    }
  }

  const remainingStrokes = Object.fromEntries(
    Object.entries(strokes).filter(([id]) => !convertingIds.has(id)),
  );
  return {
    state: { ...base, elements, strokes: remainingStrokes },
    changed: true,
    annotationStrokeIds: converting
      .filter((stroke) => stroke.status === "committed" && stroke.annotation)
      .map((stroke) => stroke.id),
    convertedStrokeIds: ordered.map((stroke) => stroke.id),
    addedElementIds: Object.keys(converted),
    replacedMirrorIds,
    orphanMirrorIds,
  };
}

type ConvertOptions = { boardId: string; zIndex: number; revision: number };

function convertStroke(stroke: Stroke, options: ConvertOptions): BoardSceneElement {
  const annotation = stroke.annotation;
  if (annotation && isLegacyEdgeAnnotation(annotation)) return convertEdge(stroke, annotation, options);
  if (annotation?.bounds) {
    if (isLegacyGroupAnnotation(annotation)) return convertGroup(stroke, annotation, annotation.bounds, options);
    if (annotation.type === "sticky_note") return convertSticky(stroke, annotation, annotation.bounds, options);
    if (annotation.type === "text_label") return convertText(stroke, annotation, annotation.bounds, options);
    if (
      NODE_ANNOTATION_TYPES.has(annotation.type) ||
      annotation.type === "pointer" ||
      annotation.type === "highlight" ||
      catalogShapeKind(annotation.shapeKind)
    ) {
      return convertShape(stroke, annotation, annotation.bounds, options);
    }
  }
  return convertInk(stroke, options);
}

function shared(stroke: Stroke, options: ConvertOptions, transform: BoardElementTransform) {
  return {
    id: stroke.id,
    boardId: options.boardId,
    status: stroke.status === "deleted" ? "deleted" : "active",
    transform,
    zIndex: options.zIndex,
    locked: false,
    visible: true,
    ...(stroke.userId ? { creatorId: stroke.userId } : {}),
    createdAt: stroke.createdAt || stroke.updatedAt || new Date(0).toISOString(),
    updatedAt: stroke.updatedAt || stroke.createdAt || new Date(0).toISOString(),
    revision: options.revision,
  } as const;
}

/** Where the legacy object came from, kept on the element (the old mirror dropped it). */
function provenance(annotation: StrokeAnnotation | undefined, extra: Record<string, BoardJsonValue> = {}): Record<string, BoardJsonValue> {
  const metadata: Record<string, BoardJsonValue> = { ...extra, convertedFrom: "legacy_stroke" };
  if (annotation?.source) metadata.source = annotation.source;
  if (typeof annotation?.confidence === "number" && Number.isFinite(annotation.confidence)) {
    metadata.confidence = annotation.confidence;
  }
  return metadata;
}

function catalogShapeKind(value: unknown): ShapeKind | null {
  return typeof value === "string" && SHAPE_KIND_SET.has(value) ? value as ShapeKind : null;
}

function transformFromBounds(bounds: AnnotationBounds): BoardElementTransform {
  return {
    x: bounds.x,
    y: bounds.y,
    width: Math.max(1, bounds.width),
    height: Math.max(1, bounds.height),
    rotation: 0,
  };
}

function boundsBetween(start: AnnotationPoint, end: AnnotationPoint): BoardElementTransform {
  return {
    x: Math.min(start.x, end.x),
    y: Math.min(start.y, end.y),
    width: Math.max(1, Math.abs(end.x - start.x)),
    height: Math.max(1, Math.abs(end.y - start.y)),
    rotation: 0,
  };
}

function opacityOf(value: number | undefined, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : fallback;
}

/** The catalogue shape the legacy painter's outline matches. */
function legacyNodeShapeKind(annotation: StrokeAnnotation): ShapeKind {
  const catalogue = catalogShapeKind(annotation.shapeKind);
  if (catalogue) return catalogue;
  if (annotation.type === "ellipse" || annotation.type === "pointer") return "ellipse";
  if (annotation.type === "highlight") return "rounded-rectangle";
  // A flow_node or rectangle: the node type's shape, or a plain box.
  return annotation.nodeType ? shapeKindForNodeType(annotation.nodeType) : "square";
}

function convertShape(
  stroke: Stroke,
  annotation: StrokeAnnotation,
  bounds: AnnotationBounds,
  options: ConvertOptions,
): ShapeElement {
  const shapeKind = legacyNodeShapeKind(annotation);
  const highlight = annotation.type === "highlight";
  // The legacy painter filled an ellipse or pointer only when it had a fill
  // colour, a highlight always (yellow), and any other node in near-white.
  const outlineOnly = (annotation.type === "ellipse" || annotation.type === "pointer") &&
    !catalogShapeKind(annotation.shapeKind) && !annotation.fillColor;
  const opacity = opacityOf(annotation.opacity, highlight ? LEGACY_HIGHLIGHT_OPACITY : 1);
  return {
    ...shared(stroke, options, transformFromBounds(bounds)),
    kind: "shape",
    shapeKind,
    content: createRichTextDocument(annotation.label ?? "", `${stroke.id}:content`),
    style: {
      ...DEFAULT_SHAPE_STYLE,
      fill: annotation.fillColor ?? (highlight ? LEGACY_HIGHLIGHT_FILL : LEGACY_NODE_FILL),
      fillOpacity: outlineOnly ? 0 : opacity,
      stroke: annotation.strokeColor ?? (highlight ? LEGACY_HIGHLIGHT_STROKE : stroke.color),
      strokeOpacity: opacity,
      strokeWidth: Number.isFinite(stroke.thickness) ? stroke.thickness : DEFAULT_SHAPE_STYLE.strokeWidth,
    },
    // As Airo's own shapes: named by their diagram type while they keep the
    // shape they were drawn with.
    metadata: provenance(annotation, {
      nodeType: annotation.nodeType ?? annotation.type,
      nodeShape: shapeKind,
    }),
  };
}

function convertSticky(
  stroke: Stroke,
  annotation: StrokeAnnotation,
  bounds: AnnotationBounds,
  options: ConvertOptions,
): StickyElement {
  const transform = transformFromBounds(bounds);
  return {
    ...shared(stroke, options, transform),
    kind: "sticky",
    content: createRichTextDocument(annotation.label ?? "", `${stroke.id}:content`),
    layout: transform.width === transform.height ? "square" : "rectangle",
    color: annotation.fillColor ?? LEGACY_NODE_FILL,
    // Legacy notes never showed their author's initials.
    authorVisible: false,
    metadata: provenance(annotation),
  };
}

function convertText(
  stroke: Stroke,
  annotation: StrokeAnnotation,
  bounds: AnnotationBounds,
  options: ConvertOptions,
): TextElement {
  return {
    ...shared(stroke, options, transformFromBounds(bounds)),
    kind: "text",
    content: createRichTextDocument(annotation.label ?? "", `${stroke.id}:content`),
    mode: "area",
    style: {
      preset: "simple",
      color: annotation.strokeColor ?? stroke.color,
      fontSize: 18,
      align: "left",
      verticalAlign: "top",
    },
    metadata: provenance(annotation),
  };
}

function convertGroup(
  stroke: Stroke,
  annotation: StrokeAnnotation,
  bounds: AnnotationBounds,
  options: ConvertOptions,
): SectionElement {
  return {
    ...shared(stroke, options, transformFromBounds(bounds)),
    kind: "section",
    title: createRichTextDocument(annotation.label ?? "Group", `${stroke.id}:title`),
    titleVisible: true,
    collapsed: false,
    lockMode: "none",
    memberIds: [...new Set(annotation.groupMemberStrokeIds ?? [])],
    style: {
      fill: annotation.fillColor ?? LEGACY_GROUP_FILL,
      fillOpacity: opacityOf(annotation.opacity, 1),
      stroke: annotation.strokeColor ?? stroke.color,
    },
    metadata: provenance(annotation),
  };
}

function pointOf(point: { x: number; y: number } | undefined): AnnotationPoint | undefined {
  return point && Number.isFinite(point.x) && Number.isFinite(point.y) ? { x: point.x, y: point.y } : undefined;
}

function convertEdge(stroke: Stroke, annotation: StrokeAnnotation, options: ConvertOptions): ConnectorElement {
  const start = pointOf(annotation.start) ?? pointOf(stroke.points[0]) ?? { x: 0, y: 0 };
  const end = pointOf(annotation.end) ?? pointOf(stroke.points.at(-1)) ?? start;
  const connector: ConnectorElement = {
    ...shared(stroke, options, boundsBetween(start, end)),
    kind: "connector",
    // The legacy painter bent a connector at right angles and drew an arrow straight.
    pathKind: annotation.type === "connector" ? "bent" : "straight",
    start: {
      point: start,
      decoration: "none",
      ...(annotation.snappedStartStrokeId
        ? { binding: { elementId: annotation.snappedStartStrokeId, anchor: "auto" as const } }
        : {}),
    },
    end: {
      point: end,
      decoration: "solid_arrow",
      ...(annotation.snappedEndStrokeId
        ? { binding: { elementId: annotation.snappedEndStrokeId, anchor: "auto" as const } }
        : {}),
    },
    controlPoints: [],
    label: createRichTextDocument(annotation.label ?? "", `${stroke.id}:label`),
    labelPosition: 0.5,
    style: {
      color: annotation.strokeColor ?? stroke.color,
      opacity: opacityOf(annotation.opacity, 1),
      // Airo drew every legacy connector 3px with a large head; anything
      // that thick is drawn in Airo's bold weight, a thinner hand line thin.
      thickness: !Number.isFinite(stroke.thickness) || stroke.thickness >= 3 ? AIRO_CONNECTOR_THICKNESS : "thin",
      strokeStyle: annotation.lineStyle ?? "solid",
      labelBackground: "none",
    },
    metadata: provenance(annotation),
  };
  if (typeof annotation.routeOffset === "number" && Number.isFinite(annotation.routeOffset) && annotation.routeOffset !== 0) {
    connector.routeOffset = annotation.routeOffset;
  }
  return connector;
}

function convertInk(stroke: Stroke, options: ConvertOptions): DrawingElement {
  const annotation = stroke.annotation;
  const points = Array.isArray(stroke.points) ? stroke.points : [];
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  const transform = points.length > 0
    ? {
      x: Math.min(...xs),
      y: Math.min(...ys),
      width: Math.max(1, Math.max(...xs) - Math.min(...xs)),
      height: Math.max(1, Math.max(...ys) - Math.min(...ys)),
      rotation: 0,
    }
    : transformFromBounds(annotation?.bounds ?? { x: 0, y: 0, width: 1, height: 1 });
  return {
    ...shared(stroke, options, transform),
    kind: "drawing",
    // "highlighter" would dim it again (alpha x0.48) and force an 8px minimum;
    // the legacy opacity already carries the highlight look.
    drawingKind: "marker",
    points,
    style: {
      color: annotation?.strokeColor ?? stroke.color,
      thickness: Number.isFinite(stroke.thickness) ? stroke.thickness : 4,
      opacity: opacityOf(annotation?.opacity, 1),
      // Drawn through every point, as the legacy painter drew it.
      straight: false,
    },
    ...(annotation ? { metadata: provenance(annotation, { legacyType: annotation.type }) } : {}),
  };
}

/** What PATCH /boards/:id accepts (apps/api controlPlaneRoutes.ts): at most this many JSON characters. */
export const MAX_SAVED_BOARD_STATE_CHARS = 2_000_000;

/**
 * Checks a converted board as the API and the board would: the API's save
 * limit, every element a valid scene element under its own key, no legacy
 * data left, and every connector binding and section member present.
 * Returns the problems found (empty when it passes).
 */
export function validateConvertedBoardState(state: BoardState): string[] {
  const problems: string[] = [];
  const size = JSON.stringify(state).length;
  if (size > MAX_SAVED_BOARD_STATE_CHARS) problems.push(`state is ${size} characters; the API accepts ${MAX_SAVED_BOARD_STATE_CHARS}`);
  if (state.sceneVersion !== BOARD_SCENE_VERSION) problems.push(`sceneVersion is ${String(state.sceneVersion)}`);
  for (const [id, element] of Object.entries(state.elements ?? {})) {
    if (!isBoardSceneElement(element)) problems.push(`element ${id} is not a valid scene element`);
    else if (element.id !== id) problems.push(`element ${id} has id ${element.id}`);
    if (element?.legacyStrokeId) problems.push(`element ${id} still mirrors stroke ${element.legacyStrokeId}`);
    if (element?.kind === "connector") {
      for (const end of [element.start, element.end]) {
        const target = end.binding?.elementId;
        if (target && !state.elements[target]) problems.push(`connector ${id} is bound to missing ${target}`);
      }
    }
    if (element?.kind === "section") {
      for (const memberId of element.memberIds) {
        if (!state.elements[memberId]) problems.push(`section ${id} lists missing member ${memberId}`);
      }
    }
  }
  for (const stroke of Object.values(state.strokes ?? {})) {
    if (isConvertibleStroke(stroke)) problems.push(`stroke ${stroke.id} is still ${stroke.status}`);
  }
  return problems;
}

/** Legacy kinds the v2 element names differently; everything else keeps its kind. */
const CONVERTED_KIND: Readonly<Record<string, string>> = { text_label: "text" };

/**
 * Differences between the diagram a board showed before conversion and after
 * it, as boardDiagramGraph sees them, ignoring the model fields (model,
 * objectType, edge geometry, a group's container kind). Expected changes are
 * not differences: a text label is now named "text"; ink marks (freehand,
 * cross_mark) become v2 drawings, which the graph does not list; a section
 * leaves out members that no longer exist; an orphan mirror now shows as the
 * v2 element it always was. Returns one line per difference (empty when the
 * diagram is the same).
 */
export function legacyConversionGraphDiff(before: LegacyBoardStateInput, after: BoardState): string[] {
  const normalizedBefore: BoardState = {
    boardId: before.boardId ?? after.boardId,
    sceneVersion: BOARD_SCENE_VERSION,
    elements: before.elements ?? {},
    strokes: before.strokes ?? {},
    activeStrokes: before.activeStrokes ?? {},
    eraseActions: before.eraseActions ?? {},
    participants: before.participants ?? {},
    cursors: before.cursors ?? {},
    lastSequence: 0,
  };
  const left = boardDiagramGraph(normalizedBefore);
  const right = boardDiagramGraph(after);
  const orphanMirrors = new Set(
    Object.values(normalizedBefore.elements)
      .filter((element) => element.legacyStrokeId && !normalizedBefore.strokes[element.legacyStrokeId] && !normalizedBefore.strokes[element.id])
      .map((element) => element.id),
  );
  const problems: string[] = [];
  const round = (value: number) => Math.round(value * 100) / 100;
  const box = (bounds: AnnotationBounds) =>
    `${round(bounds.x)},${round(bounds.y)} ${round(Math.max(1, bounds.width))}x${round(Math.max(1, bounds.height))}`;

  const compare = <T extends { id: string }>(
    what: string,
    beforeItems: readonly T[],
    afterItems: readonly T[],
    view: (item: T, graph: BoardDiagramGraph) => Record<string, unknown>,
    expectedGone: (item: T) => boolean,
    expectedNew: (item: T) => boolean,
  ) => {
    const afterById = new Map(afterItems.map((item) => [item.id, item]));
    for (const item of beforeItems) {
      const next = afterById.get(item.id);
      if (!next) {
        if (!expectedGone(item)) problems.push(`${what} ${item.id} is gone`);
        continue;
      }
      const was = JSON.stringify(view(item, left));
      const now = JSON.stringify(view(next, right));
      if (was !== now) problems.push(`${what} ${item.id} changed: ${was} -> ${now}`);
    }
    const beforeIds = new Set(beforeItems.map((item) => item.id));
    for (const item of afterItems) {
      if (!beforeIds.has(item.id) && !expectedNew(item)) problems.push(`${what} ${item.id} is new`);
    }
  };

  const existsAfter = (id: string) => Boolean(after.elements[id]);
  compare(
    "node",
    left.nodes,
    right.nodes,
    (node) => ({
      // (Not `name`: a blank v2 shape is named by its catalogue shape, a
      // blank legacy node by its type; label and kind say the same.)
      label: node.label,
      kind: CONVERTED_KIND[node.kind] ?? node.kind,
      role: node.role,
      bounds: box(node.bounds),
      groups: [...node.groupIds].filter(existsAfter).sort(),
    }),
    (node) => node.model === "stroke" && INK_ANNOTATION_TYPES.has(node.objectType) && after.elements[node.id]?.kind === "drawing",
    (node) => orphanMirrors.has(node.id),
  );
  compare(
    "edge",
    left.edges,
    right.edges,
    (edge) => ({
      from: edge.from,
      to: edge.to,
      label: edge.label,
      directed: edge.directed,
      lineStyle: edge.lineStyle,
      attached: edge.attached,
      routeOffset: edge.geometry.routeOffset ?? 0,
    }),
    () => false,
    (edge) => orphanMirrors.has(edge.id),
  );
  compare(
    "group",
    left.groups,
    right.groups,
    (group) => ({
      label: group.label,
      bounds: box(group.bounds),
      members: [...group.memberIds].filter(existsAfter).sort(),
    }),
    () => false,
    (group) => orphanMirrors.has(group.id),
  );
  return problems;
}
