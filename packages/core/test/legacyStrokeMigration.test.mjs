import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import {
  applyBoardEvent,
  applyDiagramCommand,
  BOARD_SCENE_VERSION,
  boardDiagramGraph,
  boardHasLegacyData,
  convertLegacyBoardState,
  createBoardSceneElement,
  createEventEnvelope,
  createInitialBoardState,
  createRichTextDocument,
  isBoardSceneElement,
  LEGACY_BOARD_EVENT_TYPES,
  legacyAnnotationStrokeIds,
  legacyConversionGraphDiff,
  reduceBoardEvents,
  replayBoardEvents,
  upgradeLegacyBoardState,
  validateConvertedBoardState,
} from "../src/index.ts";

/**
 * The conversion of saved boards from legacy annotation strokes to v2 scene
 * elements (shape-merge phase 2, and on load since phase 3), and the replay
 * of stored legacy event rows. The diagram a board shows must not change
 * (boardDiagramGraph before equals after, apart from model fields), the
 * result must pass what the API and the board accept, and converting twice
 * must change nothing.
 *
 * Nothing writes the legacy model any more, so the legacy boards and event
 * logs below are frozen JSON captured from the pre-phase-3 code
 * (test/fixtures/): legacy-annotations.board.json (the board the e2e suite
 * used), legacy-boards.json (every annotation type, a mixed board, a deleted
 * stroke with an orphan mirror, and the diagram boardDiagramGraph tested in
 * both models) and legacy-event-replay.json (stored rows, with what the old
 * reducer made of them, converted).
 */

const readFixture = (name) => JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8"));
const FIXTURE = readFixture("legacy-annotations.board.json");
const BOARDS = readFixture("legacy-boards.json");
const REPLAY = readFixture("legacy-event-replay.json");

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

/** Every legacy annotation type on one board, as they were made (frozen). */
const everyAnnotationTypeBoard = () => structuredClone(BOARDS.everyAnnotationType);

/**
 * The diagram by id, without the model fields that are meant to change. (The
 * legacy boards' own diagrams, as the pre-phase-3 graph read them, are frozen
 * in BOARDS.diagramsBefore.)
 */
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
  assert.deepEqual(result.droppedStrokeIds, []);
  assert.equal("strokes" in result.state, false, "the converted board has no strokes key");
  assert.equal(Object.keys(result.state.elements).length, 21);
  assert.deepEqual(diagram(result.state), BOARDS.diagramsBefore.legacyAnnotations);
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
  assert.deepEqual(withoutInkMarks(BOARDS.diagramsBefore.everyAnnotationType, inkMarks), diagram(after));
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
  // v2 objects drawn since phase 1, one arrow bound to a legacy node.
  const state = structuredClone(BOARDS.mixed);
  const v2Before = Object.fromEntries(["v2:cache", "v2:to-cache", "v2:group"].map((id) => [id, state.elements[id]]));

  const result = convertLegacyBoardState(state);
  const after = result.state;
  for (const [id, element] of Object.entries(v2Before)) {
    assert.deepEqual(after.elements[id], element, `${id} is untouched`);
  }
  assert.deepEqual(withoutInkMarks(BOARDS.diagramsBefore.mixed, ["mark:cross", "mark:freehand"]), diagram(after));
  assertConvertedCleanly(state, after);
  const minV2 = Math.min(...Object.values(v2Before).map((element) => element.zIndex));
  for (const id of result.addedElementIds) {
    assert.ok(after.elements[id].zIndex < minV2, `${id} is drawn under the v2 objects, as strokes were`);
  }

  // Old and new shapes now group together (refused before conversion).
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
  // mark:pointer was deleted, and orphan:shape is a mirror whose stroke has
  // gone (the board already draws it as v2).
  const state = structuredClone(BOARDS.pointerDeleted);

  const result = convertLegacyBoardState(state);
  assert.equal(result.state.elements["mark:pointer"].status, "deleted");
  assert.equal("strokes" in result.state, false);
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
  assert.deepEqual(diagram(result.state), BOARDS.diagramsBefore.legacyAnnotations);
});

test("validation reports what the API or the board would not accept", () => {
  const after = convertLegacyBoardState(FIXTURE).state;
  const broken = structuredClone(after);
  broken.elements["edge:reply"].end.binding.elementId = "missing";
  broken.elements["node:api"].kind = "unknown";
  broken.strokes = { late: { ...FIXTURE.strokes["node:api"], id: "late" } };
  const problems = validateConvertedBoardState(broken);
  assert.ok(problems.some((problem) => problem.includes("bound to missing")));
  assert.ok(problems.some((problem) => problem.includes("node:api is not a valid scene element")));
  assert.ok(problems.some((problem) => problem.includes("stroke late is still committed")));
});

test("a stroke still being drawn when the board was saved is dropped", () => {
  const before = structuredClone(FIXTURE);
  before.strokes["ink:unfinished"] = { ...structuredClone(FIXTURE.strokes["node:api"]), id: "ink:unfinished", status: "active" };
  const result = convertLegacyBoardState(before);
  assert.deepEqual(result.droppedStrokeIds, ["ink:unfinished"]);
  assert.equal(result.state.elements["ink:unfinished"], undefined);
  assert.equal(result.addedElementIds.length, 21);
  assert.equal("strokes" in result.state, false);
  // Only an unfinished stroke left: still a change (the key goes).
  const onlyUnfinished = convertLegacyBoardState({ ...createInitialBoardState("board-1"), strokes: { "ink:unfinished": before.strokes["ink:unfinished"] } });
  assert.equal(onlyUnfinished.changed, true);
  assert.deepEqual(onlyUnfinished.droppedStrokeIds, ["ink:unfinished"]);
  assert.deepEqual(onlyUnfinished.state.elements, {});
});

/** What should not depend on the model: names, types, boxes, links, labels, groups. */
function projection(graph) {
  const byId = (left, right) => left.id.localeCompare(right.id);
  return {
    nodes: graph.nodes.map(({ id, label, name, kind, role, bounds, groupIds }) =>
      ({ id, label, name, kind, role, bounds, groupIds: [...groupIds].sort() })).sort(byId),
    edges: graph.edges.map(({ id, from, to, label, directed, lineStyle, attached }) =>
      ({ id, from, to, label, directed, lineStyle, attached })).sort(byId),
    groups: graph.groups.map(({ id, label, memberIds }) => ({ id, label, memberIds: [...memberIds].sort() })).sort(byId),
  };
}

test("the same diagram drawn in either model gives the same graph once converted", () => {
  // The v2 twin of BOARDS.graphLegacy: the same boxes, labels, arrows and group.
  const BOXES = {
    user: { x: 100, y: 100, width: 160, height: 92 },
    api: { x: 400, y: 100, width: 180, height: 92 },
    db: { x: 700, y: 100, width: 160, height: 92 },
  };
  const LABELS = { user: "Customer", api: "Orders API", db: "Orders DB" };
  const TYPES = { user: "user", api: "api", db: "database" };
  let scene = createInitialBoardState("board-1");
  for (const id of ["user", "api", "db"]) {
    scene = applyBoardEvent(scene, {
      ...createEventEnvelope({ boardSessionId: "board-1", actorParticipantId: "participant-1" }),
      type: "element.created",
      element: createBoardSceneElement({
        boardId: "board-1", id, kind: "shape", shapeKind: TYPES[id],
        transform: { ...BOXES[id], rotation: 0 },
        content: createRichTextDocument(LABELS[id], `${id}:content`),
      }),
    });
  }
  scene = applyDiagramCommand(scene, { type: "scene.connect", connectorId: "e1", fromId: "user", toId: "api", label: "places order" }, context()).state;
  scene = applyDiagramCommand(scene, { type: "scene.connect", connectorId: "e2", fromId: "api", toId: "db", label: "writes" }, context()).state;
  scene = applyDiagramCommand(scene, { type: "scene.group", sectionId: "g1", memberIds: ["api", "db"], label: "Backend" }, context()).state;

  const legacy = structuredClone(BOARDS.graphLegacy);
  const converted = convertLegacyBoardState(legacy).state;
  assert.deepEqual(legacyConversionGraphDiff(legacy, converted), []);
  assert.deepEqual(projection(boardDiagramGraph(converted)), projection(boardDiagramGraph(scene)));
});

test("upgradeLegacyBoardState converts on load, drops any strokes key and is idempotent", () => {
  const upgraded = upgradeLegacyBoardState(structuredClone(FIXTURE));
  assert.deepEqual(upgraded, convertLegacyBoardState(FIXTURE).state);
  assert.equal("strokes" in upgraded, false);
  assert.deepEqual(upgradeLegacyBoardState(upgraded), upgraded, "a second load changes nothing");

  // Orphan mirrors lose their bridge field.
  const withOrphan = upgradeLegacyBoardState(structuredClone(BOARDS.pointerDeleted));
  assert.ok(Object.values(withOrphan.elements).every((element) => element.legacyStrokeId === undefined));
  assert.equal(withOrphan.elements["orphan:shape"].kind, "shape");

  // A v2 board served with the API's compatibility `strokes: {}` loses only that key.
  const v2 = applyDiagramCommand(createInitialBoardState("board-2"), {
    type: "node.create", nodeId: "a", nodeType: "api", label: "API", center: { x: 100, y: 100 },
  }, context()).state;
  assert.deepEqual(upgradeLegacyBoardState({ strokes: {}, ...v2 }), v2);
  // Parts missing on very old rows are filled.
  const sparse = upgradeLegacyBoardState({ boardId: "board-3" });
  assert.deepEqual(sparse, createInitialBoardState("board-3"));
});

test("stored legacy event rows replay into the board the old reducer made, converted", () => {
  assert.equal(LEGACY_BOARD_EVENT_TYPES.length, 8);
  for (const scenario of REPLAY.scenarios) {
    const state = replayBoardEvents(scenario.initial, scenario.events);
    // Captured under scene version 2; the version is the one expected difference.
    assert.deepEqual(state, { ...scenario.expected, sceneVersion: BOARD_SCENE_VERSION }, scenario.name);
    assert.equal("strokes" in state, false);
    assert.equal(state.lastSequence, scenario.events.at(-1).sequence, "lastSequence is preserved");
    assert.deepEqual(validateConvertedBoardState(state), [], scenario.name);
  }
  const [first] = REPLAY.scenarios;
  const state = replayBoardEvents(first.initial, first.events);
  // A stroke.deleted naming a v2 element deletes it, as the old reducer did.
  assert.equal(state.elements["v2:a"].status, "deleted");
  // Edits, deletes and restores of strokes carry through.
  assert.equal(state.elements.s1.content.blocks[0].runs[0].text, "Orders API");
  assert.equal(state.elements.s2.transform.x, 420);
  assert.equal(state.elements.c1.status, "active");
  assert.equal(state.elements.ink1.kind, "drawing");
  assert.equal(state.elements.ink1.status, "deleted");
  assert.ok(state.eraseActions["erase-1"]);
  // In-progress and discarded strokes are left out.
  assert.equal(state.elements["ink-unfinished"], undefined);
  assert.equal(state.elements["ink-discarded"], undefined);
  assert.deepEqual(state.activeStrokes, {});
});

test("a log with no legacy rows replays exactly as the reducer reduces it", () => {
  const [first] = REPLAY.scenarios;
  const current = first.events.filter((event) => !LEGACY_BOARD_EVENT_TYPES.includes(event.type));
  assert.ok(current.length > 0);
  assert.deepEqual(replayBoardEvents(first.initial, current), reduceBoardEvents(first.initial, current));
  assert.deepEqual(replayBoardEvents(first.initial, []), first.initial);
});

test("element rows naming a converted stroke after its stroke rows land on the converted element", () => {
  const [first] = REPLAY.scenarios;
  const strokeRows = first.events.filter((event) =>
    (event.type === "stroke.started" && event.stroke.id === "s1") ||
    (event.type === "stroke.committed" && event.strokeId === "s1"));
  assert.equal(strokeRows.length, 2);
  const last = strokeRows.at(-1);
  const row = (sequence, extra) => ({ ...last, id: `row-x${sequence}`, sequence: last.sequence + sequence, ...extra });
  const patch = row(1, {
    type: "element.patched",
    elementId: "s1",
    patches: [{ op: "field.set", path: ["transform", "x"], value: 500 }],
  });
  const remove = row(2, { type: "element.deleted", elementId: "s1" });
  for (const key of ["strokeId", "points", "discard"]) {
    delete patch[key];
    delete remove[key];
  }

  const strokesOnly = replayBoardEvents(first.initial, strokeRows);
  const patched = replayBoardEvents(first.initial, [...strokeRows, patch]);
  assert.equal(patched.elements.s1.transform.x, 500, "a later patch is not dropped");
  assert.deepEqual(patched, reduceBoardEvents(strokesOnly, [patch]));

  const deleted = replayBoardEvents(first.initial, [...strokeRows, patch, remove]);
  assert.equal(deleted.elements.s1.status, "deleted", "a later delete is not undone");
  assert.equal(deleted.elements.s1.transform.x, 500);
  assert.deepEqual(deleted, reduceBoardEvents(strokesOnly, [patch, remove]));
  assert.deepEqual(validateConvertedBoardState(deleted), []);
});
