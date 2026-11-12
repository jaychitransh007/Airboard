import assert from "node:assert/strict";
import test from "node:test";

import {
  applyBoardEvent,
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

// The scorer reads the board's diagram graph: shapes are nodes, connectors
// are edges, and text marks don't take part.

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

function node(id, bounds, label = id) {
  return (state) => sceneNode(state, id, bounds, label);
}

function connector(id, fromId, toId, start, end, label = id) {
  return (state) => sceneConnector(state, id, fromId, toId, start, end, label);
}

function board(...steps) {
  return steps.reduce((state, step) => step(state), createInitialBoardState("board"));
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

test("detects a connector label that has no clear gap and sits on a node", () => {
  // The blocker fills the line between the two ends, so the label slides as
  // far as it can and still lands on the blocker (and the target's edge).
  const state = board(
    node("source", { x: 0, y: 0, width: 100, height: 80 }),
    node("blocker", { x: 120, y: 0, width: 200, height: 80 }),
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
    { connectorId: "long-edge", nodeId: "target" },
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
