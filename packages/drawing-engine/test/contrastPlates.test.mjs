import assert from "node:assert/strict";
import test from "node:test";

import { calculateContrastPlates } from "../src/renderer.ts";

function stroke(id, type, bounds, extra = {}) {
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
    status: "committed",
    annotation: { type, source: "keyboard", bounds, ...extra },
  };
}

function state(strokes) {
  return { boardId: "board", strokes: Object.fromEntries(strokes.map((item) => [item.id, item])), activeStrokes: {}, cursors: {} };
}

test("nearby diagram nodes merge into a cluster while distant nodes remain local", () => {
  const plates = calculateContrastPlates(
    state([
      stroke("a", "flow_node", { x: 100, y: 100, width: 100, height: 60 }),
      stroke("b", "rectangle", { x: 225, y: 105, width: 90, height: 55 }),
      stroke("c", "sticky_note", { x: 700, y: 400, width: 120, height: 80 }),
    ]),
    { padding: 10, mergeGap: 15 },
  );
  assert.equal(plates.length, 2);
  assert.deepEqual(plates[0], { x: 90, y: 90, width: 235, height: 80 });
});

test("connectors, highlights, containers, and deleted objects do not create plates", () => {
  const deleted = stroke("deleted", "flow_node", { x: 0, y: 0, width: 80, height: 40 });
  deleted.status = "deleted";
  const plates = calculateContrastPlates(
    state([
      stroke("connector", "connector", { x: 0, y: 0, width: 500, height: 10 }),
      stroke("highlight", "highlight", { x: 0, y: 0, width: 500, height: 80 }),
      stroke("group", "rectangle", { x: 0, y: 0, width: 500, height: 500 }, { groupMemberStrokeIds: ["member"] }),
      deleted,
    ]),
  );
  assert.deepEqual(plates, []);
});
