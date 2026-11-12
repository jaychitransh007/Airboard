import { applyBoardEvent, reduceBoardEvents } from "./boardReducer.ts";
import { nodeVisualDefaultSize } from "./nodeVisuals.ts";
import { shapeKindForNodeType } from "./sceneElements.ts";
import {
  connectElements,
  createShapeElement,
  deleteElements,
  duplicateElements,
  groupElements,
  isActiveElement,
  isSceneNodeElement,
  moveElements,
  positionElements,
  renameElement,
  resizeElement,
  restyleConnectorElement,
  restyleElement,
  retypeElement,
  reverseConnector,
  type SceneConnectorStyle,
  type SceneElementEvent,
  type SceneEventSink,
} from "./sceneDiagramCommands.ts";
import type {
  AnnotationBounds,
  AnnotationNodeType,
  AnnotationPoint,
  AnnotationSource,
  BoardEvent,
  BoardJsonValue,
  BoardState,
  ConnectorElement,
  ShapeKind,
  ShapeStyle,
} from "./types.ts";

export type DiagramObjectStyle = {
  strokeColor?: string;
  fillColor?: string;
  opacity?: number;
  thickness?: number;
};

/**
 * The commands below are the diagram verbs Airo's plans and the typed
 * grammar use. They create and edit v2 scene elements: node.create draws a
 * shape, nodes.connect a connector, objects.group a section,
 * objects.duplicate copies. The scene.* twins further down do the same work
 * under the names some callers already use (their arms differ slightly:
 * objects.move takes `to`, objects.duplicate skips connectors,
 * objects.delete may leave connectors behind).
 */
export type CreateNodeCommand = {
  type: "node.create";
  nodeId?: string;
  nodeType: AnnotationNodeType;
  /** Catalogue shape to draw instead of the node type's own, such as a cloud for a CDN. */
  shapeKind?: ShapeKind;
  label?: string;
  center?: AnnotationPoint;
  bounds?: AnnotationBounds;
  source?: AnnotationSource;
  style?: DiagramObjectStyle;
};

export type ConnectNodesCommand = {
  type: "nodes.connect";
  connectorId?: string;
  fromId: string;
  toId: string;
  label?: string;
  source?: AnnotationSource;
  style?: Pick<DiagramObjectStyle, "strokeColor" | "opacity" | "thickness">;
};

export const DEFAULT_CONNECTOR_ATTACHMENT_TOLERANCE = 6;

export type ReverseConnectionCommand = {
  type: "connection.reverse";
  connectorId: string;
  /** Omit to preserve the connector's existing label. */
  label?: string;
};

export type MoveObjectsCommand = {
  type: "objects.move";
  objectIds: string[];
  /** Translate the selection by this amount. */
  delta?: AnnotationPoint;
  /** Move the top-left corner of the selection to this board position. */
  to?: AnnotationPoint;
};

export type ResizeObjectCommand = {
  type: "object.resize";
  objectId: string;
  bounds: AnnotationBounds;
};

/** Gives a shape another node type or catalogue shape, keeping its box, label and arrows. */
export type RetypeObjectCommand = {
  type: "object.retype";
  objectId: string;
  nodeType: AnnotationNodeType;
  /** Null or absent draws the node type's own shape. */
  shapeKind?: ShapeKind | null;
};

/** Draws a connector solid, dashed or dotted. */
export type RestyleConnectorCommand = {
  type: "connector.restyle";
  connectorId: string;
  lineStyle: "solid" | "dashed" | "dotted";
};

export type RenameObjectCommand = {
  type: "object.rename";
  objectId: string;
  label: string;
};

export type GroupObjectsCommand = {
  type: "objects.group";
  groupId?: string;
  objectIds: string[];
  label?: string;
};

export type RestyleObjectCommand = {
  type: "object.restyle";
  objectId: string;
  fillColor?: string;
  strokeColor?: string;
};

export type DeleteObjectsCommand = {
  type: "objects.delete";
  objectIds: string[];
  /** Defaults to true for semantic nodes. */
  cascadeConnectors?: boolean;
};

export type DuplicateObjectsCommand = {
  type: "objects.duplicate";
  objectIds: string[];
  offset?: AnnotationPoint;
  /** Optional stable IDs for persistence, replay, and tests. */
  idMap?: Record<string, string>;
};

export type AlignObjectsCommand = {
  type: "objects.align";
  objectIds: string[];
  alignment:
    | "left"
    | "center-x"
    | "right"
    | "top"
    | "center-y"
    | "bottom"
    | "distribute-x"
    | "distribute-y";
};

export type LayoutObjectsCommand = {
  type: "objects.layout";
  objectIds: string[];
  direction: "horizontal" | "vertical";
  gap?: number;
  origin?: AnnotationPoint;
};

/** The scene.* twins of the verbs above, named by the element they act on. */
export type SceneConnectCommand = {
  type: "scene.connect";
  connectorId?: string;
  fromId: string;
  toId: string;
  label?: string;
};
export type SceneRenameCommand = { type: "scene.rename"; elementId: string; label: string };
export type SceneMoveCommand = { type: "scene.move"; elementIds: string[]; delta: AnnotationPoint };
/** Deletes v2 elements and any v2 connector attached to them. */
export type SceneDeleteCommand = { type: "scene.delete"; elementIds: string[] };
export type SceneReverseConnectorCommand = {
  type: "scene.connector.reverse";
  connectorId: string;
  label?: string;
};
/** Copies v2 elements, shifted by `offset`; `idMap` names the copies. */
export type SceneDuplicateCommand = {
  type: "scene.duplicate";
  elementIds: string[];
  idMap?: Record<string, string>;
  offset?: AnnotationPoint;
};
/** Draws a section around v2 elements, as the toolbar's group does. */
export type SceneGroupCommand = {
  type: "scene.group";
  sectionId?: string;
  memberIds: string[];
  label?: string;
};

export type SceneResizeCommand = { type: "scene.resize"; elementId: string; bounds: AnnotationBounds };
/** Gives a v2 shape another catalogue shape; with a node type, it is named by that type. */
export type SceneRetypeCommand = {
  type: "scene.retype";
  elementId: string;
  shapeKind: ShapeKind;
  nodeType?: AnnotationNodeType;
};
export type SceneRestyleConnectorCommand = {
  type: "scene.connector.restyle";
  connectorId: string;
  lineStyle: "solid" | "dashed" | "dotted";
};

export type DiagramCommand =
  | SceneResizeCommand
  | SceneRetypeCommand
  | SceneRestyleConnectorCommand
  | RetypeObjectCommand
  | RestyleConnectorCommand
  | SceneConnectCommand
  | SceneRenameCommand
  | SceneMoveCommand
  | SceneDeleteCommand
  | SceneReverseConnectorCommand
  | SceneDuplicateCommand
  | SceneGroupCommand
  | CreateNodeCommand
  | ConnectNodesCommand
  | ReverseConnectionCommand
  | MoveObjectsCommand
  | ResizeObjectCommand
  | RenameObjectCommand
  | GroupObjectsCommand
  | RestyleObjectCommand
  | DeleteObjectsCommand
  | DuplicateObjectsCommand
  | AlignObjectsCommand
  | LayoutObjectsCommand;

export type DiagramCommandContext = {
  boardSessionId: string;
  actorParticipantId: string;
  userId: string;
  createdAt?: string;
  sequence?: number;
  eventIdFactory?: () => string;
  objectIdFactory?: () => string;
};

export type DiagramCommandPlan = {
  events: BoardEvent[];
  /** Compensating events in application order. Re-envelope before remote use. */
  undoEvents: BoardEvent[];
  affectedStrokeIds: string[];
};

export type DiagramCommandResult = DiagramCommandPlan & {
  state: BoardState;
};

export type DiagramUndoResult = {
  state: BoardState;
  events: BoardEvent[];
};

type EventPayload = SceneElementEvent;

const DEFAULT_LAYOUT_GAP = 48;

/**
 * Translate a semantic diagram command into the existing event contract.
 * Planning is pure with respect to the supplied BoardState.
 */
export function planDiagramCommand(
  state: BoardState,
  command: DiagramCommand,
  context: DiagramCommandContext,
): DiagramCommandPlan {
  const planner = new CommandPlanner(state, context);

  switch (command.type) {
    case "node.create":
      planCreateNode(planner, command);
      break;
    case "nodes.connect":
      planConnectNodes(planner, command);
      break;
    case "connection.reverse":
      reverseConnector(planner.sceneSink(), command.connectorId, command.label);
      break;
    case "objects.move":
      planMoveObjects(planner, command);
      break;
    case "object.resize":
      resizeElement(planner.sceneSink(), command.objectId, normalizeBounds(command.bounds));
      break;
    case "object.rename":
      renameElement(planner.sceneSink(), command.objectId, command.label);
      break;
    case "object.restyle":
      restyleElement(planner.sceneSink(), command.objectId, {
        ...(command.fillColor !== undefined ? { fillColor: command.fillColor } : {}),
        ...(command.strokeColor !== undefined ? { strokeColor: command.strokeColor } : {}),
      });
      break;
    case "objects.group":
      planGroupObjects(planner, command);
      break;
    case "objects.delete":
      planDeleteObjects(planner, command);
      break;
    case "objects.duplicate":
      planDuplicateObjects(planner, command);
      break;
    case "objects.align":
      planAlignObjects(planner, command);
      break;
    case "objects.layout":
      planLayoutObjects(planner, command);
      break;
    case "scene.connect":
      connectElements(planner.sceneSink(), command);
      break;
    case "scene.rename":
      renameElement(planner.sceneSink(), command.elementId, command.label);
      break;
    case "scene.move":
      moveElements(planner.sceneSink(), command.elementIds, command.delta);
      break;
    case "scene.delete":
      deleteElements(planner.sceneSink(), command.elementIds);
      break;
    case "scene.connector.reverse":
      reverseConnector(planner.sceneSink(), command.connectorId, command.label);
      break;
    case "scene.duplicate":
      duplicateElements(planner.sceneSink(), command);
      break;
    case "scene.group":
      groupElements(planner.sceneSink(), command);
      break;
    case "scene.resize":
      resizeElement(planner.sceneSink(), command.elementId, command.bounds);
      break;
    case "scene.retype":
      retypeElement(planner.sceneSink(), command.elementId, command.shapeKind, command.nodeType);
      break;
    case "scene.connector.restyle":
      restyleConnectorElement(planner.sceneSink(), command.connectorId, command.lineStyle);
      break;
    case "object.retype":
      retypeElement(
        planner.sceneSink(),
        command.objectId,
        command.shapeKind ?? shapeKindForNodeType(command.nodeType),
        command.nodeType,
      );
      break;
    case "connector.restyle":
      restyleConnectorElement(planner.sceneSink(), command.connectorId, command.lineStyle);
      break;
  }

  return planner.plan();
}

/** Plan and immediately reduce a command into a new BoardState. */
export function applyDiagramCommand(
  state: BoardState,
  command: DiagramCommand,
  context: DiagramCommandContext,
): DiagramCommandResult {
  const plan = planDiagramCommand(state, command, context);
  return {
    ...plan,
    state: reduceBoardEvents(state, plan.events),
  };
}

/**
 * Apply compensating events returned by a command. Supplying a context gives
 * the events fresh IDs/timestamps/sequences, which is appropriate for sending
 * the undo through the normal realtime event path.
 */
export function applyDiagramUndo(
  state: BoardState,
  plan: Pick<DiagramCommandPlan, "undoEvents">,
  context?: DiagramCommandContext,
): DiagramUndoResult {
  const events = context
    ? reEnvelopeDiagramEvents(plan.undoEvents, context)
    : plan.undoEvents;
  return {
    state: reduceBoardEvents(state, events),
    events,
  };
}

/** Replace only event-envelope data while retaining semantic event payloads. */
export function reEnvelopeDiagramEvents(
  events: readonly BoardEvent[],
  context: DiagramCommandContext,
): BoardEvent[] {
  const createdAt = context.createdAt ?? new Date().toISOString();
  const idFactory = context.eventIdFactory ?? randomId;
  return events.map((event, index) => {
    const sequence =
      context.sequence === undefined ? undefined : context.sequence + index;
    const envelope = {
      id: idFactory(),
      boardSessionId: context.boardSessionId,
      actorParticipantId: context.actorParticipantId,
      createdAt,
    };
    const withoutEnvelope = stripEnvelope(event);
    return sequence === undefined
      ? ({ ...withoutEnvelope, ...envelope } as BoardEvent)
      : ({ ...withoutEnvelope, ...envelope, sequence } as BoardEvent);
  });
}

export class DiagramCommandError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DiagramCommandError";
  }
}

class CommandPlanner {
  state: BoardState;
  readonly context: DiagramCommandContext;
  readonly createdAt: string;
  private readonly events: BoardEvent[] = [];
  private readonly undoEvents: BoardEvent[] = [];
  private readonly affectedStrokeIds = new Set<string>();
  private readonly eventIdFactory: () => string;
  private readonly objectIdFactory: () => string;

  constructor(state: BoardState, context: DiagramCommandContext) {
    this.state = state;
    this.context = context;
    this.createdAt = context.createdAt ?? new Date().toISOString();
    this.eventIdFactory = context.eventIdFactory ?? randomId;
    this.objectIdFactory = context.objectIdFactory ?? randomId;
  }

  objectId(explicitId?: string): string {
    return explicitId ?? this.objectIdFactory();
  }

  add(payload: EventPayload, inverse?: EventPayload): void {
    const event = this.event(payload, false, this.events.length);
    this.events.push(event);
    this.state = applyBoardEvent(this.state, event);
    for (const id of eventStrokeIds(event)) {
      this.affectedStrokeIds.add(id);
    }
    if (inverse) {
      this.undoEvents.unshift(this.event(inverse, true, this.undoEvents.length));
    }
  }

  /** The planner as a sink for scene element events. */
  sceneSink(): SceneEventSink {
    return new PlannerSceneSink(this);
  }

  plan(): DiagramCommandPlan {
    return {
      events: this.events,
      undoEvents: this.undoEvents,
      affectedStrokeIds: [...this.affectedStrokeIds],
    };
  }

  private event(payload: EventPayload, undo: boolean, index: number): BoardEvent {
    const sequence =
      undo || this.context.sequence === undefined
        ? undefined
        : this.context.sequence + index;
    const envelope = {
      id: this.eventIdFactory(),
      boardSessionId: this.context.boardSessionId,
      actorParticipantId: this.context.actorParticipantId,
      createdAt: this.createdAt,
    };
    return sequence === undefined
      ? ({ ...envelope, ...payload } as BoardEvent)
      : ({ ...envelope, ...payload, sequence } as BoardEvent);
  }
}

class PlannerSceneSink implements SceneEventSink {
  private readonly planner: CommandPlanner;

  constructor(planner: CommandPlanner) {
    this.planner = planner;
  }

  get state(): BoardState {
    return this.planner.state;
  }

  get boardSessionId(): string {
    return this.planner.context.boardSessionId;
  }

  get userId(): string {
    return this.planner.context.userId;
  }

  get createdAt(): string {
    return this.planner.createdAt;
  }

  objectId(explicitId?: string): string {
    return this.planner.objectId(explicitId);
  }

  add(payload: SceneElementEvent, inverse: SceneElementEvent): void {
    this.planner.add(payload, inverse);
  }
}

/**
 * A diagram node's colours when the command names none (the colours Airo's
 * nodes have always had). A note keeps its yellow paper.
 */
const NODE_STROKE = "#2563eb";
const NODE_FILL = "#f8fafc";
const NOTE_NODE_FILL = "#fef9c3";
const NODE_STROKE_WIDTH = 3;

/** Draws a diagram node as a v2 shape. */
function planCreateNode(planner: CommandPlanner, command: CreateNodeCommand): void {
  if (!command.bounds && !command.center) {
    throw new DiagramCommandError("node.create requires bounds or center");
  }
  const bounds = command.bounds
    ? normalizeBounds(command.bounds)
    : boundsAroundCenter(command.center as AnnotationPoint, defaultNodeSize(command.nodeType));
  const shapeKind = command.shapeKind ?? shapeKindForNodeType(command.nodeType);
  const style: Partial<ShapeStyle> = {
    stroke: command.style?.strokeColor ?? NODE_STROKE,
    fill: command.style?.fillColor ?? (command.nodeType === "note" ? NOTE_NODE_FILL : NODE_FILL),
    strokeWidth: command.style?.thickness ?? NODE_STROKE_WIDTH,
  };
  if (command.style?.opacity !== undefined) style.fillOpacity = command.style.opacity;
  const metadata: Record<string, BoardJsonValue> = {
    source: command.source ?? "ai",
    nodeType: command.nodeType,
    nodeShape: shapeKind,
  };
  createShapeElement(planner.sceneSink(), {
    ...(command.nodeId !== undefined ? { shapeId: command.nodeId } : {}),
    shapeKind,
    bounds,
    ...(command.label !== undefined ? { label: command.label } : {}),
    style,
    metadata,
  });
}

/** The weight of the arrows Airo and typed commands draw. */
export const AIRO_CONNECTOR_THICKNESS: ConnectorElement["style"]["thickness"] = "thick";

/** Draws a v2 connector between two objects. */
function planConnectNodes(planner: CommandPlanner, command: ConnectNodesCommand): void {
  if (command.fromId === command.toId) {
    throw new DiagramCommandError("nodes.connect requires two different objects");
  }
  for (const id of [command.fromId, command.toId]) {
    if (!isSceneNodeElement(planner.state.elements[id])) {
      throw new DiagramCommandError(`Diagram object not found: ${id}`);
    }
  }
  // Airo's and typed arrows are drawn heavy (as Airo always drew them), so a
  // diagram's arrows read at a glance; the toolbar's own connectors keep its
  // thin default. A stated weight under 3px draws thin.
  const style: SceneConnectorStyle = { thickness: AIRO_CONNECTOR_THICKNESS };
  if (command.style?.strokeColor !== undefined) style.color = command.style.strokeColor;
  if (command.style?.opacity !== undefined) style.opacity = command.style.opacity;
  if (command.style?.thickness !== undefined) style.thickness = command.style.thickness >= 3 ? "thick" : "thin";
  connectElements(planner.sceneSink(), {
    ...(command.connectorId !== undefined ? { connectorId: command.connectorId } : {}),
    fromId: command.fromId,
    toId: command.toId,
    ...(command.label !== undefined ? { label: command.label } : {}),
    style,
    metadata: { source: command.source ?? "ai" },
  });
}

function planMoveObjects(planner: CommandPlanner, command: MoveObjectsCommand): void {
  if ((command.delta === undefined) === (command.to === undefined)) {
    throw new DiagramCommandError("objects.move requires exactly one of delta or to");
  }
  // Ids that name nothing any more (a shape deleted meanwhile) are skipped;
  // connectors are not moved on their own (they follow their objects).
  const ids = unique(command.objectIds).filter((id) => isSceneNodeElement(planner.state.elements[id]));
  if (ids.length === 0) {
    throw new DiagramCommandError("objects.move has no movable objects in the selection");
  }
  const selection = unionBounds(ids.map((id) => sceneNodeBounds(planner, id)));
  const delta = command.delta ?? {
    x: (command.to as AnnotationPoint).x - selection.x,
    y: (command.to as AnnotationPoint).y - selection.y,
  };
  moveElements(planner.sceneSink(), ids, delta);
}

function planGroupObjects(planner: CommandPlanner, command: GroupObjectsCommand): void {
  const memberIds = unique(command.objectIds);
  if (memberIds.length === 0) {
    throw new DiagramCommandError("objects.group requires at least one object");
  }
  // Grouped as the toolbar groups them: in a section.
  groupElements(planner.sceneSink(), {
    ...(command.groupId !== undefined ? { sectionId: command.groupId } : {}),
    memberIds,
    ...(command.label !== undefined ? { label: command.label } : {}),
  });
}

function planDeleteObjects(planner: CommandPlanner, command: DeleteObjectsCommand): void {
  const requested = unique(command.objectIds);
  if (requested.length === 0) {
    throw new DiagramCommandError("objects.delete requires at least one object");
  }
  const remaining = requested.filter((id) => isActiveElement(planner.state, id));
  if (remaining.length === 0) return;
  if (command.cascadeConnectors === false) {
    for (const id of remaining) {
      planner.add({ type: "element.deleted", elementId: id }, { type: "element.restored", elementId: id });
    }
  } else {
    deleteElements(planner.sceneSink(), remaining);
  }
}

function planDuplicateObjects(planner: CommandPlanner, command: DuplicateObjectsCommand): void {
  const ids = unique(command.objectIds);
  if (ids.length === 0) {
    throw new DiagramCommandError("objects.duplicate requires at least one object");
  }
  // A connector is not copied on its own: the shapes are.
  const nodeIds = ids.filter((id) => isSceneNodeElement(planner.state.elements[id]));
  if (nodeIds.length === 0) {
    throw new DiagramCommandError("objects.duplicate requires at least one shape");
  }
  duplicateElements(planner.sceneSink(), {
    elementIds: nodeIds,
    ...(command.idMap ? { idMap: command.idMap } : {}),
    offset: command.offset ?? { x: 24, y: 24 },
  });
}

function planAlignObjects(planner: CommandPlanner, command: AlignObjectsCommand): void {
  const entries = arrangeEntries(planner, unique(command.objectIds));
  if (entries.length < 2) {
    throw new DiagramCommandError("objects.align requires at least two objects");
  }
  const updated = new Map<string, AnnotationBounds>();

  if (command.alignment === "distribute-x" || command.alignment === "distribute-y") {
    if (entries.length < 3) {
      throw new DiagramCommandError("Distribution requires at least three objects");
    }
    distributeBounds(entries, command.alignment, updated);
  } else {
    const anchor = entries[0]?.bounds;
    if (!anchor) return;
    for (const entry of entries.slice(1)) {
      updated.set(entry.id, alignedBounds(entry.bounds, anchor, command.alignment));
    }
  }
  applyArrangedBounds(planner, updated);
}

function planLayoutObjects(planner: CommandPlanner, command: LayoutObjectsCommand): void {
  const entries = arrangeEntries(planner, unique(command.objectIds));
  if (entries.length === 0) {
    throw new DiagramCommandError("objects.layout requires at least one object");
  }
  entries.sort((a, b) =>
    command.direction === "horizontal"
      ? a.bounds.x - b.bounds.x || a.bounds.y - b.bounds.y
      : a.bounds.y - b.bounds.y || a.bounds.x - b.bounds.x,
  );
  const allBounds = unionBounds(entries.map((entry) => entry.bounds));
  const origin = command.origin ?? { x: allBounds.x, y: allBounds.y };
  const gap = Math.max(0, command.gap ?? DEFAULT_LAYOUT_GAP);
  let cursor = command.direction === "horizontal" ? origin.x : origin.y;
  const updated = new Map<string, AnnotationBounds>();

  for (const entry of entries) {
    const bounds = { ...entry.bounds };
    if (command.direction === "horizontal") {
      bounds.x = cursor;
      bounds.y = origin.y;
      cursor += bounds.width + gap;
    } else {
      bounds.x = origin.x;
      bounds.y = cursor;
      cursor += bounds.height + gap;
    }
    updated.set(entry.id, bounds);
  }
  applyArrangedBounds(planner, updated);
}

type ArrangeEntry = { id: string; bounds: AnnotationBounds };

function sceneNodeBounds(planner: CommandPlanner, id: string): AnnotationBounds {
  const element = planner.state.elements[id];
  if (!isSceneNodeElement(element)) {
    throw new DiagramCommandError(`Diagram object not found: ${id}`);
  }
  const { x, y, width, height } = element.transform;
  return { x, y, width, height };
}

/** The objects align and layout arrange, with their boxes. */
function arrangeEntries(planner: CommandPlanner, ids: readonly string[]): ArrangeEntry[] {
  return ids.map((id) => {
    if (!isActiveElement(planner.state, id)) {
      throw new DiagramCommandError(`Diagram object not found: ${id}`);
    }
    return { id, bounds: sceneNodeBounds(planner, id) };
  });
}

/**
 * Moves each arranged object's top-left corner. (Attached connectors keep
 * their stored end points, as they did before phase 3.)
 */
function applyArrangedBounds(
  planner: CommandPlanner,
  updates: ReadonlyMap<string, AnnotationBounds>,
): void {
  positionElements(
    planner.sceneSink(),
    new Map([...updates].map(([id, { x, y }]) => [id, { x, y }])),
  );
}

function alignedBounds(
  bounds: AnnotationBounds,
  anchor: AnnotationBounds,
  alignment: Exclude<AlignObjectsCommand["alignment"], "distribute-x" | "distribute-y">,
): AnnotationBounds {
  const result = { ...bounds };
  switch (alignment) {
    case "left":
      result.x = anchor.x;
      break;
    case "center-x":
      result.x = anchor.x + anchor.width / 2 - bounds.width / 2;
      break;
    case "right":
      result.x = anchor.x + anchor.width - bounds.width;
      break;
    case "top":
      result.y = anchor.y;
      break;
    case "center-y":
      result.y = anchor.y + anchor.height / 2 - bounds.height / 2;
      break;
    case "bottom":
      result.y = anchor.y + anchor.height - bounds.height;
      break;
  }
  return result;
}

function distributeBounds(
  entries: Array<{ id: string; bounds: AnnotationBounds }>,
  alignment: "distribute-x" | "distribute-y",
  output: Map<string, AnnotationBounds>,
): void {
  const horizontal = alignment === "distribute-x";
  entries.sort((a, b) =>
    horizontal ? a.bounds.x - b.bounds.x : a.bounds.y - b.bounds.y,
  );
  const first = entries[0];
  const last = entries[entries.length - 1];
  if (!first || !last) return;
  const start = horizontal ? first.bounds.x : first.bounds.y;
  const end = horizontal
    ? last.bounds.x + last.bounds.width
    : last.bounds.y + last.bounds.height;
  const totalSize = entries.reduce(
    (sum, entry) => sum + (horizontal ? entry.bounds.width : entry.bounds.height),
    0,
  );
  const gap = (end - start - totalSize) / (entries.length - 1);
  let cursor = start;
  for (const entry of entries) {
    const bounds = { ...entry.bounds };
    if (horizontal) {
      bounds.x = cursor;
      cursor += bounds.width + gap;
    } else {
      bounds.y = cursor;
      cursor += bounds.height + gap;
    }
    output.set(entry.id, bounds);
  }
}

function unionBounds(boundsList: readonly AnnotationBounds[]): AnnotationBounds {
  if (boundsList.length === 0) {
    throw new DiagramCommandError("Cannot calculate bounds for an empty selection");
  }
  const minX = Math.min(...boundsList.map((bounds) => bounds.x));
  const minY = Math.min(...boundsList.map((bounds) => bounds.y));
  const maxX = Math.max(...boundsList.map((bounds) => bounds.x + bounds.width));
  const maxY = Math.max(...boundsList.map((bounds) => bounds.y + bounds.height));
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

function normalizeBounds(bounds: AnnotationBounds): AnnotationBounds {
  const width = Math.max(Math.abs(bounds.width), 1);
  const height = Math.max(Math.abs(bounds.height), 1);
  return {
    x: bounds.width < 0 ? bounds.x + bounds.width : bounds.x,
    y: bounds.height < 0 ? bounds.y + bounds.height : bounds.y,
    width,
    height,
  };
}

function boundsAroundCenter(
  center: AnnotationPoint,
  size: { width: number; height: number },
): AnnotationBounds {
  return {
    x: center.x - size.width / 2,
    y: center.y - size.height / 2,
    width: size.width,
    height: size.height,
  };
}

function defaultNodeSize(nodeType: AnnotationNodeType): { width: number; height: number } {
  return nodeVisualDefaultSize(nodeType);
}

function stripEnvelope(event: BoardEvent): EventPayload {
  const {
    id: _id,
    boardSessionId: _boardSessionId,
    actorParticipantId: _actorParticipantId,
    createdAt: _createdAt,
    sequence: _sequence,
    ...payload
  } = event;
  return payload as EventPayload;
}

/** The elements an event touches (reported as `affectedStrokeIds`). */
function eventStrokeIds(event: BoardEvent): string[] {
  switch (event.type) {
    case "element.created":
      return [event.element.id];
    case "element.patched":
    case "element.deleted":
    case "element.restored":
      return [event.elementId];
    default:
      return [];
  }
}

function unique(ids: readonly string[]): string[] {
  return [...new Set(ids)];
}

function randomId(): string {
  return crypto.randomUUID();
}
