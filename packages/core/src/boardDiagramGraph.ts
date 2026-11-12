import { DEFAULT_CONNECTOR_ATTACHMENT_TOLERANCE } from "./diagramCommands.ts";
import { isActiveElement, isSceneNodeElement } from "./sceneDiagramCommands.ts";
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
} from "./types.ts";

/**
 * The diagram on a board, as Airo, the evals and the layout scorer read it:
 * nodes, edges and groups made of the board's v2 scene elements.
 *
 * The graph reads only; it never changes the state. (Boards saved in the
 * legacy annotation-stroke model are converted before they are read; see
 * legacyStrokeMigration.ts.)
 */
/**
 * "shape": a box the diagram is made of (it counts for spacing and overlap).
 * "mark": text labels, highlights, pointers, crosses and freehand ink.
 */
export type BoardDiagramNodeRole = "shape" | "mark";

export type BoardDiagramNode = {
  id: string;
  /** The text written on it, or null when it has none. */
  label: string | null;
  /** What a person would call it: its text, or for a blank object its type. */
  name: string;
  /**
   * Diagram type: the node type ("api", "database", "decision", "sticky_note",
   * "rectangle", ...). A v2 shape drawn for a node type keeps that type; any
   * other v2 shape is named by its catalogue shape.
   */
  kind: string;
  /** The scene element kind. */
  objectType: string;
  role: BoardDiagramNodeRole;
  bounds: AnnotationBounds;
  /** Sections that hold this node. */
  groupIds: string[];
};

/** Enough geometry for a consumer to trace the rendered route of an edge. */
export type BoardDiagramEdgeGeometry = {
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
  geometry: BoardDiagramEdgeGeometry;
};

export type BoardDiagramGroup = {
  id: string;
  label: string | null;
  /** Diagram type of the container: "section". */
  kind: string;
  objectType: string;
  bounds: AnnotationBounds;
  memberIds: string[];
};

export type BoardDiagramGraph = {
  /** Nodes in element order. */
  nodes: BoardDiagramNode[];
  /** Edges in element order. */
  edges: BoardDiagramEdge[];
  groups: BoardDiagramGroup[];
};

/** Node types of marks: a shape converted from a legacy pointer or highlight keeps its type. */
const MARK_NODE_TYPES = new Set<string>(["highlight", "pointer", "text_label", "cross_mark", "freehand"]);
const SCENE_MARK_KINDS = new Set<string>(["text"]);
const SCENE_KIND_NAMES: Partial<Record<BoardSceneElement["kind"], string>> = {
  sticky: "Sticky note",
  text: "Text",
  mind_map_node: "Mind map",
};

export function boardDiagramGraph(state: BoardState): BoardDiagramGraph {
  const elements = Object.values(state.elements ?? {}).filter(
    (element) => isActiveElement(state, element.id) && sceneElementOnView(state, element),
  );

  const groups: BoardDiagramGroup[] = elements.flatMap((element) => element.kind === "section" ? [sceneGroup(element)] : []);
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

  const nodes: BoardDiagramNode[] = elements.flatMap((element) =>
    isSceneNodeElement(element) ? [sceneNode(element, groupIdsOf(element.id, element.sectionId))] : []);
  const edges: BoardDiagramEdge[] = elements.flatMap((element) =>
    element.kind === "connector" ? [sceneEdge(state, element)] : []);
  return { nodes, edges, groups };
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
    role: SCENE_MARK_KINDS.has(element.kind) || MARK_NODE_TYPES.has(kind) ? "mark" : "shape",
    bounds: transformBounds(element),
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
    geometry: {
      pathKind: connector.pathKind,
      start: { ...connector.start.point },
      end: { ...connector.end.point },
      controlPoints: connector.controlPoints.map((point) => ({ ...point })),
      labelPosition: connector.labelPosition,
      ...(connector.routeOffset ? { routeOffset: connector.routeOffset } : {}),
    },
  };
}

/** A connector end is attached when it lies on or inside its object's box. */
function sceneEndpointAttached(state: BoardState, id: string, point: AnnotationPoint): boolean {
  const element = state.elements?.[id];
  const bounds = element?.status === "active" ? transformBounds(element) : undefined;
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
