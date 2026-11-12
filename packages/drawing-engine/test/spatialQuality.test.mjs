import assert from "node:assert/strict";
import test from "node:test";

import {
  applyBoardEvent,
  applyLegacyDiagramFixture,
  createBoardSceneElement,
  createEventEnvelope,
  createInitialBoardState,
  createRichTextDocument,
} from "@airboard/core";

import {
  analyzeBoardSpatialQuality,
  diagramSpatialConstraintErrors,
  inspectBoardSpatialQuality,
} from "../src/spatialQuality.ts";

function node(id, bounds, label = id) {
  return {
    id,
    boardId: "board",
    userId: "user",
    tool: "marker",
    color: "#111111",
    thickness: 3,
    points: [],
    createdAt: "2026-07-30T00:00:00.000Z",
    updatedAt: "2026-07-30T00:00:00.000Z",
    status: "committed",
    annotation: {
      type: "flow_node",
      source: "voice",
      nodeType: "service",
      label,
      bounds,
    },
  };
}

function connector(
  id,
  fromId,
  toId,
  start,
  end,
  label = id,
) {
  return {
    id,
    boardId: "board",
    userId: "user",
    tool: "marker",
    color: "#111111",
    thickness: 3,
    points: [],
    createdAt: "2026-07-30T00:00:00.000Z",
    updatedAt: "2026-07-30T00:00:00.000Z",
    status: "committed",
    annotation: {
      type: "connector",
      source: "voice",
      label,
      start,
      end,
      snappedStartStrokeId: fromId,
      snappedEndStrokeId: toId,
    },
  };
}

function board(...strokes) {
  return {
    boardId: "board",
    strokes: Object.fromEntries(strokes.map((stroke) => [stroke.id, stroke])),
    activeStrokes: {},
    eraseActions: {},
    participants: {},
    cursors: {},
    lastSequence: 0,
  };
}

const CRITICAL_SPATIAL_CONSTRAINTS = {
  minimumNodeGap: 24,
  forbidNodeOverlap: true,
  forbidConnectorThroughUnrelatedNodes: true,
  forbidCollinearConnectorOverlap: true,
  maximumCollinearConnectorOverlap: 0,
  forbidConnectorLabelNodeOverlap: true,
  forbidConnectorLabelOverlap: true,
};

test("passes a separated single-edge flow", () => {
  const result = analyzeBoardSpatialQuality(
    board(
      node("user", { x: 0, y: 0, width: 100, height: 80 }),
      node("service", { x: 320, y: 0, width: 120, height: 80 }),
      connector(
        "request",
        "user",
        "service",
        { x: 100, y: 40 },
        { x: 320, y: 40 },
        "request",
      ),
    ),
    CRITICAL_SPATIAL_CONSTRAINTS,
  );

  assert.equal(result.pass, true, JSON.stringify(result.violations));
  assert.deepEqual(result.violations, []);
});

test("detects pairwise overlap and insufficient node clearance", () => {
  const result = analyzeBoardSpatialQuality(
    board(
      node("first", { x: 0, y: 0, width: 100, height: 80 }),
      node("overlapping", { x: 80, y: 10, width: 100, height: 80 }),
      node("too-close", { x: 195, y: 10, width: 100, height: 80 }),
    ),
    { minimumNodeGap: 24, forbidNodeOverlap: true },
  );

  assert.deepEqual(
    new Set(result.violations.map(({ kind }) => kind)),
    new Set(["node_overlap", "node_clearance"]),
  );
  assert.ok(
    result.violations.some(
      ({ kind, objectIds }) =>
        kind === "node_overlap" &&
        objectIds.includes("first") &&
        objectIds.includes("overlapping"),
    ),
  );
});

test("detects a connector crossing an unrelated node", () => {
  const result = analyzeBoardSpatialQuality(
    board(
      node("source", { x: 0, y: 0, width: 100, height: 80 }),
      node("blocker", { x: 180, y: 0, width: 100, height: 80 }),
      node("target", { x: 360, y: 0, width: 100, height: 80 }),
      connector(
        "crossing",
        "source",
        "target",
        { x: 100, y: 40 },
        { x: 360, y: 40 },
        "lands on",
      ),
    ),
    { forbidConnectorThroughUnrelatedNodes: true },
  );

  assert.deepEqual(
    result.violations.map(({ kind, objectIds }) => ({ kind, objectIds })),
    [{
      kind: "connector_through_node",
      objectIds: ["crossing", "blocker"],
    }],
  );
});

test("detects reciprocal collinear routes and duplicate label placement", () => {
  const result = analyzeBoardSpatialQuality(
    board(
      node("user", { x: 0, y: 0, width: 100, height: 80 }),
      node("auth", { x: 300, y: 0, width: 120, height: 80 }),
      connector(
        "request",
        "user",
        "auth",
        { x: 100, y: 40 },
        { x: 300, y: 40 },
        "request",
      ),
      connector(
        "authenticates",
        "auth",
        "user",
        { x: 300, y: 40 },
        { x: 100, y: 40 },
        "authenticates",
      ),
    ),
    {
      forbidCollinearConnectorOverlap: true,
      maximumCollinearConnectorOverlap: 0,
      forbidConnectorLabelOverlap: true,
    },
  );

  assert.ok(
    result.violations.some(
      ({ kind, measured }) =>
        kind === "collinear_connector_overlap" && measured === 200,
    ),
  );
  assert.ok(
    result.violations.some(({ kind }) => kind === "connector_label_overlap"),
  );
});

test("detects a connector label whose rendered anchor sits inside a node", () => {
  const state = board(
    node("source", { x: 0, y: 0, width: 100, height: 80 }),
    node("blocker", { x: 170, y: 0, width: 100, height: 80 }),
    node("target", { x: 340, y: 0, width: 100, height: 80 }),
    connector(
      "long-edge",
      "source",
      "target",
      { x: 100, y: 40 },
      { x: 340, y: 40 },
      "lands on",
    ),
  );
  const facts = inspectBoardSpatialQuality(state);
  assert.deepEqual(facts.connectorLabelNodeIntersections, [
    { connectorId: "long-edge", nodeId: "blocker" },
  ]);

  const result = analyzeBoardSpatialQuality(state, {
    forbidConnectorLabelNodeOverlap: true,
  });
  assert.equal(result.pass, false);
  assert.equal(
    result.violations[0]?.kind,
    "connector_label_node_overlap",
  );
});

test("shares strict spatial-constraint validation across eval corpora", () => {
  assert.deepEqual(
    diagramSpatialConstraintErrors(CRITICAL_SPATIAL_CONSTRAINTS),
    [],
  );
  assert.deepEqual(
    diagramSpatialConstraintErrors({
      minimumNodeGap: -1,
      inventedRule: true,
    }),
    [
      "minimumNodeGap must be a finite non-negative number",
      "contains unsupported key inventedRule",
    ],
  );
});

// The scorer reads the model-independent diagram graph, so v2 scene elements
// are scored like legacy strokes, and a legacy node's scene mirror is not
// counted twice.

function withElement(state, element) {
  return applyBoardEvent(state, {
    ...createEventEnvelope({ boardSessionId: "board", actorParticipantId: "participant" }),
    type: "element.created",
    element: createBoardSceneElement({ boardId: "board", ...element }),
  });
}

function sceneNode(state, id, bounds, label = id) {
  return withElement(state, {
    id,
    kind: "shape",
    shapeKind: "service",
    transform: { ...bounds, rotation: 0 },
    content: createRichTextDocument(label, `${id}:content`),
  });
}

function sceneConnector(state, id, fromId, toId, start, end, label = id) {
  return withElement(state, {
    id,
    kind: "connector",
    pathKind: "straight",
    start: { point: start, binding: { elementId: fromId, anchor: "auto" }, decoration: "none" },
    end: { point: end, binding: { elementId: toId, anchor: "auto" }, decoration: "solid_arrow" },
    label: createRichTextDocument(label, `${id}:label`),
  });
}

const SOURCE = { x: 0, y: 0, width: 100, height: 80 };
const BLOCKER = { x: 180, y: 0, width: 100, height: 80 };
const TARGET = { x: 360, y: 0, width: 100, height: 80 };
const CLOSE = { x: 470, y: 0, width: 100, height: 80 };

// A v2 label is placed as the v2 renderer draws it (a box on the line, or
// beside it), not as the legacy renderer did, so its box is compared apart.
function geometryOf(facts) {
  return {
    nodes: facts.nodes,
    connectors: facts.connectors.map(({ labelBounds, labelOnLine, ...connector }) => connector),
    nodePairs: facts.nodePairs,
    connectorNodeIntersections: facts.connectorNodeIntersections,
  };
}

test("the same diagram as legacy strokes or as v2 elements scores the same", () => {
  const legacy = board(
    node("source", SOURCE, "Source"),
    node("blocker", BLOCKER, "Blocker"),
    node("target", TARGET, "Target"),
    node("close", CLOSE, "Close"),
    connector("crossing", "source", "target", { x: 100, y: 40 }, { x: 360, y: 40 }, "lands on"),
  );
  let scene = createInitialBoardState("board");
  scene = sceneNode(scene, "source", SOURCE, "Source");
  scene = sceneNode(scene, "blocker", BLOCKER, "Blocker");
  scene = sceneNode(scene, "target", TARGET, "Target");
  scene = sceneNode(scene, "close", CLOSE, "Close");
  scene = sceneConnector(scene, "crossing", "source", "target", { x: 100, y: 40 }, { x: 360, y: 40 }, "lands on");

  const constraints = { ...CRITICAL_SPATIAL_CONSTRAINTS, forbidConnectorLabelEdgeOverlap: true };
  const fromStrokes = analyzeBoardSpatialQuality(legacy, constraints);
  const fromScene = analyzeBoardSpatialQuality(scene, constraints);
  assert.deepEqual(geometryOf(fromScene.facts), geometryOf(fromStrokes.facts));
  // The legacy label sits on the blocker; the v2 label slides along the line
  // into the clear gap past it. Every other finding is the same.
  const aside = (violations) => violations.filter(({ kind }) => kind !== "connector_label_node_overlap");
  assert.deepEqual(aside(fromScene.violations), aside(fromStrokes.violations));
  assert.deepEqual(
    new Set(fromStrokes.violations.map(({ kind }) => kind)),
    new Set(["connector_through_node", "node_clearance", "connector_label_node_overlap"]),
  );
  assert.deepEqual(fromScene.facts.connectorLabelNodeIntersections, []);
});

test("a mixed board scores legacy and v2 objects together, each once", () => {
  let state = createInitialBoardState("board");
  // A node on a board saved before Airo drew v2 shapes.
  state = applyLegacyDiagramFixture(state, {
    type: "node.create",
    nodeId: "legacy",
    nodeType: "service",
    label: "Legacy",
    bounds: { x: 0, y: 0, width: 100, height: 80 },
    source: "voice",
  }, {
    boardSessionId: "board",
    actorParticipantId: "participant",
    userId: "user",
    createdAt: "2026-11-12T00:00:00.000Z",
    eventIdFactory: (() => { let count = 0; return () => `event-${++count}`; })(),
  }).state;
  assert.equal(state.elements.legacy?.legacyStrokeId, "legacy", "the legacy node has a scene mirror");
  state = sceneNode(state, "typed", { x: 60, y: 10, width: 100, height: 80 }, "Typed");
  state = withElement(state, {
    id: "caption",
    kind: "text",
    transform: { x: 0, y: 0, width: 200, height: 30, rotation: 0 },
    content: createRichTextDocument("A caption over both", "caption:content"),
  });

  const facts = inspectBoardSpatialQuality(state);
  assert.deepEqual(facts.nodes.map(({ id }) => id), ["legacy", "typed"], "no mirror copy, no text mark");
  const result = analyzeBoardSpatialQuality(state, { forbidNodeOverlap: true });
  assert.deepEqual(
    result.violations.map(({ kind, objectIds }) => ({ kind, objectIds })),
    [{ kind: "node_overlap", objectIds: ["legacy", "typed"] }],
  );
});

test("a v2 bent connector is traced along their rendered route", () => {
  let state = createInitialBoardState("board");
  state = sceneNode(state, "a", { x: 0, y: 0, width: 100, height: 80 });
  state = sceneNode(state, "b", { x: 400, y: 300, width: 100, height: 80 });
  state = sceneNode(state, "corner", { x: 400, y: 0, width: 100, height: 80 });
  state = withElement(state, {
    id: "bent",
    kind: "connector",
    pathKind: "bent",
    start: { point: { x: 100, y: 40 }, binding: { elementId: "a" }, decoration: "none" },
    end: { point: { x: 450, y: 300 }, binding: { elementId: "b" }, decoration: "solid_arrow" },
    controlPoints: [{ x: 450, y: 40 }],
  });
  const facts = inspectBoardSpatialQuality(state);
  const bent = facts.connectors.find(({ id }) => id === "bent");
  assert.deepEqual(bent.route, [{ x: 100, y: 40 }, { x: 450, y: 40 }, { x: 450, y: 300 }]);
  assert.deepEqual(facts.connectorNodeIntersections, [{ connectorId: "bent", nodeId: "corner" }]);
});

test("a v2 connector in a side lane is scored along that lane", () => {
  let state = createInitialBoardState("board");
  state = sceneNode(state, "a", { x: 0, y: 0, width: 100, height: 80 });
  state = sceneNode(state, "b", { x: 400, y: 0, width: 100, height: 80 });
  state = withElement(state, {
    id: "lane",
    kind: "connector",
    pathKind: "bent",
    start: { point: { x: 100, y: 40 }, binding: { elementId: "a" }, decoration: "none" },
    end: { point: { x: 400, y: 40 }, binding: { elementId: "b" }, decoration: "solid_arrow" },
    routeOffset: 72,
  });
  const lane = inspectBoardSpatialQuality(state).connectors.find(({ id }) => id === "lane");
  assert.deepEqual(lane.route, [{ x: 100, y: 40 }, { x: 100, y: 112 }, { x: 400, y: 112 }, { x: 400, y: 40 }]);
});
