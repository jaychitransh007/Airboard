import assert from "node:assert/strict";
import test from "node:test";

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
