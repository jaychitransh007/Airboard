import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import {
  applyDiagramCommand,
  applyLegacyDiagramFixture,
  boardDiagramGraph,
  boardHasLegacyData,
  convertLegacyBoardState,
  createInitialBoardState,
  createStroke,
  isBoardSceneElement,
  legacyAnnotationStrokeIds,
  legacyConversionGraphDiff,
  reduceBoardEvents,
  validateConvertedBoardState,
} from "../src/index.ts";

/**
 * The one-off conversion of saved boards from legacy annotation strokes to
 * v2 scene elements (shape-merge phase 2). The diagram a board shows must
 * not change (boardDiagramGraph before equals after, apart from model
 * fields), the result must pass what the API and the board accept, and
 * converting twice must change nothing.
 */

const FIXTURE = JSON.parse(
  readFileSync(new URL("../../../apps/web/e2e/fixtures/legacy-annotations.board.json", import.meta.url), "utf8"),
);

let counter = 0;
const context = () => ({
  boardSessionId: "board-1",
  actorParticipantId: "participant-1",
  userId: "user-1",
  createdAt: "2026-10-01T09:00:00.000Z",
  eventIdFactory: () => `event-${++counter}`,
  objectIdFactory: () => `object-${++counter}`,
});

const NODE_TYPES = [
  "process", "service", "database", "queue", "user", "api", "decision",
  "terminator", "io", "document", "note", "circle", "custom",
];

/** Commits a hand-made legacy stroke through the reducer, as an older client did (its mirror included). */
function commitStroke(state, input) {
  const stroke = createStroke({
    id: input.id,
    boardId: state.boardId,
    userId: "user-1",
    point: input.points[0],
    color: input.color ?? "#111827",
    thickness: input.thickness ?? 3,
    ...(input.annotation ? { annotation: input.annotation } : {}),
    createdAt: "2026-10-01T09:00:00.000Z",
  });
  const envelope = { boardSessionId: state.boardId, actorParticipantId: "participant-1", createdAt: "2026-10-01T09:00:00.000Z" };
  return reduceBoardEvents(state, [
    { ...envelope, id: `event-${++counter}`, type: "stroke.started", stroke },
    { ...envelope, id: `event-${++counter}`, type: "stroke.committed", strokeId: input.id, points: input.points },
  ]);
}

const point = (x, y, t = 1) => ({ x, y, t });
const box = (x, y, width, height) => [point(x, y), point(x + width, y), point(x + width, y + height), point(x, y + height), point(x, y)];

/** Every legacy annotation type on one board, built the way they were made. */
function everyAnnotationTypeBoard() {
  let state = createInitialBoardState("board-1");
  NODE_TYPES.forEach((nodeType, index) => {
    state = applyLegacyDiagramFixture(state, {
      type: "node.create",
      nodeId: `node:${nodeType}`,
      nodeType,
      label: nodeType[0].toUpperCase() + nodeType.slice(1),
      center: { x: 120 + (index % 5) * 240, y: 120 + Math.floor(index / 5) * 200 },
      source: "voice",
      style: { strokeColor: "#111827" },
    }, context()).state;
  });
  for (const edge of [
    { connectorId: "edge:writes", fromId: "node:service", toId: "node:database", label: "writes" },
    { connectorId: "edge:reads", fromId: "node:database", toId: "node:service", label: "reads" },
    { connectorId: "edge:plain", fromId: "node:user", toId: "node:api" },
  ]) {
    state = applyLegacyDiagramFixture(state, { type: "nodes.connect", source: "voice", ...edge }, context()).state;
  }
  state = applyDiagramCommand(state, {
    type: "objects.group", groupId: "group:back", objectIds: ["node:queue", "node:decision"], label: "Back office",
  }, context()).state;
  const marks = [
    { id: "mark:rectangle", points: box(100, 700, 120, 60), annotation: { type: "rectangle", source: "gesture", bounds: { x: 100, y: 700, width: 120, height: 60 }, label: "Box" } },
    { id: "mark:ellipse", points: box(260, 700, 100, 60), annotation: { type: "ellipse", source: "gesture", bounds: { x: 260, y: 700, width: 100, height: 60 } } },
    { id: "mark:pointer", points: box(400, 700, 40, 40), annotation: { type: "pointer", source: "gesture", bounds: { x: 400, y: 700, width: 40, height: 40 }, strokeColor: "#ef4444" } },
    { id: "mark:highlight", thickness: 18, color: "#facc15", points: [point(480, 715), point(680, 715)], annotation: { type: "highlight", source: "gesture", bounds: { x: 480, y: 700, width: 200, height: 30 }, strokeColor: "#facc15", opacity: 0.35 } },
    { id: "mark:highlight-ink", thickness: 18, color: "#facc15", points: [point(480, 760), point(680, 760)], annotation: { type: "highlight", source: "gesture", opacity: 0.35 } },
    { id: "mark:cross", points: [point(720, 700), point(760, 740), point(740, 720), point(720, 740), point(760, 700)], annotation: { type: "cross_mark", source: "gesture", bounds: { x: 720, y: 700, width: 40, height: 40 } } },
    { id: "mark:freehand", points: [point(800, 700), point(820, 730), point(860, 690)], annotation: { type: "freehand", source: "gesture", bounds: { x: 800, y: 690, width: 60, height: 40 } } },
    { id: "mark:text", points: [point(100, 820), point(320, 860)], annotation: { type: "text_label", source: "keyboard", bounds: { x: 100, y: 820, width: 220, height: 40 }, label: "Legacy diagram", strokeColor: "#111827" } },
    { id: "mark:sticky", points: [point(360, 820), point(520, 940)], annotation: { type: "sticky_note", source: "gesture", bounds: { x: 360, y: 820, width: 160, height: 120 }, label: "Remember the audit", fillColor: "#fde68a" } },
    { id: "mark:arrow", points: [point(560, 900), point(760, 860)], annotation: { type: "arrow", source: "gesture", start: { x: 560, y: 900 }, end: { x: 760, y: 860 }, lineStyle: "dashed" } },
    { id: "mark:cloud", points: box(800, 820, 140, 80), annotation: { type: "flow_node", source: "ai", nodeType: "service", shapeKind: "cloud", bounds: { x: 800, y: 820, width: 140, height: 80 }, label: "CDN" } },
    { id: "ink:plain", thickness: 4, points: [point(100, 980), point(140, 1000), point(200, 990)] },
  ];
  for (const mark of marks) state = commitStroke(state, mark);
  return state;
}

/** The diagram by id, without the model fields that are meant to change. */
function diagram(state) {
  const graph = boardDiagramGraph(state);
  const round = (value) => Math.round(value * 100) / 100;
  return {
    nodes: Object.fromEntries(graph.nodes.map((node) => [node.id, {
      label: node.label,
      kind: node.kind === "text_label" ? "text" : node.kind,
      role: node.role,
      bounds: Object.values(node.bounds).map(round),
      groups: [...node.groupIds].sort(),
    }])),
    edges: Object.fromEntries(graph.edges.map((edge) => [edge.id, {
      from: edge.from,
      to: edge.to,
      label: edge.label,
      directed: edge.directed,
      lineStyle: edge.lineStyle,
      attached: edge.attached,
      routeOffset: edge.geometry.routeOffset ?? 0,
    }])),
    groups: Object.fromEntries(graph.groups.map((group) => [group.id, {
      label: group.label,
      bounds: Object.values(group.bounds).map(round),
      members: [...group.memberIds].sort(),
    }])),
  };
}

/** Ink marks become v2 drawings, which the diagram graph never lists. */
function withoutInkMarks(view, ids) {
  return { ...view, nodes: Object.fromEntries(Object.entries(view.nodes).filter(([id]) => !ids.includes(id))) };
}

function assertConvertedCleanly(before, after) {
  assert.deepEqual(validateConvertedBoardState(after), [], "passes the board-state validation");
  for (const [id, element] of Object.entries(after.elements)) {
    assert.ok(isBoardSceneElement(element), `${id} is a valid scene element`);
    assert.equal(element.legacyStrokeId, undefined, `${id} is no mirror`);
  }
  assert.deepEqual(legacyAnnotationStrokeIds(after), []);
  assert.equal(boardHasLegacyData(after), false);
  assert.deepEqual(legacyConversionGraphDiff(before, after), []);
  // Idempotent: a second run changes nothing.
  const again = convertLegacyBoardState(after);
  assert.equal(again.changed, false);
  assert.deepEqual(again.state, after);
}

test("the e2e legacy fixture: 21 strokes become 21 v2 elements and the diagram is unchanged", () => {
  const before = structuredClone(FIXTURE);
  const result = convertLegacyBoardState(before);
  assert.deepEqual(before, FIXTURE, "the input is not changed");
  assert.equal(result.changed, true);
  assert.equal(result.annotationStrokeIds.length, 21);
  assert.equal(result.addedElementIds.length, 21);
  assert.equal(result.replacedMirrorIds.length, 21);
  assert.deepEqual(result.state.strokes, {});
  assert.equal(Object.keys(result.state.elements).length, 21);
  assert.deepEqual(diagram(result.state), diagram(FIXTURE));
  assertConvertedCleanly(FIXTURE, result.state);

  const elements = result.state.elements;
  // The same ids, now the kinds Airo draws today.
  assert.equal(elements["node:decision"].kind, "shape");
  assert.equal(elements["node:decision"].shapeKind, "diamond");
  assert.deepEqual(
    { nodeType: elements["node:decision"].metadata.nodeType, nodeShape: elements["node:decision"].metadata.nodeShape },
    { nodeType: "decision", nodeShape: "diamond" },
  );
  assert.equal(elements["sticky:memo"].kind, "sticky");
  assert.equal(elements["text:title"].kind, "text");
  assert.equal(elements["group:back"].kind, "section");
  assert.deepEqual(elements["group:back"].memberIds, ["node:queue", "node:decision"]);
  assert.equal(elements["node:queue"].sectionId, "group:back");
  // Reciprocal connectors keep their lanes, labels and direction.
  assert.equal(elements["edge:reply"].routeOffset, 72);
  assert.equal(elements["edge:reply"].start.binding.elementId, "node:database");
  assert.equal(elements["edge:reply"].end.binding.elementId, "node:service");
  assert.equal(elements["edge:reply"].style.thickness, "thick");
  // Sections lowest, connectors next, then the rest.
  const order = Object.values(elements).sort((a, b) => a.zIndex - b.zIndex).map((element) => element.kind);
  assert.equal(order[0], "section");
  assert.deepEqual(order.slice(1, 5), ["connector", "connector", "connector", "connector"]);
});

test("every annotation type converts to its v2 element with the same label, box and colours", () => {
  const before = everyAnnotationTypeBoard();
  const result = convertLegacyBoardState(before);
  const after = result.state;
  const inkMarks = ["mark:cross", "mark:freehand"];
  assert.deepEqual(withoutInkMarks(diagram(before), inkMarks), diagram(after));
  assertConvertedCleanly(before, after);

  const shapeKinds = Object.fromEntries(NODE_TYPES.map((nodeType) => [nodeType, after.elements[`node:${nodeType}`].shapeKind]));
  assert.deepEqual(shapeKinds, {
    process: "process", service: "service", database: "database", queue: "queue", user: "user", api: "api",
    decision: "diamond", terminator: "terminator", io: "right-parallelogram", document: "document",
    note: "rounded-rectangle", circle: "ellipse", custom: "rounded-rectangle",
  });
  for (const nodeType of NODE_TYPES) {
    const element = after.elements[`node:${nodeType}`];
    const stroke = before.strokes[`node:${nodeType}`];
    assert.equal(element.metadata.nodeType, nodeType);
    assert.equal(element.style.stroke, stroke.annotation.strokeColor);
    assert.equal(element.style.fill, stroke.annotation.fillColor);
    assert.equal(element.style.strokeWidth, stroke.thickness);
    assert.deepEqual(
      [element.transform.x, element.transform.y, element.transform.width, element.transform.height],
      Object.values(stroke.annotation.bounds),
    );
  }
  assert.equal(after.elements["node:note"].style.fill, "#fef9c3", "a note keeps its yellow paper");
  assert.equal(after.elements["mark:cloud"].shapeKind, "cloud", "a catalogue shape keeps its shape");
  assert.equal(after.elements["mark:rectangle"].shapeKind, "square");
  assert.equal(after.elements["mark:ellipse"].style.fillOpacity, 0, "an unfilled ellipse stays unfilled");
  assert.equal(after.elements["mark:pointer"].style.stroke, "#ef4444");
  assert.equal(after.elements["mark:highlight"].kind, "shape");
  assert.equal(after.elements["mark:highlight"].style.fillOpacity, 0.35);
  assert.equal(after.elements["mark:highlight-ink"].kind, "drawing");
  assert.equal(after.elements["mark:highlight-ink"].drawingKind, "marker");
  assert.equal(after.elements["mark:cross"].kind, "drawing");
  assert.deepEqual(after.elements["mark:cross"].points, before.strokes["mark:cross"].points);
  assert.equal(after.elements["ink:plain"].kind, "drawing");
  assert.equal(after.elements["ink:plain"].style.thickness, 4);
  assert.equal(after.elements["mark:arrow"].pathKind, "straight");
  assert.equal(after.elements["mark:arrow"].style.strokeStyle, "dashed");
  assert.equal(after.elements["mark:arrow"].start.binding, undefined, "a loose arrow stays loose");
  assert.equal(after.elements["mark:sticky"].color, "#fde68a");
  assert.equal(after.elements["mark:sticky"].authorVisible, false);
  assert.equal(after.elements["mark:text"].content.blocks[0].runs[0].text, "Legacy diagram");
  assert.equal(after.elements["edge:plain"].label.blocks[0].runs[0].text, "");
  assert.equal(after.elements["edge:writes"].metadata.source, "voice", "provenance is kept");
});

test("connectors with labels both ways keep their ends, labels, directions and lanes", () => {
  const before = everyAnnotationTypeBoard();
  const after = convertLegacyBoardState(before).state;
  const edges = boardDiagramGraph(after).edges;
  const writes = edges.find((edge) => edge.id === "edge:writes");
  const reads = edges.find((edge) => edge.id === "edge:reads");
  assert.deepEqual([writes.from, writes.to, writes.label, writes.directed], ["node:service", "node:database", "writes", true]);
  assert.deepEqual([reads.from, reads.to, reads.label, reads.directed], ["node:database", "node:service", "reads", true]);
  assert.equal(writes.attached, true);
  assert.equal(reads.attached, true);
  assert.equal(writes.geometry.routeOffset, undefined);
  assert.equal(reads.geometry.routeOffset, before.strokes["edge:reads"].annotation.routeOffset);
  assert.notEqual(reads.geometry.routeOffset, undefined);
});

test("a mixed legacy and v2 board keeps its v2 objects and joins them to the converted ones", () => {
  let state = everyAnnotationTypeBoard();
  // v2 objects drawn since phase 1, one arrow bound to a legacy node.
  state = applyDiagramCommand(state, {
    type: "node.create", nodeId: "v2:cache", nodeType: "database", label: "Cache", center: { x: 1300, y: 500 },
  }, context()).state;
  state = applyDiagramCommand(state, {
    type: "nodes.connect", connectorId: "v2:to-cache", fromId: "node:service", toId: "v2:cache", label: "caches",
  }, context()).state;
  state = applyDiagramCommand(state, {
    type: "objects.group", groupId: "v2:group", objectIds: ["v2:cache"], label: "Edge",
  }, context()).state;
  const v2Before = Object.fromEntries(["v2:cache", "v2:to-cache", "v2:group"].map((id) => [id, state.elements[id]]));

  const result = convertLegacyBoardState(state);
  const after = result.state;
  for (const [id, element] of Object.entries(v2Before)) {
    assert.deepEqual(after.elements[id], element, `${id} is untouched`);
  }
  assert.deepEqual(withoutInkMarks(diagram(state), ["mark:cross", "mark:freehand"]), diagram(after));
  assertConvertedCleanly(state, after);
  const minV2 = Math.min(...Object.values(v2Before).map((element) => element.zIndex));
  for (const id of result.addedElementIds) {
    assert.ok(after.elements[id].zIndex < minV2, `${id} is drawn under the v2 objects, as strokes were`);
  }

  // Old and new shapes now group together (refused before conversion).
  assert.throws(() => applyDiagramCommand(state, {
    type: "objects.group", objectIds: ["node:api", "v2:cache"], label: "Mixed",
  }, context()));
  const grouped = applyDiagramCommand(after, {
    type: "objects.group", groupId: "group:mixed", objectIds: ["node:api", "v2:cache"], label: "Mixed",
  }, context()).state;
  assert.deepEqual(grouped.elements["group:mixed"].memberIds, ["node:api", "v2:cache"]);
  // And a converted node moves with its arrows still attached.
  const moved = applyDiagramCommand(after, {
    type: "objects.move", objectIds: ["node:service"], delta: { x: 40, y: 0 },
  }, context()).state;
  const movedEdges = boardDiagramGraph(moved).edges.filter((edge) => edge.from === "node:service" || edge.to === "node:service");
  assert.ok(movedEdges.length >= 3);
  for (const edge of movedEdges) assert.equal(edge.attached, true, `${edge.id} follows the node`);
});

test("a deleted stroke becomes a deleted element, an orphan mirror loses its bridge, and a board with no legacy data is left alone", () => {
  let state = everyAnnotationTypeBoard();
  state = reduceBoardEvents(state, [{
    id: "event-delete", type: "stroke.deleted", boardSessionId: "board-1", actorParticipantId: "participant-1",
    createdAt: "2026-10-02T09:00:00.000Z", strokeIds: ["mark:pointer"],
  }]);
  // A mirror whose stroke has gone: the board already draws it as v2.
  const orphan = { ...structuredClone(state.elements["node:custom"]), id: "orphan:shape", legacyStrokeId: "orphan:shape" };
  state = { ...state, elements: { ...state.elements, "orphan:shape": orphan } };

  const result = convertLegacyBoardState(state);
  assert.equal(result.state.elements["mark:pointer"].status, "deleted");
  assert.equal(result.state.strokes["mark:pointer"], undefined);
  assert.deepEqual(result.orphanMirrorIds, ["orphan:shape"]);
  assert.equal(result.state.elements["orphan:shape"].legacyStrokeId, undefined);
  assert.deepEqual(legacyConversionGraphDiff(state, result.state), []);
  assert.deepEqual(validateConvertedBoardState(result.state), []);

  const plain = applyDiagramCommand(createInitialBoardState("board-2"), {
    type: "node.create", nodeId: "a", nodeType: "api", label: "API", center: { x: 100, y: 100 },
  }, context()).state;
  const untouched = convertLegacyBoardState(plain);
  assert.equal(untouched.changed, false);
  assert.deepEqual(untouched.state, plain);
});

test("a stored row with missing parts still converts", () => {
  const { elements: _elements, sceneVersion: _version, ...v1Row } = structuredClone(FIXTURE);
  const result = convertLegacyBoardState(v1Row);
  assert.equal(result.addedElementIds.length, 21);
  assert.deepEqual(validateConvertedBoardState(result.state), []);
  assert.deepEqual(diagram(result.state), diagram(FIXTURE));
});

test("validation reports what the API or the board would not accept", () => {
  const after = convertLegacyBoardState(FIXTURE).state;
  const broken = structuredClone(after);
  broken.elements["edge:reply"].end.binding.elementId = "missing";
  broken.elements["node:api"].kind = "unknown";
  broken.strokes["late"] = { ...FIXTURE.strokes["node:api"], id: "late" };
  const problems = validateConvertedBoardState(broken);
  assert.ok(problems.some((problem) => problem.includes("bound to missing")));
  assert.ok(problems.some((problem) => problem.includes("node:api is not a valid scene element")));
  assert.ok(problems.some((problem) => problem.includes("stroke late is still committed")));
});
