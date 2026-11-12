import { connectorGeometryMatchesBindings, DEFAULT_CONNECTOR_ATTACHMENT_TOLERANCE } from "./diagramCommands.ts";
import { isSceneNodeElement, isSceneOnlyElement } from "./sceneDiagramCommands.ts";
import { richTextToPlainText, sceneElementNodeType } from "./sceneElements.ts";
import { shapeCatalogEntry } from "./shapeCatalog.ts";
import type {
  AnnotationBounds,
  AnnotationPoint,
  BoardSceneElement,
  BoardState,
  ConnectorElement,
  ConnectorPathKind,
  SectionElement,
  Stroke,
} from "./types.ts";

/**
 * A model-independent view of the diagram on a board.
 *
 * A board holds objects in two models: legacy annotation strokes that Airo
 * drew before November 2026 (mirrored into scene elements under the same id)
 * and v2 scene elements, which everything (Airo included) makes now. Evals and the layout scorer
 * read this graph instead of either model, so they keep giving the same
 * answers when an object moves from one model to the other.
 *
 * The graph reads only; it never changes the state. Scene copies of legacy
 * strokes (elements with legacyStrokeId, or sharing a stroke's id) are left
 * out, so every object appears once.
 */
export type BoardDiagramModel = "stroke" | "scene";

/**
 * "shape": a box the diagram is made of (it counts for spacing and overlap).
 * "mark": text labels, highlights, pointers, crosses and freehand ink.
 */
export type BoardDiagramNodeRole = "shape" | "mark";

export type BoardDiagramNode = {
  id: string;
  /** The text written on it, or null when it has none. Legacy labels are passed through unchanged. */
  label: string | null;
  /** What a person would call it: its text, or for a blank object its type. */
  name: string;
  /**
   * Diagram type: the node type ("api", "database", "decision", "sticky_note",
   * "rectangle", ...). A v2 shape drawn for a node type keeps that type; any
   * other v2 shape is named by its catalogue shape.
   */
  kind: string;
  /** The object's own type in its model: an annotation type or a scene element kind. */
  objectType: string;
  role: BoardDiagramNodeRole;
  bounds: AnnotationBounds;
  model: BoardDiagramModel;
  /** Groups (legacy group containers or scene sections) that hold this node. */
  groupIds: string[];
};

/** Enough geometry for a consumer to trace the rendered route of an edge. */
export type BoardDiagramEdgeGeometry =
  | {
    model: "stroke";
    type: "connector" | "arrow";
    start?: AnnotationPoint;
    end?: AnnotationPoint;
    routeOffset?: number;
  }
  | {
    model: "scene";
    pathKind: ConnectorPathKind;
    start: AnnotationPoint;
    end: AnnotationPoint;
    controlPoints: AnnotationPoint[];
    labelPosition: number;
    routeOffset?: number;
  };

export type BoardDiagramEdge = {
  id: string;
  /** The object the edge starts at, or null when that end is loose. */
  from: string | null;
  /** The object the edge ends at, or null when that end is loose. */
  to: string | null;
  label: string | null;
  /** True when the edge shows a direction (an arrowhead at its end). */
  directed: boolean;
  lineStyle: "solid" | "dashed" | "dotted";
  /** True only when both ends are bound and drawn where their objects are. */
  attached: boolean;
  model: BoardDiagramModel;
  geometry: BoardDiagramEdgeGeometry;
};

export type BoardDiagramGroup = {
  id: string;
  label: string | null;
  /** Diagram type of the container ("rectangle" for a legacy group, "section" for a v2 one). */
  kind: string;
  objectType: string;
  bounds: AnnotationBounds;
  memberIds: string[];
  model: BoardDiagramModel;
};

export type BoardDiagramGraph = {
  /** Legacy nodes in stroke order, then v2 nodes in element order. */
  nodes: BoardDiagramNode[];
  /** Legacy edges in stroke order, then v2 edges in element order. */
  edges: BoardDiagramEdge[];
  groups: BoardDiagramGroup[];
};

const LEGACY_MARK_TYPES = new Set<string>(["highlight", "pointer", "text_label", "cross_mark", "freehand"]);
const SCENE_MARK_KINDS = new Set<string>(["text"]);
const SCENE_KIND_NAMES: Partial<Record<BoardSceneElement["kind"], string>> = {
  sticky: "Sticky note",
  text: "Text",
  mind_map_node: "Mind map",
};

export function boardDiagramGraph(state: BoardState): BoardDiagramGraph {
  const strokes = Object.values(state.strokes).filter(
    (stroke) => stroke.status === "committed" && stroke.annotation,
  );
  const elements = Object.values(state.elements ?? {}).filter(
    (element) => isSceneOnlyElement(state, element.id) && sceneElementOnView(state, element),
  );

  const groups: BoardDiagramGroup[] = [
    ...strokes.flatMap(legacyGroup),
    ...elements.flatMap((element) => element.kind === "section" ? [sceneGroup(element)] : []),
  ];
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

  const nodes: BoardDiagramNode[] = [
    ...strokes.flatMap((stroke) => legacyNode(stroke, groupIdsOf(stroke.id))),
    ...elements.flatMap((element) =>
      isSceneNodeElement(element) ? [sceneNode(element, groupIdsOf(element.id, element.sectionId))] : []),
  ];
  const edges: BoardDiagramEdge[] = [
    ...strokes.flatMap((stroke) => legacyEdge(state, stroke)),
    ...elements.flatMap((element) => element.kind === "connector" ? [sceneEdge(state, element)] : []),
  ];
  return { nodes, edges, groups };
}

function isLegacyEdgeType(type: string | undefined): type is "connector" | "arrow" {
  return type === "connector" || type === "arrow";
}

function isLegacyGroup(stroke: Stroke): boolean {
  return (stroke.annotation?.groupMemberStrokeIds?.length ?? 0) > 0;
}

function legacyNode(stroke: Stroke, groupIds: string[]): BoardDiagramNode[] {
  const annotation = stroke.annotation;
  if (!annotation?.bounds || isLegacyEdgeType(annotation.type) || isLegacyGroup(stroke)) return [];
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

function legacyGroup(stroke: Stroke): BoardDiagramGroup[] {
  const annotation = stroke.annotation;
  if (!annotation?.bounds || isLegacyEdgeType(annotation.type) || !isLegacyGroup(stroke)) return [];
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

function legacyEdge(state: BoardState, stroke: Stroke): BoardDiagramEdge[] {
  const annotation = stroke.annotation;
  if (!annotation || !isLegacyEdgeType(annotation.type)) return [];
  return [{
    id: stroke.id,
    from: annotation.snappedStartStrokeId ?? null,
    to: annotation.snappedEndStrokeId ?? null,
    label: annotation.label ?? null,
    directed: true,
    lineStyle: annotation.lineStyle ?? "solid",
    attached: connectorGeometryMatchesBindings(state, annotation),
    model: "stroke",
    geometry: {
      model: "stroke",
      type: annotation.type,
      ...(annotation.start ? { start: { ...annotation.start } } : {}),
      ...(annotation.end ? { end: { ...annotation.end } } : {}),
      ...(annotation.routeOffset !== undefined ? { routeOffset: annotation.routeOffset } : {}),
    },
  }];
}

function plainLabel(text: string): string | null {
  const label = text.trim().replace(/\s+/g, " ");
  return label || null;
}

function sceneNode(element: BoardSceneElement, groupIds: string[]): BoardDiagramNode {
  const label = "content" in element ? plainLabel(richTextToPlainText(element.content)) : null;
  const kind = sceneElementNodeType(element);
  const name = label
    ?? (element.kind === "shape" ? shapeCatalogEntry(element.shapeKind).name : SCENE_KIND_NAMES[element.kind] ?? element.kind);
  return {
    id: element.id,
    label,
    name,
    kind,
    objectType: element.kind,
    // A pointer or highlight converted from a legacy stroke is a shape named
    // by its legacy type; it stays a mark, as it was.
    role: SCENE_MARK_KINDS.has(element.kind) || LEGACY_MARK_TYPES.has(kind) ? "mark" : "shape",
    bounds: transformBounds(element),
    model: "scene",
    groupIds,
  };
}

function sceneGroup(section: SectionElement): BoardDiagramGroup {
  return {
    id: section.id,
    label: plainLabel(richTextToPlainText(section.title)),
    kind: "section",
    objectType: "section",
    bounds: transformBounds(section),
    memberIds: [...section.memberIds],
    model: "scene",
  };
}

function sceneEdge(state: BoardState, connector: ConnectorElement): BoardDiagramEdge {
  const from = connector.start.binding?.elementId ?? null;
  const to = connector.end.binding?.elementId ?? null;
  return {
    id: connector.id,
    from,
    to,
    label: plainLabel(richTextToPlainText(connector.label)),
    directed: connector.end.decoration !== "none",
    lineStyle: connector.style.strokeStyle,
    attached: Boolean(
      from && to &&
      sceneEndpointAttached(state, from, connector.start.point) &&
      sceneEndpointAttached(state, to, connector.end.point),
    ),
    model: "scene",
    geometry: {
      model: "scene",
      pathKind: connector.pathKind,
      start: { ...connector.start.point },
      end: { ...connector.end.point },
      controlPoints: connector.controlPoints.map((point) => ({ ...point })),
      labelPosition: connector.labelPosition,
      ...(connector.routeOffset ? { routeOffset: connector.routeOffset } : {}),
    },
  };
}

/** A scene end is attached when it lies on or inside its object's box (legacy or v2). */
function sceneEndpointAttached(state: BoardState, id: string, point: AnnotationPoint): boolean {
  const stroke = state.strokes[id];
  const element = state.elements?.[id];
  const bounds = stroke
    ? stroke.status === "committed" ? stroke.annotation?.bounds : undefined
    : element?.status === "active" ? transformBounds(element) : undefined;
  if (!bounds) return false;
  const tolerance = DEFAULT_CONNECTOR_ATTACHMENT_TOLERANCE;
  return point.x >= bounds.x - tolerance && point.x <= bounds.x + bounds.width + tolerance &&
    point.y >= bounds.y - tolerance && point.y <= bounds.y + bounds.height + tolerance;
}

function transformBounds(element: BoardSceneElement): AnnotationBounds {
  const { x, y, width, height } = element.transform;
  return { x, y, width, height };
}

/** Hidden elements, and those inside a hidden or collapsed section, aren't on view. */
function sceneElementOnView(state: BoardState, element: BoardSceneElement): boolean {
  if (element.status !== "active" || !element.visible) return false;
  const section = element.sectionId ? state.elements[element.sectionId] : undefined;
  return !(section?.kind === "section" && section.status === "active" && (!section.visible || section.collapsed));
}
