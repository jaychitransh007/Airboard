import { applyBoardEvent, reduceBoardEvents } from "./boardReducer.ts";
import { nodeVisualDefaultSize, pointOnNodeBoundary } from "./nodeVisuals.ts";
import type {
  AnnotationBounds,
  AnnotationNodeType,
  AnnotationPoint,
  AnnotationSource,
  BoardEvent,
  BoardState,
  Stroke,
  StrokeAnnotation,
  StrokePoint,
} from "./types.ts";

export type DiagramObjectStyle = {
  strokeColor?: string;
  fillColor?: string;
  opacity?: number;
  thickness?: number;
};

export type CreateNodeCommand = {
  type: "node.create";
  nodeId?: string;
  nodeType: AnnotationNodeType;
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
  padding?: number;
  source?: AnnotationSource;
  style?: DiagramObjectStyle;
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

export type DiagramCommand =
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

type EventPayload =
  | { type: "stroke.started"; stroke: Stroke }
  | { type: "stroke.committed"; strokeId: string }
  | {
      type: "stroke.annotation_updated";
      strokeId: string;
      annotation: StrokeAnnotation;
      points: StrokePoint[];
    }
  | { type: "stroke.label_updated"; strokeId: string; label: string }
  | { type: "stroke.deleted"; strokeIds: string[] }
  | { type: "stroke.restored"; strokeIds: string[] };

const DEFAULT_GROUP_PADDING = 28;
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
      planReverseConnection(planner, command);
      break;
    case "objects.move":
      planMoveObjects(planner, command);
      break;
    case "object.resize":
      planResizeObject(planner, command);
      break;
    case "object.rename":
      planRenameObject(planner, command);
      break;
    case "object.restyle":
      planRestyleObject(planner, command);
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
  readonly timestampMs: number;
  private readonly events: BoardEvent[] = [];
  private readonly undoEvents: BoardEvent[] = [];
  private readonly affectedStrokeIds = new Set<string>();
  private readonly eventIdFactory: () => string;
  private readonly objectIdFactory: () => string;

  constructor(state: BoardState, context: DiagramCommandContext) {
    this.state = state;
    this.context = context;
    this.createdAt = context.createdAt ?? new Date().toISOString();
    const parsedTimestamp = Date.parse(this.createdAt);
    this.timestampMs = Number.isFinite(parsedTimestamp) ? parsedTimestamp : Date.now();
    this.eventIdFactory = context.eventIdFactory ?? randomId;
    this.objectIdFactory = context.objectIdFactory ?? randomId;
  }

  objectId(explicitId?: string): string {
    return explicitId ?? this.objectIdFactory();
  }

  getStroke(id: string): Stroke {
    const stroke = this.tryGetStroke(id);
    if (!stroke) {
      const raw = this.state.strokes[id] ?? this.state.activeStrokes[id];
      if (!raw || raw.status === "deleted") {
        throw new DiagramCommandError(`Diagram object not found: ${id}`);
      }
      throw new DiagramCommandError(`Stroke is not a semantic diagram object: ${id}`);
    }
    return stroke;
  }

  /** Like getStroke but returns null instead of throwing for missing, deleted, or non-semantic strokes. */
  tryGetStroke(id: string): Stroke | null {
    const stroke = this.state.strokes[id] ?? this.state.activeStrokes[id];
    if (!stroke || stroke.status === "deleted" || !stroke.annotation) {
      return null;
    }
    return stroke;
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

  createStroke(stroke: Stroke): void {
    if (this.state.strokes[stroke.id] || this.state.activeStrokes[stroke.id]) {
      throw new DiagramCommandError(`Diagram object already exists: ${stroke.id}`);
    }
    this.add({ type: "stroke.started", stroke });
    this.add(
      { type: "stroke.committed", strokeId: stroke.id },
      { type: "stroke.deleted", strokeIds: [stroke.id] },
    );
  }

  updateAnnotation(id: string, annotation: StrokeAnnotation, points: StrokePoint[]): void {
    const previous = this.getStroke(id);
    const previousAnnotation = previous.annotation;
    if (!previousAnnotation) {
      throw new DiagramCommandError(`Stroke is not a semantic diagram object: ${id}`);
    }
    this.add(
      {
        type: "stroke.annotation_updated",
        strokeId: id,
        annotation,
        points,
      },
      {
        type: "stroke.annotation_updated",
        strokeId: id,
        annotation: cloneAnnotation(previousAnnotation),
        points: clonePoints(previous.points),
      },
    );
  }

  updateLabel(id: string, label: string): void {
    const previous = this.getStroke(id);
    this.add(
      { type: "stroke.label_updated", strokeId: id, label },
      {
        type: "stroke.label_updated",
        strokeId: id,
        label: previous.annotation?.label ?? "",
      },
    );
  }

  delete(ids: string[]): void {
    const uniqueIds = unique(ids);
    for (const id of uniqueIds) {
      this.getStroke(id);
    }
    this.add(
      { type: "stroke.deleted", strokeIds: uniqueIds },
      { type: "stroke.restored", strokeIds: uniqueIds },
    );
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

function planCreateNode(planner: CommandPlanner, command: CreateNodeCommand): void {
  if (!command.bounds && !command.center) {
    throw new DiagramCommandError("node.create requires bounds or center");
  }
  const id = planner.objectId(command.nodeId);
  const bounds = command.bounds
    ? normalizeBounds(command.bounds)
    : boundsAroundCenter(command.center as AnnotationPoint, defaultNodeSize(command.nodeType));
  const annotation: StrokeAnnotation = {
    type: command.nodeType === "circle" ? "ellipse" : "flow_node",
    source: command.source ?? "ai",
    bounds,
    nodeType: command.nodeType,
    strokeColor: command.style?.strokeColor ?? "#2563eb",
    fillColor:
      command.style?.fillColor ?? (command.nodeType === "note" ? "#fef9c3" : "#f8fafc"),
  };
  if (command.label !== undefined) annotation.label = command.label;
  if (command.style?.opacity !== undefined) annotation.opacity = command.style.opacity;
  planner.createStroke(
    semanticStroke(planner, id, annotation, command.style?.thickness ?? 3),
  );
}

function planConnectNodes(planner: CommandPlanner, command: ConnectNodesCommand): void {
  if (command.fromId === command.toId) {
    throw new DiagramCommandError("nodes.connect requires two different objects");
  }
  const fromStroke = planner.getStroke(command.fromId);
  const toStroke = planner.getStroke(command.toId);
  const from = requireBounds(fromStroke);
  const to = requireBounds(toStroke);
  const endpoints = connectorEndpoints(
    from,
    to,
    fromStroke.annotation?.nodeType,
    toStroke.annotation?.nodeType,
  );
  const id = planner.objectId(command.connectorId);
  const annotation: StrokeAnnotation = {
    type: "connector",
    source: command.source ?? "ai",
    start: endpoints.start,
    end: endpoints.end,
    snappedStartStrokeId: command.fromId,
    snappedEndStrokeId: command.toId,
    strokeColor: command.style?.strokeColor ?? "#334155",
  };
  const routeOffset = nextConnectorRouteOffset(
    planner.state,
    command.fromId,
    command.toId,
  );
  if (routeOffset !== 0) annotation.routeOffset = routeOffset;
  if (command.label !== undefined) annotation.label = command.label;
  if (command.style?.opacity !== undefined) annotation.opacity = command.style.opacity;
  planner.createStroke(
    semanticStroke(planner, id, annotation, command.style?.thickness ?? 3),
  );
}

function planReverseConnection(
  planner: CommandPlanner,
  command: ReverseConnectionCommand,
): void {
  const connector = planner.getStroke(command.connectorId);
  const annotation = connector.annotation;
  if (
    !annotation ||
    (annotation.type !== "connector" && annotation.type !== "arrow") ||
    !annotation.snappedStartStrokeId ||
    !annotation.snappedEndStrokeId
  ) {
    throw new DiagramCommandError(
      `connection.reverse requires a snapped connector: ${command.connectorId}`,
    );
  }

  const reversedFromId = annotation.snappedEndStrokeId;
  const reversedToId = annotation.snappedStartStrokeId;
  const reversedFromStroke = planner.getStroke(reversedFromId);
  const reversedToStroke = planner.getStroke(reversedToId);
  const reversedFrom = requireBounds(reversedFromStroke);
  const reversedTo = requireBounds(reversedToStroke);
  const endpoints = connectorEndpoints(
    reversedFrom,
    reversedTo,
    reversedFromStroke.annotation?.nodeType,
    reversedToStroke.annotation?.nodeType,
  );
  const updated = cloneAnnotation(annotation);
  updated.snappedStartStrokeId = reversedFromId;
  updated.snappedEndStrokeId = reversedToId;
  updated.start = endpoints.start;
  updated.end = endpoints.end;
  const routeOffset = nextConnectorRouteOffset(
    planner.state,
    reversedFromId,
    reversedToId,
    connector.id,
  );
  if (routeOffset === 0) {
    delete updated.routeOffset;
  } else {
    updated.routeOffset = routeOffset;
  }
  if (command.label !== undefined) {
    updated.label = command.label;
  }
  planner.updateAnnotation(
    connector.id,
    updated,
    pointsForAnnotation(updated, planner.timestampMs),
  );
}

function planMoveObjects(planner: CommandPlanner, command: MoveObjectsCommand): void {
  if ((command.delta === undefined) === (command.to === undefined)) {
    throw new DiagramCommandError("objects.move requires exactly one of delta or to");
  }
  const ids = expandSelectedGroups(planner, command.objectIds);
  const objects = ids.map((id) => planner.getStroke(id));
  // Only objects with a resolvable position contribute to the selection bounds.
  // A malformed object (e.g. a connector missing both bounds and endpoints) is
  // skipped rather than aborting the move of every other object.
  const positioned = objects.filter(hasResolvablePosition);
  if (positioned.length === 0) {
    throw new DiagramCommandError("objects.move has no movable objects in the selection");
  }
  const selectionBounds = unionBounds(positioned.map(positionBounds));
  const delta = command.delta ?? {
    x: (command.to as AnnotationPoint).x - selectionBounds.x,
    y: (command.to as AnnotationPoint).y - selectionBounds.y,
  };
  const changedNodes: string[] = [];

  for (const stroke of positioned) {
    const annotation = cloneAnnotation(stroke.annotation as StrokeAnnotation);
    translateAnnotation(annotation, delta.x, delta.y);
    planner.updateAnnotation(stroke.id, annotation, pointsForAnnotation(annotation, planner.timestampMs));
    if (annotation.bounds) changedNodes.push(stroke.id);
  }
  syncAttachedConnectors(planner, changedNodes, new Set(positioned.map((stroke) => stroke.id)));
}

function planResizeObject(planner: CommandPlanner, command: ResizeObjectCommand): void {
  const stroke = planner.getStroke(command.objectId);
  const annotation = cloneAnnotation(stroke.annotation as StrokeAnnotation);
  if (!annotation.bounds) {
    throw new DiagramCommandError(`Diagram object cannot be resized: ${command.objectId}`);
  }
  annotation.bounds = normalizeBounds(command.bounds);
  planner.updateAnnotation(
    stroke.id,
    annotation,
    pointsForAnnotation(annotation, planner.timestampMs),
  );
  syncAttachedConnectors(planner, [stroke.id]);
}

function planRenameObject(planner: CommandPlanner, command: RenameObjectCommand): void {
  planner.updateLabel(command.objectId, command.label);
}

function planRestyleObject(planner: CommandPlanner, command: RestyleObjectCommand): void {
  const stroke = planner.getStroke(command.objectId);
  const annotation = cloneAnnotation(stroke.annotation as StrokeAnnotation);
  if (command.fillColor !== undefined) {
    annotation.fillColor = command.fillColor;
  }
  if (command.strokeColor !== undefined) {
    annotation.strokeColor = command.strokeColor;
  }
  planner.updateAnnotation(
    stroke.id,
    annotation,
    pointsForAnnotation(annotation, planner.timestampMs),
  );
}

function planGroupObjects(planner: CommandPlanner, command: GroupObjectsCommand): void {
  const memberIds = unique(command.objectIds);
  if (memberIds.length === 0) {
    throw new DiagramCommandError("objects.group requires at least one object");
  }
  const members = memberIds.map((id) => planner.getStroke(id));
  const padding = Math.max(0, command.padding ?? DEFAULT_GROUP_PADDING);
  const contentBounds = unionBounds(members.map(requireBounds));
  const bounds = {
    x: contentBounds.x - padding,
    y: contentBounds.y - padding,
    width: contentBounds.width + padding * 2,
    height: contentBounds.height + padding * 2,
  };
  const groupId = planner.objectId(command.groupId);
  const groupAnnotation: StrokeAnnotation = {
    type: "rectangle",
    source: command.source ?? "ai",
    bounds,
    label: command.label ?? "Group",
    strokeColor: command.style?.strokeColor ?? "#64748b",
    fillColor: command.style?.fillColor ?? "rgba(248, 250, 252, 0.08)",
    opacity: command.style?.opacity ?? 0.8,
    groupMemberStrokeIds: memberIds,
  };
  planner.createStroke(
    semanticStroke(planner, groupId, groupAnnotation, command.style?.thickness ?? 2),
  );
  for (const member of members) {
    const annotation = cloneAnnotation(member.annotation as StrokeAnnotation);
    annotation.groupId = groupId;
    planner.updateAnnotation(
      member.id,
      annotation,
      pointsForAnnotation(annotation, planner.timestampMs),
    );
  }
}

function planDeleteObjects(planner: CommandPlanner, command: DeleteObjectsCommand): void {
  const requested = unique(command.objectIds);
  if (requested.length === 0) {
    throw new DiagramCommandError("objects.delete requires at least one object");
  }
  const ids = new Set(requested);
  if (command.cascadeConnectors !== false) {
    for (const stroke of activeSemanticStrokes(planner.state)) {
      const annotation = stroke.annotation;
      if (
        annotation?.type === "connector" &&
        ((annotation.snappedStartStrokeId && ids.has(annotation.snappedStartStrokeId)) ||
          (annotation.snappedEndStrokeId && ids.has(annotation.snappedEndStrokeId)))
      ) {
        ids.add(stroke.id);
      }
    }
  }

  // Keep optional grouping metadata consistent while still using only the
  // existing annotation-update/delete event contract.
  for (const group of activeSemanticStrokes(planner.state)) {
    const memberIds = group.annotation?.groupMemberStrokeIds;
    if (!memberIds) continue;
    if (ids.has(group.id)) {
      for (const memberId of memberIds) {
        if (ids.has(memberId)) continue;
        const member = planner.state.strokes[memberId] ?? planner.state.activeStrokes[memberId];
        if (!member?.annotation || member.status === "deleted") continue;
        const annotation = cloneAnnotation(member.annotation);
        delete annotation.groupId;
        planner.updateAnnotation(
          member.id,
          annotation,
          pointsForAnnotation(annotation, planner.timestampMs),
        );
      }
      continue;
    }
    const remainingMemberIds = memberIds.filter((memberId) => !ids.has(memberId));
    if (remainingMemberIds.length === memberIds.length) continue;
    if (remainingMemberIds.length === 0) {
      ids.add(group.id);
      continue;
    }
    const annotation = cloneAnnotation(group.annotation as StrokeAnnotation);
    annotation.groupMemberStrokeIds = remainingMemberIds;
    planner.updateAnnotation(
      group.id,
      annotation,
      pointsForAnnotation(annotation, planner.timestampMs),
    );
  }
  planner.delete([...ids]);
}

function planDuplicateObjects(planner: CommandPlanner, command: DuplicateObjectsCommand): void {
  const sourceIds = expandSelectedGroups(planner, command.objectIds);
  if (sourceIds.length === 0) {
    throw new DiagramCommandError("objects.duplicate requires at least one object");
  }
  const sourceStrokes = sourceIds.map((id) => planner.getStroke(id));
  const idMap = new Map<string, string>();
  for (const source of sourceStrokes) {
    idMap.set(source.id, planner.objectId(command.idMap?.[source.id]));
  }
  const offset = command.offset ?? { x: 24, y: 24 };

  for (const source of sourceStrokes) {
    const annotation = cloneAnnotation(source.annotation as StrokeAnnotation);
    translateAnnotation(annotation, offset.x, offset.y);
    remapAnnotationReferences(annotation, idMap);
    const duplicateId = idMap.get(source.id);
    if (!duplicateId) continue;
    const overrides: Partial<Pick<Stroke, "color" | "inputSource" | "trackingSource">> = {
      color: source.color,
    };
    if (source.inputSource) overrides.inputSource = source.inputSource;
    if (source.trackingSource) overrides.trackingSource = source.trackingSource;
    planner.createStroke(
      semanticStroke(planner, duplicateId, annotation, source.thickness, overrides),
    );
  }
}

function planAlignObjects(planner: CommandPlanner, command: AlignObjectsCommand): void {
  const ids = unique(command.objectIds);
  const strokes = ids.map((id) => planner.getStroke(id));
  if (strokes.length < 2) {
    throw new DiagramCommandError("objects.align requires at least two objects");
  }
  const entries = strokes.map((stroke) => ({ stroke, bounds: requireBounds(stroke) }));
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
      updated.set(entry.stroke.id, alignedBounds(entry.bounds, anchor, command.alignment));
    }
  }
  applyBoundsUpdates(planner, updated);
  syncAttachedConnectors(planner, [...updated.keys()]);
}

function planLayoutObjects(planner: CommandPlanner, command: LayoutObjectsCommand): void {
  const strokes = unique(command.objectIds).map((id) => planner.getStroke(id));
  if (strokes.length === 0) {
    throw new DiagramCommandError("objects.layout requires at least one object");
  }
  const entries = strokes.map((stroke) => ({ stroke, bounds: requireBounds(stroke) }));
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
    updated.set(entry.stroke.id, bounds);
  }
  applyBoundsUpdates(planner, updated);
  syncAttachedConnectors(planner, [...updated.keys()]);
}

function applyBoundsUpdates(
  planner: CommandPlanner,
  updates: ReadonlyMap<string, AnnotationBounds>,
): void {
  for (const [id, bounds] of updates) {
    const stroke = planner.getStroke(id);
    const annotation = cloneAnnotation(stroke.annotation as StrokeAnnotation);
    annotation.bounds = bounds;
    planner.updateAnnotation(id, annotation, pointsForAnnotation(annotation, planner.timestampMs));
  }
}

function syncAttachedConnectors(
  planner: CommandPlanner,
  changedIds: readonly string[],
  explicitlyMovedIds = new Set<string>(),
): void {
  const changed = new Set(changedIds);
  for (const connector of activeSemanticStrokes(planner.state)) {
    const annotation = connector.annotation;
    if (
      !annotation ||
      annotation.type !== "connector" ||
      explicitlyMovedIds.has(connector.id) ||
      (!changed.has(annotation.snappedStartStrokeId ?? "") &&
        !changed.has(annotation.snappedEndStrokeId ?? ""))
    ) {
      continue;
    }
    const fromId = annotation.snappedStartStrokeId;
    const toId = annotation.snappedEndStrokeId;
    if (!fromId || !toId) continue;
    const from = planner.getStroke(fromId);
    const to = planner.getStroke(toId);
    if (!from.annotation?.bounds || !to.annotation?.bounds) continue;
    const endpoints = connectorEndpoints(
      from.annotation.bounds,
      to.annotation.bounds,
      from.annotation.nodeType,
      to.annotation.nodeType,
    );
    const updated = cloneAnnotation(annotation);
    updated.start = endpoints.start;
    updated.end = endpoints.end;
    planner.updateAnnotation(
      connector.id,
      updated,
      pointsForAnnotation(updated, planner.timestampMs),
    );
  }
}

function semanticStroke(
  planner: CommandPlanner,
  id: string,
  annotation: StrokeAnnotation,
  thickness: number,
  overrides: Partial<Pick<Stroke, "color" | "inputSource" | "trackingSource">> = {},
): Stroke {
  const stroke: Stroke = {
    id,
    boardId: planner.state.boardId,
    userId: planner.context.userId,
    tool: "marker",
    color: overrides.color ?? annotation.strokeColor ?? "#334155",
    thickness,
    points: pointsForAnnotation(annotation, planner.timestampMs),
    createdAt: planner.createdAt,
    updatedAt: planner.createdAt,
    status: "active",
    annotation,
    inputSource: overrides.inputSource ?? "pointer",
    trackingSource: overrides.trackingSource ?? "manual",
  };
  return stroke;
}

function pointsForAnnotation(annotation: StrokeAnnotation, timestampMs: number): StrokePoint[] {
  if (annotation.bounds) {
    const { x, y, width, height } = annotation.bounds;
    if (annotation.type === "ellipse" || annotation.type === "pointer") {
      const points: StrokePoint[] = [];
      const centerX = x + width / 2;
      const centerY = y + height / 2;
      for (let index = 0; index <= 32; index += 1) {
        const angle = (Math.PI * 2 * index) / 32;
        points.push(
          diagramPoint(
            centerX + Math.cos(angle) * (width / 2),
            centerY + Math.sin(angle) * (height / 2),
            timestampMs + index,
          ),
        );
      }
      return points;
    }
    return [
      diagramPoint(x, y, timestampMs),
      diagramPoint(x + width, y, timestampMs + 1),
      diagramPoint(x + width, y + height, timestampMs + 2),
      diagramPoint(x, y + height, timestampMs + 3),
      diagramPoint(x, y, timestampMs + 4),
    ];
  }
  if (annotation.start && annotation.end) {
    return [
      diagramPoint(annotation.start.x, annotation.start.y, timestampMs),
      diagramPoint(annotation.end.x, annotation.end.y, timestampMs + 1),
    ];
  }
  return [];
}

function diagramPoint(x: number, y: number, t: number): StrokePoint {
  return { x, y, t, inputSource: "pointer", trackingSource: "manual" };
}

function connectorEndpoints(
  from: AnnotationBounds,
  to: AnnotationBounds,
  fromNodeType?: AnnotationNodeType,
  toNodeType?: AnnotationNodeType,
): { start: AnnotationPoint; end: AnnotationPoint } {
  const fromCenter = centerOf(from);
  const toCenter = centerOf(to);
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

function nextConnectorRouteOffset(
  state: BoardState,
  fromId: string,
  toId: string,
  excludedConnectorId?: string,
): number {
  const siblingCount = activeSemanticStrokes(state).filter((stroke) => {
    if (stroke.id === excludedConnectorId) return false;
    const annotation = stroke.annotation;
    if (
      annotation?.type !== "connector" ||
      !annotation.snappedStartStrokeId ||
      !annotation.snappedEndStrokeId
    ) {
      return false;
    }
    return (
      (annotation.snappedStartStrokeId === fromId &&
        annotation.snappedEndStrokeId === toId) ||
      (annotation.snappedStartStrokeId === toId &&
        annotation.snappedEndStrokeId === fromId)
    );
  }).length;
  if (siblingCount === 0) return 0;
  const lane = Math.ceil(siblingCount / 2);
  const direction = siblingCount % 2 === 1 ? 1 : -1;
  return direction * lane * 72;
}

function translateAnnotation(annotation: StrokeAnnotation, dx: number, dy: number): void {
  if (annotation.bounds) {
    annotation.bounds = {
      ...annotation.bounds,
      x: annotation.bounds.x + dx,
      y: annotation.bounds.y + dy,
    };
  }
  if (annotation.start) {
    annotation.start = { x: annotation.start.x + dx, y: annotation.start.y + dy };
  }
  if (annotation.end) {
    annotation.end = { x: annotation.end.x + dx, y: annotation.end.y + dy };
  }
}

function remapAnnotationReferences(
  annotation: StrokeAnnotation,
  idMap: ReadonlyMap<string, string>,
): void {
  if (annotation.snappedStartStrokeId) {
    const remapped = idMap.get(annotation.snappedStartStrokeId);
    if (remapped) annotation.snappedStartStrokeId = remapped;
    else delete annotation.snappedStartStrokeId;
  }
  if (annotation.snappedEndStrokeId) {
    const remapped = idMap.get(annotation.snappedEndStrokeId);
    if (remapped) annotation.snappedEndStrokeId = remapped;
    else delete annotation.snappedEndStrokeId;
  }
  if (annotation.groupId) {
    const remapped = idMap.get(annotation.groupId);
    if (remapped) annotation.groupId = remapped;
    else delete annotation.groupId;
  }
  if (annotation.groupMemberStrokeIds) {
    annotation.groupMemberStrokeIds = annotation.groupMemberStrokeIds
      .map((id) => idMap.get(id))
      .filter((id): id is string => id !== undefined);
  }
}

function expandSelectedGroups(planner: CommandPlanner, ids: readonly string[]): string[] {
  const expanded = new Set<string>();
  const pending = [...ids];
  while (pending.length > 0) {
    const id = pending.shift();
    if (!id || expanded.has(id)) continue;
    // Skip ids that no longer resolve to a live semantic object. Group metadata
    // can reference a since-deleted member; a stale member must not abort the
    // whole move/duplicate.
    const stroke = planner.tryGetStroke(id);
    if (!stroke) continue;
    expanded.add(id);
    pending.push(...(stroke.annotation?.groupMemberStrokeIds ?? []));
  }
  return [...expanded];
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
  entries: Array<{ stroke: Stroke; bounds: AnnotationBounds }>,
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
    output.set(entry.stroke.id, bounds);
  }
}

function requireBounds(stroke: Stroke): AnnotationBounds {
  const bounds = stroke.annotation?.bounds;
  if (!bounds) {
    throw new DiagramCommandError(`Diagram object has no bounds: ${stroke.id}`);
  }
  return bounds;
}

function hasResolvablePosition(stroke: Stroke): boolean {
  const annotation = stroke.annotation;
  if (!annotation) return false;
  return Boolean(annotation.bounds || (annotation.start && annotation.end));
}

function positionBounds(stroke: Stroke): AnnotationBounds {
  if (stroke.annotation?.bounds) return stroke.annotation.bounds;
  const start = stroke.annotation?.start;
  const end = stroke.annotation?.end;
  if (start && end) {
    return {
      x: Math.min(start.x, end.x),
      y: Math.min(start.y, end.y),
      width: Math.max(Math.abs(end.x - start.x), 1),
      height: Math.max(Math.abs(end.y - start.y), 1),
    };
  }
  throw new DiagramCommandError(`Diagram object has no position: ${stroke.id}`);
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

function centerOf(bounds: AnnotationBounds): AnnotationPoint {
  return { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 };
}

function cloneAnnotation(annotation: StrokeAnnotation): StrokeAnnotation {
  const clone: StrokeAnnotation = { ...annotation };
  if (annotation.bounds) clone.bounds = { ...annotation.bounds };
  if (annotation.start) clone.start = { ...annotation.start };
  if (annotation.end) clone.end = { ...annotation.end };
  if (annotation.groupMemberStrokeIds) {
    clone.groupMemberStrokeIds = [...annotation.groupMemberStrokeIds];
  }
  return clone;
}

function clonePoints(points: readonly StrokePoint[]): StrokePoint[] {
  return points.map((point) => ({ ...point }));
}

function activeSemanticStrokes(state: BoardState): Stroke[] {
  return Object.values(state.strokes).filter(
    (stroke) => stroke.status !== "deleted" && stroke.annotation !== undefined,
  );
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

function eventStrokeIds(event: BoardEvent): string[] {
  switch (event.type) {
    case "stroke.started":
      return [event.stroke.id];
    case "stroke.committed":
    case "stroke.annotation_updated":
    case "stroke.label_updated":
      return [event.strokeId];
    case "stroke.deleted":
    case "stroke.restored":
      return event.strokeIds;
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
