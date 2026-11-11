import { createBoardSceneElement, createRichTextDocument } from "./sceneElements.ts";
import type {
  AnnotationBounds,
  AnnotationPoint,
  BoardElementPatchOperation,
  BoardSceneElement,
  BoardState,
  ConnectorElement,
  ShapeKind,
} from "./types.ts";

/**
 * Board objects come in two kinds. Airo's own diagram nodes are legacy
 * annotation strokes, mirrored into scene elements under the same id. Typed
 * commands such as "add a user" and the toolbar create v2 scene elements with
 * no stroke behind them. These helpers let a diagram command plan change v2
 * elements, and keep v2 connectors attached to anything that moves or goes.
 */

/** Element kinds a plan can name, connect, rename, move and delete. */
const SCENE_NODE_KINDS = new Set<BoardSceneElement["kind"]>(["shape", "sticky", "text", "mind_map_node"]);

export type SceneElementEvent =
  | { type: "element.created"; element: BoardSceneElement }
  | { type: "element.patched"; elementId: string; patches: BoardElementPatchOperation[] }
  | { type: "element.deleted"; elementId: string }
  | { type: "element.restored"; elementId: string };

/** Records an event and the one that undoes it. */
export type SceneEventSink = {
  readonly state: BoardState;
  readonly boardSessionId: string;
  readonly userId: string;
  readonly createdAt: string;
  objectId(explicitId?: string): string;
  add(payload: SceneElementEvent, inverse: SceneElementEvent): void;
};

export function isSceneNodeElement(element: BoardSceneElement | undefined): element is BoardSceneElement {
  return Boolean(element && element.status === "active" && SCENE_NODE_KINDS.has(element.kind));
}

/** A v2 element with no legacy stroke behind it; legacy commands can't reach it. */
export function isSceneOnlyElement(state: BoardState, id: string): boolean {
  const element = state.elements[id];
  return Boolean(element && element.status === "active" && !element.legacyStrokeId && !state.strokes[id]);
}

export function sceneElementCenter(element: BoardSceneElement): AnnotationPoint {
  if (element.kind === "connector") {
    return {
      x: (element.start.point.x + element.end.point.x) / 2,
      y: (element.start.point.y + element.end.point.y) / 2,
    };
  }
  return {
    x: element.transform.x + element.transform.width / 2,
    y: element.transform.y + element.transform.height / 2,
  };
}

/** Where a connector meets the element's box on the way toward a point. */
function anchorToward(element: BoardSceneElement, toward: AnnotationPoint): AnnotationPoint {
  const center = sceneElementCenter(element);
  const dx = toward.x - center.x;
  const dy = toward.y - center.y;
  if (Math.abs(dx) < 0.001 && Math.abs(dy) < 0.001) return center;
  const halfWidth = Math.max(0.5, element.transform.width / 2);
  const halfHeight = Math.max(0.5, element.transform.height / 2);
  const scale = 1 / Math.max(Math.abs(dx) / halfWidth, Math.abs(dy) / halfHeight);
  return { x: center.x + dx * scale, y: center.y + dy * scale };
}

function boundsBetween(start: AnnotationPoint, end: AnnotationPoint): BoardSceneElement["transform"] {
  return {
    x: Math.min(start.x, end.x),
    y: Math.min(start.y, end.y),
    width: Math.max(1, Math.abs(end.x - start.x)),
    height: Math.max(1, Math.abs(end.y - start.y)),
    rotation: 0,
  };
}

function activeNode(state: BoardState, id: string): BoardSceneElement {
  const element = state.elements[id];
  if (!isSceneNodeElement(element)) throw new Error(`Board object not found: ${id}`);
  return element;
}

function activeConnector(state: BoardState, id: string): ConnectorElement {
  const element = state.elements[id];
  if (!element || element.status !== "active" || element.kind !== "connector") {
    throw new Error(`Connector not found: ${id}`);
  }
  return element;
}

function nextZIndex(state: BoardState): number {
  return Object.values(state.elements).reduce(
    (highest, element) => Math.max(highest, Number.isFinite(element.zIndex) ? element.zIndex : 0),
    -1,
  ) + 1;
}

/** Active v2 connectors (not legacy mirrors) attached to any of the ids. */
export function sceneConnectorsAttachedTo(state: BoardState, ids: ReadonlySet<string>): ConnectorElement[] {
  return Object.values(state.elements).filter((element): element is ConnectorElement =>
    element.kind === "connector" &&
    element.status === "active" &&
    !element.legacyStrokeId &&
    Boolean(
      (element.start.binding && ids.has(element.start.binding.elementId)) ||
      (element.end.binding && ids.has(element.end.binding.elementId)),
    ));
}

/** Active v2 connectors from one element to another, in that direction. */
export function sceneConnectorsBetween(state: BoardState, fromId: string, toId: string): ConnectorElement[] {
  return Object.values(state.elements).filter((element): element is ConnectorElement =>
    element.kind === "connector" &&
    element.status === "active" &&
    !element.legacyStrokeId &&
    element.start.binding?.elementId === fromId &&
    element.end.binding?.elementId === toId);
}

export function connectElements(
  sink: SceneEventSink,
  input: { connectorId?: string; fromId: string; toId: string; label?: string },
): string {
  const from = activeNode(sink.state, input.fromId);
  const to = activeNode(sink.state, input.toId);
  if (from.id === to.id) throw new Error("A connector needs two different objects.");
  const start = anchorToward(from, sceneElementCenter(to));
  const end = anchorToward(to, sceneElementCenter(from));
  const id = sink.objectId(input.connectorId);
  const connector = createBoardSceneElement({
    id,
    boardId: sink.boardSessionId,
    kind: "connector",
    pathKind: "bent",
    transform: boundsBetween(start, end),
    start: { point: start, binding: { elementId: from.id, anchor: "auto" }, decoration: "none" },
    end: { point: end, binding: { elementId: to.id, anchor: "auto" }, decoration: "solid_arrow" },
    label: createRichTextDocument(input.label ?? "", `${id}:label`),
    zIndex: nextZIndex(sink.state),
    createdAt: sink.createdAt,
    ...(sink.userId ? { creatorId: sink.userId } : {}),
  });
  sink.add({ type: "element.created", element: connector }, { type: "element.deleted", elementId: id });
  return id;
}

export function renameElement(sink: SceneEventSink, elementId: string, label: string): void {
  const element = sink.state.elements[elementId];
  if (element?.status === "active" && element.kind === "connector") {
    sink.add(
      { type: "element.patched", elementId, patches: [{ op: "field.set", path: ["label"], value: createRichTextDocument(label, `${elementId}:label`) }] },
      { type: "element.patched", elementId, patches: [{ op: "field.set", path: ["label"], value: structuredClone(element.label) }] },
    );
    return;
  }
  const node = activeNode(sink.state, elementId);
  if (!("content" in node)) throw new Error("That object has no label to rename.");
  sink.add(
    { type: "element.patched", elementId, patches: [{ op: "field.set", path: ["content"], value: createRichTextDocument(label, `${elementId}:content`) }] },
    { type: "element.patched", elementId, patches: [{ op: "field.set", path: ["content"], value: structuredClone(node.content) }] },
  );
}

export function moveElements(sink: SceneEventSink, elementIds: readonly string[], delta: AnnotationPoint): void {
  const positions = new Map<string, AnnotationPoint>();
  for (const id of new Set(elementIds)) {
    const { transform } = activeNode(sink.state, id);
    positions.set(id, { x: transform.x + delta.x, y: transform.y + delta.y });
  }
  positionElements(sink, positions);
  refreshAttachedConnectors(sink, elementIds);
}

/** Puts v2 nodes' top-left corners at new points. Attached connectors need refreshing after. */
export function positionElements(sink: SceneEventSink, positions: ReadonlyMap<string, AnnotationPoint>): void {
  for (const [id, point] of positions) {
    const { transform } = activeNode(sink.state, id);
    if (transform.x === point.x && transform.y === point.y) continue;
    sink.add(
      {
        type: "element.patched",
        elementId: id,
        patches: [
          { op: "field.set", path: ["transform", "x"], value: point.x },
          { op: "field.set", path: ["transform", "y"], value: point.y },
        ],
      },
      {
        type: "element.patched",
        elementId: id,
        patches: [
          { op: "field.set", path: ["transform", "x"], value: transform.x },
          { op: "field.set", path: ["transform", "y"], value: transform.y },
        ],
      },
    );
  }
}

/** Copies v2 nodes, shifted by `offset`, as the toolbar's duplicate does. Returns the copies' ids. */
export function duplicateElements(
  sink: SceneEventSink,
  input: { elementIds: readonly string[]; idMap?: Readonly<Record<string, string>>; offset?: AnnotationPoint },
): string[] {
  const offset = input.offset ?? { x: 24, y: 24 };
  return [...new Set(input.elementIds)].map((sourceId) => {
    const source = activeNode(sink.state, sourceId);
    const id = sink.objectId(input.idMap?.[sourceId]);
    if (sink.state.elements[id]) throw new Error(`Board object already exists: ${id}`);
    const copy = structuredClone(source);
    copy.id = id;
    copy.transform.x += offset.x;
    copy.transform.y += offset.y;
    copy.zIndex = nextZIndex(sink.state);
    copy.createdAt = sink.createdAt;
    copy.updatedAt = sink.createdAt;
    copy.revision = 1;
    delete copy.legacyStrokeId;
    if (sink.userId) copy.creatorId = sink.userId;
    // A copied mind-map node starts its own map rather than claiming the original's links.
    if (copy.kind === "mind_map_node") {
      copy.relation = { direction: copy.relation.direction, childIds: [], connectorIds: [] };
    }
    sink.add({ type: "element.created", element: copy }, { type: "element.deleted", elementId: id });
    return id;
  });
}

/** Draws a section around v2 nodes, as the toolbar's group does. Returns the section's id. */
export function groupElements(
  sink: SceneEventSink,
  input: { sectionId?: string; memberIds: readonly string[]; label?: string },
): string {
  const members = [...new Set(input.memberIds)].map((id) => {
    // A section can't own a legacy node: the stroke, not the element, decides where that is.
    if (!isSceneOnlyElement(sink.state, id)) throw new Error(`Not a v2 board object: ${id}`);
    return activeNode(sink.state, id);
  });
  if (members.length === 0) throw new Error("A group needs at least one object.");
  const padding = 48;
  const left = Math.min(...members.map(({ transform }) => transform.x)) - padding;
  const top = Math.min(...members.map(({ transform }) => transform.y)) - padding;
  const right = Math.max(...members.map(({ transform }) => transform.x + transform.width)) + padding;
  const bottom = Math.max(...members.map(({ transform }) => transform.y + transform.height)) + padding;
  const id = sink.objectId(input.sectionId);
  const section = createBoardSceneElement({
    id,
    boardId: sink.boardSessionId,
    kind: "section",
    transform: { x: left, y: top, width: right - left, height: bottom - top, rotation: 0 },
    memberIds: members.map(({ id: memberId }) => memberId),
    title: createRichTextDocument(input.label ?? "Group", `${id}:title`),
    zIndex: nextZIndex(sink.state),
    createdAt: sink.createdAt,
    ...(sink.userId ? { creatorId: sink.userId } : {}),
  });
  sink.add({ type: "element.created", element: section }, { type: "element.deleted", elementId: id });
  for (const member of members) {
    sink.add(
      { type: "element.patched", elementId: member.id, patches: [{ op: "field.set", path: ["sectionId"], value: id }] },
      {
        type: "element.patched",
        elementId: member.id,
        patches: [member.sectionId
          ? { op: "field.set", path: ["sectionId"], value: member.sectionId }
          : { op: "field.unset", path: ["sectionId"] }],
      },
    );
  }
  return id;
}

/**
 * Re-route v2 connectors attached to objects that just moved, legacy or v2:
 * connectors are drawn from their stored end points, not their bindings.
 */
export function refreshAttachedConnectors(sink: SceneEventSink, movedIds: readonly string[]): void {
  for (const connector of sceneConnectorsAttachedTo(sink.state, new Set(movedIds))) {
    const from = connector.start.binding ? sink.state.elements[connector.start.binding.elementId] : undefined;
    const to = connector.end.binding ? sink.state.elements[connector.end.binding.elementId] : undefined;
    const fromCenter = from ? sceneElementCenter(from) : connector.start.point;
    const toCenter = to ? sceneElementCenter(to) : connector.end.point;
    const start = from ? anchorToward(from, toCenter) : connector.start.point;
    const end = to ? anchorToward(to, fromCenter) : connector.end.point;
    sink.add(
      {
        type: "element.patched",
        elementId: connector.id,
        patches: [
          { op: "field.set", path: ["start", "point"], value: start },
          { op: "field.set", path: ["end", "point"], value: end },
          { op: "field.set", path: ["transform"], value: boundsBetween(start, end) },
          { op: "field.set", path: ["controlPoints"], value: [] },
        ],
      },
      {
        type: "element.patched",
        elementId: connector.id,
        patches: [
          { op: "field.set", path: ["start", "point"], value: connector.start.point },
          { op: "field.set", path: ["end", "point"], value: connector.end.point },
          { op: "field.set", path: ["transform"], value: connector.transform },
          { op: "field.set", path: ["controlPoints"], value: structuredClone(connector.controlPoints) },
        ],
      },
    );
  }
}

/** Deletes v2 elements, taking any v2 connector attached to them along. */
export function deleteElements(sink: SceneEventSink, elementIds: readonly string[]): void {
  const ids = new Set(elementIds.filter((id) => sink.state.elements[id]?.status === "active"));
  if (ids.size === 0) throw new Error("Nothing to delete.");
  removeAttachedConnectors(sink, ids);
  for (const id of ids) {
    if (sink.state.elements[id]?.status !== "active") continue;
    sink.add({ type: "element.deleted", elementId: id }, { type: "element.restored", elementId: id });
  }
}

/** Removes v2 connectors left pointing at objects that are going away. */
export function removeAttachedConnectors(sink: SceneEventSink, goneIds: ReadonlySet<string>): void {
  for (const connector of sceneConnectorsAttachedTo(sink.state, goneIds)) {
    if (goneIds.has(connector.id)) continue;
    sink.add({ type: "element.deleted", elementId: connector.id }, { type: "element.restored", elementId: connector.id });
  }
}

/** Points a v2 connector the other way, optionally relabelling it. */
export function reverseConnector(sink: SceneEventSink, connectorId: string, label?: string): void {
  const connector = activeConnector(sink.state, connectorId);
  const reversedStart = { ...structuredClone(connector.end), decoration: connector.start.decoration };
  const reversedEnd = { ...structuredClone(connector.start), decoration: connector.end.decoration };
  const patches: BoardElementPatchOperation[] = [
    { op: "field.set", path: ["start"], value: reversedStart },
    { op: "field.set", path: ["end"], value: reversedEnd },
    { op: "field.set", path: ["controlPoints"], value: [...connector.controlPoints].reverse().map((point) => ({ ...point })) },
  ];
  const inverse: BoardElementPatchOperation[] = [
    { op: "field.set", path: ["start"], value: structuredClone(connector.start) },
    { op: "field.set", path: ["end"], value: structuredClone(connector.end) },
    { op: "field.set", path: ["controlPoints"], value: structuredClone(connector.controlPoints) },
  ];
  if (label !== undefined) {
    patches.push({ op: "field.set", path: ["label"], value: createRichTextDocument(label, `${connectorId}:label`) });
    inverse.push({ op: "field.set", path: ["label"], value: structuredClone(connector.label) });
  }
  sink.add({ type: "element.patched", elementId: connectorId, patches }, { type: "element.patched", elementId: connectorId, patches: inverse });
}

/** Gives a v2 node a new box (for "make it bigger"), keeping its connectors attached. */
export function resizeElement(sink: SceneEventSink, elementId: string, bounds: AnnotationBounds): void {
  const { transform } = activeNode(sink.state, elementId);
  const width = Math.max(8, bounds.width);
  const height = Math.max(8, bounds.height);
  sink.add(
    {
      type: "element.patched",
      elementId,
      patches: [
        { op: "field.set", path: ["transform", "x"], value: bounds.x },
        { op: "field.set", path: ["transform", "y"], value: bounds.y },
        { op: "field.set", path: ["transform", "width"], value: width },
        { op: "field.set", path: ["transform", "height"], value: height },
      ],
    },
    {
      type: "element.patched",
      elementId,
      patches: [
        { op: "field.set", path: ["transform", "x"], value: transform.x },
        { op: "field.set", path: ["transform", "y"], value: transform.y },
        { op: "field.set", path: ["transform", "width"], value: transform.width },
        { op: "field.set", path: ["transform", "height"], value: transform.height },
      ],
    },
  );
  refreshAttachedConnectors(sink, [elementId]);
}

/** Gives a v2 shape another catalogue shape ("turn it into a decision"). */
export function retypeElement(sink: SceneEventSink, elementId: string, shapeKind: ShapeKind): void {
  const element = activeNode(sink.state, elementId);
  if (element.kind !== "shape") throw new Error("Only a shape can change to another shape.");
  sink.add(
    { type: "element.patched", elementId, patches: [{ op: "field.set", path: ["shapeKind"], value: shapeKind }] },
    { type: "element.patched", elementId, patches: [{ op: "field.set", path: ["shapeKind"], value: element.shapeKind }] },
  );
}

/** Draws a v2 connector solid, dashed or dotted. */
export function restyleConnectorElement(
  sink: SceneEventSink,
  connectorId: string,
  lineStyle: ConnectorElement["style"]["strokeStyle"],
): void {
  const connector = activeConnector(sink.state, connectorId);
  sink.add(
    { type: "element.patched", elementId: connectorId, patches: [{ op: "field.set", path: ["style", "strokeStyle"], value: lineStyle }] },
    { type: "element.patched", elementId: connectorId, patches: [{ op: "field.set", path: ["style", "strokeStyle"], value: connector.style.strokeStyle }] },
  );
}
