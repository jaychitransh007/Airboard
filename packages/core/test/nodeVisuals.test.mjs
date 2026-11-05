import assert from "node:assert/strict";
import test from "node:test";

import {
  AIRBOARD_SEMANTIC_NODE_CAPABILITIES,
  nodeVisualContainsPoint,
  nodeVisualDefaultSize,
  nodeVisualKind,
  pointOnNodeBoundary,
} from "../dist/index.js";

test("every semantic node has one canonical visual and default size", () => {
  const kinds = new Set();
  for (const capability of AIRBOARD_SEMANTIC_NODE_CAPABILITIES) {
    assert.equal(nodeVisualKind(capability.nodeType), capability.visual.kind);
    assert.deepEqual(
      nodeVisualDefaultSize(capability.nodeType),
      capability.visual.defaultSize,
    );
    assert.ok(capability.visual.defaultSize.width > 0);
    assert.ok(capability.visual.defaultSize.height > 0);
    kinds.add(capability.visual.kind);
  }
  assert.equal(kinds.size, AIRBOARD_SEMANTIC_NODE_CAPABILITIES.length);
});

test("shape-aware boundaries terminate connectors on visible geometry", () => {
  const bounds = { x: 0, y: 0, width: 120, height: 80 };
  assert.deepEqual(pointOnNodeBoundary(bounds, "process", { x: 300, y: 40 }), {
    x: 120,
    y: 40,
  });
  const diamond = pointOnNodeBoundary(bounds, "decision", { x: 300, y: 0 });
  assert.ok(diamond.x < 120);
  assert.ok(diamond.y >= 0);
  const circle = pointOnNodeBoundary(bounds, "circle", { x: 300, y: 0 });
  assert.ok(circle.x < 120);
  assert.ok(circle.y >= 0);
});

test("transparent shape corners are not selectable", () => {
  const bounds = { x: 0, y: 0, width: 120, height: 80 };
  assert.equal(nodeVisualContainsPoint(bounds, "process", { x: 2, y: 2 }), true);
  assert.equal(nodeVisualContainsPoint(bounds, "decision", { x: 2, y: 2 }), false);
  assert.equal(nodeVisualContainsPoint(bounds, "circle", { x: 2, y: 2 }), false);
  assert.equal(nodeVisualContainsPoint(bounds, "io", { x: 2, y: 2 }), false);
});
