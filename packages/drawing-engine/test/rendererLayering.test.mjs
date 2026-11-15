import assert from "node:assert/strict";
import test from "node:test";

import { nodeLabelPlacement } from "../src/renderer.ts";

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
