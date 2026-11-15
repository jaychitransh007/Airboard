import { applyBoardEvent, reduceBoardEvents } from "./boardReducer.ts";
import {
  boardDiagramGraph,
  type BoardDiagramEdge,
  type BoardDiagramGroup,
  type BoardDiagramNode,
} from "./boardDiagramGraph.ts";
import { DEFAULT_CONNECTOR_ATTACHMENT_TOLERANCE } from "./diagramCommands.ts";
import { pointOnNodeBoundary } from "./nodeVisuals.ts";
import { createRichTextDocument, DEFAULT_SHAPE_STYLE, shapeKindForNodeType } from "./sceneElements.ts";
import { isBoardSceneElement, SHAPE_KINDS } from "./sceneValidation.ts";
import { BOARD_SCENE_VERSION } from "./types.ts";
import type {
  AnnotationBounds,
  AnnotationNodeType,
  AnnotationPoint,
  AnnotationSource,
  BoardElementTransform,
  BoardEvent,
  BoardJsonValue,
  BoardSceneElement,
  BoardState,
  ConnectorElement,
  DrawingElement,
  EraseAction,
  SectionElement,
  ShapeElement,
  ShapeKind,
  StickyElement,
  Stroke,
  StrokePoint,
  TextElement,
} from "./types.ts";

/**
 * The legacy annotation-stroke model, and the only code that still reads it.
 *
 * Until November 2026 Airo drew diagrams as annotation strokes
 * (`BoardState.strokes`, written by the `stroke.*` events), mirrored into
 * scene elements carrying `legacyStrokeId`. Shape-merge phase 2 converted
 * every saved production board once (scripts/convert-legacy-boards.mjs);
 * phase 3 removed the model from the board. What is left reads it:
 *
 * - convertLegacyBoardState: the conversion (also the documented tool for a
 *   board restored from a backup taken before phase 2);
 * - upgradeLegacyBoardState: converts a board as it is loaded, so a saved
 *   legacy board still opens with every shape;
 * - replayBoardEvents: reduces stored board_events rows, converting any
 *   retired stroke.* or erase.committed rows (the API's live-session state);
 * - LEGACY_BOARD_EVENT_TYPES: the retired event types the API refuses.
 *
 * Every committed or deleted stroke in `state.strokes` becomes the v2
 * element it stands for, under the same id:
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
 *   elements with the same points, colour, width and opacity.
 *
 * A stroke still being drawn (status "active") is dropped. The output has no
 * `strokes` key.
 *
 * The scene "mirror" the old reducer kept for each stroke (an element with
 * `legacyStrokeId`, or under the stroke's id) is replaced by the converted
 * element, so nothing is drawn twice. A mirror whose stroke is gone was
 * already drawn as a v2 element; it only loses its `legacyStrokeId`.
 *
 * Converted elements sit below every existing v2 element (the legacy painter
 * drew all strokes first), sections lowest, then connectors, then the rest,
 * each in stroke order, as the legacy painter ordered them.
 *
 * The conversion is pure, deterministic (no clock, no random ids) and
 * idempotent: a board with no legacy data comes back unchanged apart from
 * defaults (`changed: false`), and converting a converted board again changes
 * nothing.
 */

type LegacyAnnotationObjectType =
  | "pointer"
  | "ellipse"
  | "arrow"
  | "highlight"
  | "rectangle"
  | "flow_node"
  | "connector"
  | "text_label"
  | "sticky_note"
  | "cross_mark"
  | "freehand";

/** What a legacy annotation stroke stood for (the old `StrokeAnnotation`). */
type LegacyStrokeAnnotation = {
  type: LegacyAnnotationObjectType;
  source: AnnotationSource;
  confidence?: number;
  bounds?: AnnotationBounds;
  start?: AnnotationPoint;
  end?: AnnotationPoint;
  label?: string;
  nodeType?: AnnotationNodeType;
  /** Catalog-backed shape identity; older clients continue to use nodeType. */
  shapeKind?: ShapeKind;
  snappedStartStrokeId?: string;
  snappedEndStrokeId?: string;
  /** Signed board-space lane displacement for parallel or reciprocal connectors. */
  routeOffset?: number;
  /** Connector line pattern; absent means solid. */
  lineStyle?: "dashed" | "dotted";
  fillColor?: string;
  strokeColor?: string;
  opacity?: number;
  /** Group membership: a group container lists its members, each member names its group. */
  groupId?: string;
  groupMemberStrokeIds?: string[];
};

type LegacyStroke = Stroke & { annotation?: LegacyStrokeAnnotation };

/** A scene element as saved by the old reducer: a mirror carries its stroke's id. */
type LegacyElement = BoardSceneElement & { legacyStrokeId?: string };

/** A saved board as stored: any part may be missing on very old rows. */
export type LegacyBoardStateInput =
  Partial<Omit<BoardState, "elements" | "activeStrokes">> & {
    boardId?: string;
    strokes?: Record<string, LegacyStroke>;
    activeStrokes?: Record<string, Stroke>;
    elements?: Record<string, LegacyElement>;
  };

export type LegacyBoardConversion = {
  /** The board in the current model: no `strokes`, no mirrors. */
  state: BoardState;
  /** False when the board held no legacy data; `state` then equals the input with its defaults filled. */
  changed: boolean;
  /** Committed strokes with an annotation that were converted (the count the migration is approved for). */
  annotationStrokeIds: string[];
  /** Every stroke converted, annotation or ink, committed or deleted. */
  convertedStrokeIds: string[];
  /** Strokes left out: still being drawn when the board was saved. */
  droppedStrokeIds: string[];
  /** Ids of the elements the conversion wrote (the same ids as the strokes). */
  addedElementIds: string[];
  /** Mirror elements replaced by the converted element of the same id. */
  replacedMirrorIds: string[];
  /** Mirrors whose stroke was gone, kept as v2 elements without legacyStrokeId. */
  orphanMirrorIds: string[];
};

type LegacyEnvelope = {
  id: string;
  boardSessionId: string;
  actorParticipantId: string;
  sequence?: number;
  createdAt: string;
};

/** The retired events of the legacy model, as stored in board_events. */
export type LegacyBoardEvent = LegacyEnvelope & (
  | { type: "stroke.started"; stroke: LegacyStroke }
  | { type: "stroke.point_added"; strokeId: string; point: StrokePoint }
  | {
    type: "stroke.committed";
    strokeId: string;
    points?: StrokePoint[];
    discard?: boolean;
    cleanupApplied?: boolean;
    lineSnapApplied?: boolean;
    frictionProfile?: Stroke["frictionProfile"];
  }
  | { type: "stroke.label_updated"; strokeId: string; label: string }
  | { type: "stroke.annotation_updated"; strokeId: string; annotation: LegacyStrokeAnnotation; points: StrokePoint[] }
  | { type: "erase.committed"; eraseAction: EraseAction }
  | { type: "stroke.deleted"; strokeIds: string[] }
  | { type: "stroke.restored"; strokeIds: string[] }
);

/** The retired event types: stored rows still replay; the API refuses new ones. */
export const LEGACY_BOARD_EVENT_TYPES: readonly LegacyBoardEvent["type"][] = [
  "stroke.started",
  "stroke.point_added",
  "stroke.committed",
  "stroke.label_updated",
  "stroke.annotation_updated",
  "stroke.deleted",
  "stroke.restored",
  "erase.committed",
];

const LEGACY_EVENT_TYPE_SET = new Set<string>(LEGACY_BOARD_EVENT_TYPES);

export function isLegacyBoardEventType(type: unknown): type is LegacyBoardEvent["type"] {
  return typeof type === "string" && LEGACY_EVENT_TYPE_SET.has(type);
}

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

function isLegacyEdgeAnnotation(annotation: LegacyStrokeAnnotation | undefined): boolean {
  return annotation?.type === "connector" || annotation?.type === "arrow";
}

function isLegacyGroupAnnotation(annotation: LegacyStrokeAnnotation | undefined): boolean {
  return Boolean(annotation?.bounds) && !isLegacyEdgeAnnotation(annotation) &&
    (annotation?.groupMemberStrokeIds?.length ?? 0) > 0;
}

/** Strokes the conversion rewrites: committed or deleted (an in-progress stroke is dropped). */
function isConvertibleStroke(stroke: LegacyStroke | undefined): stroke is LegacyStroke {
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
  return convertBoard(input);
}

/**
 * The board in the current model, whatever it was saved in: a legacy board is
 * converted (convertLegacyBoardState), any `strokes` key is dropped and
 * missing parts are filled. Called wherever a saved or served board is read;
 * it writes nothing, and a converted board compares equal to itself next time
 * (the conversion is deterministic), so opening a board never saves it.
 */
export function upgradeLegacyBoardState(input: LegacyBoardStateInput): BoardState {
  return convertBoard(input).state;
}

function convertBoard(
  input: LegacyBoardStateInput,
  /** Mirror revisions replayBoardEvents tracked without keeping the mirrors. */
  mirrorRevisions?: ReadonlyMap<string, number>,
): LegacyBoardConversion {
  const strokes = input.strokes ?? {};
  const sourceElements = input.elements ?? {};
  const boardId = input.boardId ?? Object.values(strokes)[0]?.boardId ?? "";
  const converting = Object.values(strokes).filter(isConvertibleStroke);
  const convertingIds = new Set(converting.map((stroke) => stroke.id));
  const droppedStrokeIds = Object.keys(strokes).filter((id) => !convertingIds.has(id));

  const { strokes: _strokes, ...rest } = input;
  const base: BoardState = {
    ...(rest as BoardState),
    boardId,
    sceneVersion: BOARD_SCENE_VERSION,
    elements: sourceElements,
    activeStrokes: input.activeStrokes ?? {},
    eraseActions: input.eraseActions ?? {},
    participants: input.participants ?? {},
    cursors: input.cursors ?? {},
    lastSequence: Number.isSafeInteger(input.lastSequence) ? Number(input.lastSequence) : 0,
  };
  if (!boardHasLegacyData(input) && droppedStrokeIds.length === 0) {
    return {
      state: base,
      changed: false,
      annotationStrokeIds: [],
      convertedStrokeIds: [],
      droppedStrokeIds: [],
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
      const { legacyStrokeId: _bridge, ...element2 } = element;
      kept[id] = element2 as BoardSceneElement;
      orphanMirrorIds.push(id);
      continue;
    }
    kept[id] = element;
  }

  // Legacy painter order: every stroke under every v2 element, connectors
  // under nodes; sections go lowest so they never cover their members.
  const groups = converting.filter((stroke) => isLegacyGroupAnnotation(stroke.annotation));
  const edges = converting.filter((stroke) => isLegacyEdgeAnnotation(stroke.annotation));
  const others = converting.filter((stroke) => !groups.includes(stroke) && !edges.includes(stroke));
  const ordered = [...groups, ...edges, ...others];
  const keptZ = Object.values(kept).map((element) => element.zIndex).filter(Number.isFinite);
  const firstZ = keptZ.length > 0 ? Math.min(...keptZ) - ordered.length : 0;

  const converted: Record<string, BoardSceneElement> = {};
  ordered.forEach((stroke, index) => {
    const mirrorRevision = mirrorRevisions?.get(stroke.id) ?? sourceElements[stroke.id]?.revision;
    converted[stroke.id] = convertStroke(stroke, {
      boardId: stroke.boardId || boardId,
      zIndex: firstZ + index,
      revision: Math.max(0, Number.isSafeInteger(mirrorRevision) ? Number(mirrorRevision) : 0) + 1,
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

  return {
    state: { ...base, elements },
    changed: true,
    annotationStrokeIds: converting
      .filter((stroke) => stroke.status === "committed" && stroke.annotation)
      .map((stroke) => stroke.id),
    convertedStrokeIds: ordered.map((stroke) => stroke.id),
    droppedStrokeIds,
    addedElementIds: Object.keys(converted),
    replacedMirrorIds,
    orphanMirrorIds,
  };
}

type ConvertOptions = { boardId: string; zIndex: number; revision: number };

function convertStroke(stroke: LegacyStroke, options: ConvertOptions): BoardSceneElement {
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

function shared(stroke: LegacyStroke, options: ConvertOptions, transform: BoardElementTransform) {
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
function provenance(annotation: LegacyStrokeAnnotation | undefined, extra: Record<string, BoardJsonValue> = {}): Record<string, BoardJsonValue> {
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
function legacyNodeShapeKind(annotation: LegacyStrokeAnnotation): ShapeKind {
  const catalogue = catalogShapeKind(annotation.shapeKind);
  if (catalogue) return catalogue;
  if (annotation.type === "ellipse" || annotation.type === "pointer") return "ellipse";
  if (annotation.type === "highlight") return "rounded-rectangle";
  // A flow_node or rectangle: the node type's shape, or a plain box.
  return annotation.nodeType ? shapeKindForNodeType(annotation.nodeType) : "square";
}

function convertShape(
  stroke: LegacyStroke,
  annotation: LegacyStrokeAnnotation,
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
  stroke: LegacyStroke,
  annotation: LegacyStrokeAnnotation,
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
  stroke: LegacyStroke,
  annotation: LegacyStrokeAnnotation,
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
  stroke: LegacyStroke,
  annotation: LegacyStrokeAnnotation,
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

function convertEdge(stroke: LegacyStroke, annotation: LegacyStrokeAnnotation, options: ConvertOptions): ConnectorElement {
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

function convertInk(stroke: LegacyStroke, options: ConvertOptions): DrawingElement {
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
export function validateConvertedBoardState(state: LegacyBoardStateInput): string[] {
  const problems: string[] = [];
  const size = JSON.stringify(state).length;
  if (size > MAX_SAVED_BOARD_STATE_CHARS) problems.push(`state is ${size} characters; the API accepts ${MAX_SAVED_BOARD_STATE_CHARS}`);
  if (state.sceneVersion !== BOARD_SCENE_VERSION) problems.push(`sceneVersion is ${String(state.sceneVersion)}`);
  const elements = state.elements ?? {};
  for (const [id, element] of Object.entries(elements)) {
    if (!isBoardSceneElement(element)) problems.push(`element ${id} is not a valid scene element`);
    else if (element.id !== id) problems.push(`element ${id} has id ${element.id}`);
    if (element?.legacyStrokeId) problems.push(`element ${id} still mirrors stroke ${element.legacyStrokeId}`);
    if (element?.kind === "connector") {
      for (const end of [element.start, element.end]) {
        const target = end.binding?.elementId;
        if (target && !elements[target]) problems.push(`connector ${id} is bound to missing ${target}`);
      }
    }
    if (element?.kind === "section") {
      for (const memberId of element.memberIds) {
        if (!elements[memberId]) problems.push(`section ${id} lists missing member ${memberId}`);
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

/** `model: "stroke"` marks an item read from a legacy stroke; v2 items leave it out. */
type LegacyGraphNode = BoardDiagramNode & { model?: "stroke" };
type LegacyGraphEdge = Omit<BoardDiagramEdge, "geometry"> & {
  model?: "stroke";
  geometry: { routeOffset?: number };
};
type LegacyGraphGroup = BoardDiagramGroup & { model?: "stroke" };
type LegacyGraph = { nodes: LegacyGraphNode[]; edges: LegacyGraphEdge[]; groups: LegacyGraphGroup[] };

/**
 * Differences between the diagram a board showed before conversion and after
 * it, as boardDiagramGraph sees them, ignoring the fields that name the
 * model (objectType, edge geometry, a group's container kind). Expected changes are
 * not differences: a text label is now named "text"; ink marks (freehand,
 * cross_mark) become v2 drawings, which the graph does not list; a section
 * leaves out members that no longer exist; an orphan mirror now shows as the
 * v2 element it always was. Returns one line per difference (empty when the
 * diagram is the same).
 */
export function legacyConversionGraphDiff(before: LegacyBoardStateInput, after: BoardState): string[] {
  const strokes = before.strokes ?? {};
  const beforeElements = before.elements ?? {};
  const left = legacyDiagramGraph(before);
  const right = boardDiagramGraph(after);
  const orphanMirrors = new Set(
    Object.values(beforeElements)
      .filter((element) => element.legacyStrokeId && !strokes[element.legacyStrokeId] && !strokes[element.id])
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
    view: (item: T) => Record<string, unknown>,
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
      const was = JSON.stringify(view(item));
      const now = JSON.stringify(view(next));
      if (was !== now) problems.push(`${what} ${item.id} changed: ${was} -> ${now}`);
    }
    const beforeIds = new Set(beforeItems.map((item) => item.id));
    for (const item of afterItems) {
      if (!beforeIds.has(item.id) && !expectedNew(item)) problems.push(`${what} ${item.id} is new`);
    }
  };

  const existsAfter = (id: string) => Boolean(after.elements[id]);
  compare<LegacyGraphNode>(
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
  compare<LegacyGraphEdge>(
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
  compare<LegacyGraphGroup>(
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

const LEGACY_MARK_TYPES = new Set<string>(["highlight", "pointer", "text_label", "cross_mark", "freehand"]);

/**
 * The diagram a legacy board showed, as boardDiagramGraph read it before
 * phase 3: legacy nodes, edges and groups from the committed annotation
 * strokes (in stroke order), then the v2 elements that are no mirror (in
 * element order), every object once.
 */
function legacyDiagramGraph(input: LegacyBoardStateInput): LegacyGraph {
  const strokes = input.strokes ?? {};
  const elements = input.elements ?? {};
  const committed = Object.values(strokes).filter((stroke) => stroke?.status === "committed" && stroke.annotation);
  // The v2 part of the board: everything but the mirrors (and elements under a stroke's id).
  const sceneOnly = Object.fromEntries(
    Object.entries(elements).filter(([id, element]) => !element.legacyStrokeId && !strokes[id]),
  ) as Record<string, BoardSceneElement>;
  const scene = boardDiagramGraph({
    boardId: input.boardId ?? "",
    sceneVersion: BOARD_SCENE_VERSION,
    elements: sceneOnly,
    activeStrokes: {},
    eraseActions: {},
    participants: {},
    cursors: {},
    lastSequence: 0,
  });

  const groups: LegacyGraphGroup[] = [...committed.flatMap(legacyGroup), ...scene.groups];
  const groupIdsByMember = new Map<string, string[]>();
  for (const group of groups) {
    for (const memberId of group.memberIds) {
      const ids = groupIdsByMember.get(memberId) ?? [];
      if (!ids.includes(group.id)) ids.push(group.id);
      groupIdsByMember.set(memberId, ids);
    }
  }
  const groupIdsOf = (id: string, sectionId?: string): string[] => {
    const ids = [...(groupIdsByMember.get(id) ?? [])];
    if (sectionId && !ids.includes(sectionId) && groups.some((group) => group.id === sectionId)) ids.push(sectionId);
    return ids;
  };

  const nodes: LegacyGraphNode[] = [
    ...committed.flatMap((stroke) => legacyNode(stroke, groupIdsOf(stroke.id))),
    ...scene.nodes.map((node) => ({ ...node, groupIds: groupIdsOf(node.id, sceneOnly[node.id]?.sectionId) })),
  ];
  const edges: LegacyGraphEdge[] = [
    ...committed.flatMap((stroke) => legacyEdge(input, stroke)),
    // A v2 arrow may end at a legacy node: attached when it lies on the stroke's box.
    ...scene.edges.map((edge) => {
      const geometry = edge.geometry;
      return {
        ...edge,
        attached: Boolean(
          edge.from && edge.to &&
          sceneEndpointAttached(input, edge.from, geometry.start) &&
          sceneEndpointAttached(input, edge.to, geometry.end),
        ),
      };
    }),
  ];
  return { nodes, edges, groups };
}

function isLegacyGroup(stroke: LegacyStroke): boolean {
  return (stroke.annotation?.groupMemberStrokeIds?.length ?? 0) > 0;
}

function legacyNode(stroke: LegacyStroke, groupIds: string[]): LegacyGraphNode[] {
  const annotation = stroke.annotation;
  if (!annotation?.bounds || isLegacyEdgeAnnotation(annotation) || isLegacyGroup(stroke)) return [];
  const kind = annotation.nodeType ?? annotation.type;
  return [{
    id: stroke.id,
    label: annotation.label ?? null,
    name: annotation.label?.trim() || kind,
    kind,
    objectType: annotation.type,
    role: LEGACY_MARK_TYPES.has(annotation.type) ? "mark" : "shape",
    bounds: { ...annotation.bounds },
    model: "stroke",
    groupIds,
  }];
}

function legacyGroup(stroke: LegacyStroke): LegacyGraphGroup[] {
  const annotation = stroke.annotation;
  if (!annotation?.bounds || isLegacyEdgeAnnotation(annotation) || !isLegacyGroup(stroke)) return [];
  return [{
    id: stroke.id,
    label: annotation.label ?? null,
    kind: annotation.nodeType ?? annotation.type,
    objectType: annotation.type,
    bounds: { ...annotation.bounds },
    memberIds: [...(annotation.groupMemberStrokeIds ?? [])],
    model: "stroke",
  }];
}

function legacyEdge(input: LegacyBoardStateInput, stroke: LegacyStroke): LegacyGraphEdge[] {
  const annotation = stroke.annotation;
  if (!annotation || !isLegacyEdgeAnnotation(annotation)) return [];
  return [{
    id: stroke.id,
    from: annotation.snappedStartStrokeId ?? null,
    to: annotation.snappedEndStrokeId ?? null,
    label: annotation.label ?? null,
    directed: true,
    lineStyle: annotation.lineStyle ?? "solid",
    attached: connectorGeometryMatchesBindings(input, annotation),
    model: "stroke",
    geometry: annotation.routeOffset !== undefined ? { routeOffset: annotation.routeOffset } : {},
  }];
}

/** A legacy end is attached when it lies where its node's outline is. */
function connectorEndpointMatchesBinding(
  input: LegacyBoardStateInput,
  annotation: LegacyStrokeAnnotation,
  endpoint: "start" | "end",
): boolean {
  const boundId = endpoint === "start" ? annotation.snappedStartStrokeId : annotation.snappedEndStrokeId;
  const point = endpoint === "start" ? annotation.start : annotation.end;
  if (!boundId || !point) return false;
  const stroke: LegacyStroke | undefined = input.strokes?.[boundId] ?? input.activeStrokes?.[boundId];
  const bounds = stroke?.annotation?.bounds;
  if (!stroke || stroke.status === "deleted" || !bounds) return false;
  const expected = pointOnNodeBoundary(bounds, stroke.annotation?.nodeType, point);
  return Math.hypot(point.x - expected.x, point.y - expected.y) <= DEFAULT_CONNECTOR_ATTACHMENT_TOLERANCE;
}

/** True only when a legacy connector's bindings and drawn ends agree. */
function connectorGeometryMatchesBindings(input: LegacyBoardStateInput, annotation: LegacyStrokeAnnotation): boolean {
  if (
    !annotation.snappedStartStrokeId ||
    !annotation.snappedEndStrokeId ||
    !annotation.start ||
    !annotation.end ||
    !isLegacyEdgeAnnotation(annotation)
  ) {
    return false;
  }
  return connectorEndpointMatchesBinding(input, annotation, "start") &&
    connectorEndpointMatchesBinding(input, annotation, "end");
}

/** A v2 arrow's end is attached when it lies on or inside its object's box (legacy or v2). */
function sceneEndpointAttached(input: LegacyBoardStateInput, id: string, point: AnnotationPoint): boolean {
  const stroke = input.strokes?.[id];
  const element = input.elements?.[id];
  const bounds = stroke
    ? stroke.status === "committed" ? stroke.annotation?.bounds : undefined
    : element?.status === "active"
      ? { x: element.transform.x, y: element.transform.y, width: element.transform.width, height: element.transform.height }
      : undefined;
  if (!bounds) return false;
  const tolerance = DEFAULT_CONNECTOR_ATTACHMENT_TOLERANCE;
  return point.x >= bounds.x - tolerance && point.x <= bounds.x + bounds.width + tolerance &&
    point.y >= bounds.y - tolerance && point.y <= bounds.y + bounds.height + tolerance;
}

/**
 * Reduces stored board_events rows into the board they make. Rows in the
 * current model go through the reducer as they are; a log that still holds
 * retired stroke.* or erase.committed rows (a live session older than shape
 * phase 3) is replayed as the old reducer read it, and the strokes it built
 * are converted at the end (convertLegacyBoardState), so every shape survives
 * as the v2 element it stood for. They are converted earlier when a later
 * element.patched, element.deleted or element.restored row names one (a
 * phase-3 tab editing a converted shape), so that edit is applied to the
 * element rather than dropped. Strokes still being drawn when the log ends
 * are left out.
 */
export function replayBoardEvents(initial: BoardState, events: readonly unknown[]): BoardState {
  const rows = events as readonly (BoardEvent | LegacyBoardEvent)[];
  if (!rows.some((event) => isLegacyBoardEventType(event?.type))) {
    return reduceBoardEvents(initial, rows as readonly BoardEvent[]);
  }
  const legacy = new LegacyStrokeReplay((initial as LegacyBoardStateInput).strokes ?? {});
  let state = initial;
  for (const event of rows) {
    // A current tab edits a converted shape by its stroke id: the strokes so
    // far become elements first, so the edit lands on them (and is not
    // undone when the log is converted at the end).
    if (legacy.referencesStroke(event)) {
      state = convertBoard({ ...state, strokes: legacy.strokes }, legacy.mirrorRevisions).state;
      legacy.retireAll();
    }
    // A retired row falls into the reducer's default case: lastSequence advances.
    state = applyBoardEvent(state, event as BoardEvent);
    state = legacy.apply(state, event);
  }
  return convertBoard({ ...state, strokes: legacy.strokes }, legacy.mirrorRevisions).state;
}

/**
 * The stroke half of the pre-phase-3 reducer (boardReducer.ts at
 * launch-f5e326e), ported verbatim. It keeps the strokes privately; the
 * scene mirrors the old reducer kept are not rebuilt, only their revisions,
 * so the converted elements carry the revisions they would have had.
 */
class LegacyStrokeReplay {
  strokes: Record<string, LegacyStroke>;
  private active: Record<string, LegacyStroke> = {};
  readonly mirrorRevisions = new Map<string, number>();
  private readonly mirrorStatus = new Map<string, "active" | "deleted">();

  constructor(strokes: Record<string, LegacyStroke>) {
    this.strokes = strokes;
  }

  /** True for a current-model element row that names a stroke this replay still holds. */
  referencesStroke(event: BoardEvent | LegacyBoardEvent): boolean {
    if (event?.type !== "element.patched" && event?.type !== "element.deleted" && event?.type !== "element.restored") {
      return false;
    }
    return typeof event.elementId === "string" && Object.hasOwn(this.strokes, event.elementId);
  }

  /**
   * Forgets the strokes once they were converted into elements: later rows
   * reach those elements through the reducer (a retired stroke row naming
   * one still deletes or restores it, as markElementsStatus runs on elements).
   */
  retireAll(): void {
    for (const id of Object.keys(this.strokes)) {
      this.mirrorRevisions.delete(id);
      this.mirrorStatus.delete(id);
    }
    this.strokes = {};
  }

  apply(state: BoardState, event: BoardEvent | LegacyBoardEvent): BoardState {
    switch (event.type) {
      case "stroke.started":
        this.active = { ...this.active, [event.stroke.id]: event.stroke };
        return state;

      case "stroke.point_added": {
        const stroke = this.active[event.strokeId];
        if (stroke) this.active = { ...this.active, [event.strokeId]: appendPoint(stroke, event.point) };
        return state;
      }

      case "stroke.committed": {
        const stroke = this.active[event.strokeId];
        if (!stroke) return state;
        const { [event.strokeId]: _removed, ...remaining } = this.active;
        this.active = remaining;
        if (event.discard) return state;
        const committed: LegacyStroke = {
          ...stroke,
          points: event.points && event.points.length > 0 ? event.points : stroke.points,
          status: "committed",
          updatedAt: event.createdAt,
          committedAt: event.createdAt,
        };
        if (event.cleanupApplied !== undefined) committed.cleanupApplied = event.cleanupApplied;
        if (event.lineSnapApplied !== undefined) committed.lineSnapApplied = event.lineSnapApplied;
        if (event.frictionProfile) committed.frictionProfile = event.frictionProfile;
        this.strokes = { ...this.strokes, [event.strokeId]: committed };
        const previous = this.mirrorRevisions.get(event.strokeId) ?? state.elements[event.strokeId]?.revision ?? 0;
        this.mirrorRevisions.set(event.strokeId, previous + 1);
        this.mirrorStatus.set(event.strokeId, "active");
        return state;
      }

      case "stroke.label_updated":
      case "stroke.annotation_updated": {
        const id = event.strokeId;
        const stroke = this.strokes[id] ?? this.active[id];
        if (!stroke?.annotation) return state;
        const updated: LegacyStroke = event.type === "stroke.label_updated"
          ? { ...stroke, annotation: { ...stroke.annotation, label: event.label }, updatedAt: event.createdAt }
          : { ...stroke, annotation: event.annotation, points: event.points, updatedAt: event.createdAt };
        if (this.active[id]) {
          this.active = { ...this.active, [id]: updated };
          return state;
        }
        this.strokes = { ...this.strokes, [id]: updated };
        this.bumpMirror(id);
        return state;
      }

      case "erase.committed": {
        const { eraseAction } = event;
        this.setStrokeStatus(eraseAction.affectedStrokeIds, "deleted", event.createdAt);
        return {
          ...state,
          eraseActions: { ...state.eraseActions, [eraseAction.id]: eraseAction },
          elements: markElementsStatus(state.elements, eraseAction.affectedStrokeIds, "deleted", event.createdAt),
        };
      }

      case "stroke.deleted":
      case "stroke.restored": {
        const status = event.type === "stroke.deleted" ? "deleted" : "active";
        this.setStrokeStatus(event.strokeIds, status, event.createdAt);
        return { ...state, elements: markElementsStatus(state.elements, event.strokeIds, status, event.createdAt) };
      }

      case "board.cleared":
        this.setStrokeStatus(Object.keys(this.strokes), "deleted", event.createdAt);
        for (const id of this.mirrorStatus.keys()) this.flipMirror(id, "deleted");
        this.active = {};
        return state;

      case "element.deleted":
      case "element.restored":
        // The old reducer flipped a mirror like any element.
        this.flipMirror(event.elementId, event.type === "element.deleted" ? "deleted" : "active");
        return state;

      default:
        return state;
    }
  }

  /** Deletes or restores strokes (only those that exist), flipping their mirrors as the old reducer did. */
  private setStrokeStatus(ids: readonly string[], status: "active" | "deleted", updatedAt: string): void {
    const next = { ...this.strokes };
    for (const id of new Set(ids)) {
      const stroke = next[id];
      if (!stroke) continue;
      next[id] = { ...stroke, status: status === "deleted" ? "deleted" : "committed", updatedAt };
      this.flipMirror(id, status);
    }
    this.strokes = next;
  }

  private flipMirror(id: string, status: "active" | "deleted"): void {
    const current = this.mirrorStatus.get(id);
    if (current === undefined || current === status) return;
    this.mirrorStatus.set(id, status);
    this.bumpMirror(id);
  }

  private bumpMirror(id: string): void {
    const revision = this.mirrorRevisions.get(id);
    if (revision !== undefined) this.mirrorRevisions.set(id, revision + 1);
  }
}

function appendPoint(stroke: LegacyStroke, point: StrokePoint): LegacyStroke {
  // A non-finite timestamp would make toISOString throw and crash the replay.
  const updatedAt = Number.isFinite(point.t) ? new Date(point.t).toISOString() : stroke.updatedAt;
  return { ...stroke, points: [...stroke.points, point], updatedAt };
}

function markElementsStatus(
  elements: Record<string, BoardSceneElement>,
  ids: readonly string[],
  status: BoardSceneElement["status"],
  updatedAt: string,
): Record<string, BoardSceneElement> {
  const targets = new Set(ids);
  let changed = false;
  const next = Object.fromEntries(
    Object.entries(elements).map(([id, element]) => {
      if (!targets.has(id) || element.status === status) return [id, element];
      changed = true;
      return [id, { ...element, status, updatedAt, revision: element.revision + 1 } as BoardSceneElement];
    }),
  );
  return changed ? next : elements;
}
