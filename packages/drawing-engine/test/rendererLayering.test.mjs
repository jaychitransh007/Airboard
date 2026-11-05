import assert from "node:assert/strict";
import test from "node:test";

import {
  nodeLabelPlacement,
  orderCommittedStrokesForRender,
} from "../src/renderer.ts";

function stroke(id, annotationType, status = "committed") {
  return {
    id,
    boardId: "board",
    userId: "user",
    tool: "marker",
    color: "#fff",
    thickness: 3,
    points: [],
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    status,
    ...(annotationType
      ? { annotation: { type: annotationType, source: "keyboard" } }
      : {}),
  };
}

test("committed connectors render behind nodes with stable order inside each layer", () => {
  const ordered = orderCommittedStrokesForRender([
    stroke("node-a", "flow_node"),
    stroke("connector-a", "connector"),
    stroke("freehand", null),
    stroke("arrow-a", "arrow"),
    stroke("node-b", "flow_node"),
    stroke("deleted-connector", "connector", "deleted"),
    stroke("active-connector", "connector", "active"),
    stroke("connector-b", "connector"),
  ]);

  assert.deepEqual(
    ordered.map(({ id }) => id),
    [
      "connector-a",
      "arrow-a",
      "connector-b",
      "node-a",
      "freehand",
      "node-b",
      "deleted-connector",
      "active-connector",
    ],
  );
});

test("queue labels occupy the undecorated lower lane instead of the center divider", () => {
  const bounds = { x: 100, y: 200, width: 152, height: 82 };
  const placement = nodeLabelPlacement(bounds, "queue");
  const gap = 8;
  const laneHeight = (bounds.height - gap) / 2;
  const lowerLaneTop = bounds.y + laneHeight + gap;
  const lowerLaneBottom = bounds.y + bounds.height;

  assert.deepEqual(placement, {
    centerX: 180,
    centerY: 263.5,
    maxWidth: 124,
  });
  assert.ok(placement.centerY > lowerLaneTop);
  assert.ok(placement.centerY < lowerLaneBottom);
  assert.notEqual(placement.centerY, bounds.y + bounds.height / 2);
});

test("non-queue label anchors remain unchanged", () => {
  const bounds = { x: 20, y: 30, width: 144, height: 72 };

  assert.deepEqual(nodeLabelPlacement(bounds, "service"), {
    centerX: 92,
    centerY: 66,
    maxWidth: 124,
  });
  assert.deepEqual(nodeLabelPlacement(bounds, "actor"), {
    centerX: 92,
    centerY: 93.36,
    maxWidth: 138,
  });
});
