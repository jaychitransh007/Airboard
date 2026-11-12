import assert from "node:assert/strict";
import test from "node:test";

import { createBoardSceneElement } from "@airboard/core";
import { calculateContrastPlates } from "../src/renderer.ts";

const now = "2026-01-01T00:00:00.000Z";

function element(kind, id, bounds, extra = {}) {
  return createBoardSceneElement({
    id,
    boardId: "board",
    kind,
    createdAt: now,
    updatedAt: now,
    transform: { ...bounds, rotation: 0 },
    ...extra,
  });
}

function state(elements) {
  return {
    boardId: "board",
    sceneVersion: 3,
    elements: Object.fromEntries(elements.map((item) => [item.id, item])),
    activeStrokes: {},
    eraseActions: {},
    participants: {},
    cursors: {},
    lastSequence: 0,
  };
}

test("nearby diagram nodes merge into a cluster while distant nodes remain local", () => {
  const plates = calculateContrastPlates(
    state([
      element("shape", "a", { x: 100, y: 100, width: 100, height: 60 }, { shapeKind: "rounded-rectangle" }),
      element("shape", "b", { x: 225, y: 105, width: 90, height: 55 }, { shapeKind: "square" }),
      element("sticky", "c", { x: 700, y: 400, width: 120, height: 80 }),
    ]),
    { padding: 10, mergeGap: 15 },
  );
  assert.equal(plates.length, 2);
  assert.deepEqual(plates[0], { x: 90, y: 90, width: 235, height: 80 });
  assert.deepEqual(plates[1], { x: 690, y: 390, width: 140, height: 100 });
});

test("connectors, drawings, hidden, empty and deleted objects do not create plates", () => {
  const plates = calculateContrastPlates(
    state([
      element("connector", "connector", { x: 0, y: 0, width: 500, height: 10 }, {
        start: { point: { x: 0, y: 0 }, decoration: "none" },
        end: { point: { x: 500, y: 10 }, decoration: "line_arrow" },
      }),
      element("drawing", "drawing", { x: 0, y: 0, width: 500, height: 80 }, {
        points: [{ x: 0, y: 0, t: 0 }, { x: 500, y: 80, t: 1 }],
      }),
      element("shape", "hidden", { x: 0, y: 0, width: 80, height: 40 }, { shapeKind: "square", visible: false }),
      element("shape", "empty", { x: 0, y: 0, width: 0, height: 40 }, { shapeKind: "square" }),
      element("shape", "deleted", { x: 0, y: 0, width: 80, height: 40 }, { shapeKind: "square", status: "deleted" }),
    ]),
  );
  assert.deepEqual(plates, []);
});
