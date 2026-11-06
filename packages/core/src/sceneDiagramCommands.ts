import { createBoardSceneElement, createRichTextDocument } from "./sceneElements.ts";
import type {
  AnnotationPoint,
  BoardElementPatchOperation,
  BoardSceneElement,
  BoardState,
  ConnectorElement,
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
  for (const id of new Set(elementIds)) {
    const element = activeNode(sink.state, id);
    sink.add(
      {
        type: "element.patched",
        elementId: id,
        patches: [
          { op: "field.set", path: ["transform", "x"], value: element.transform.x + delta.x },
          { op: "field.set", path: ["transform", "y"], value: element.transform.y + delta.y },
        ],
      },
      {
        type: "element.patched",
        elementId: id,
        patches: [
          { op: "field.set", path: ["transform", "x"], value: element.transform.x },
          { op: "field.set", path: ["transform", "y"], value: element.transform.y },
        ],
      },
    );
  }
  refreshAttachedConnectors(sink, elementIds);
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
