import assert from "node:assert/strict";
import test from "node:test";

import { boardPreview } from "../src/boardPreview.ts";

const doc = (text) => ({ type: "doc", blocks: [{ type: "paragraph", runs: [{ text }] }] });
const element = (id, kind, extra = {}) => ({
  id,
  kind,
  status: "active",
  visible: true,
  zIndex: 0,
  transform: { x: 0, y: 0, width: 100, height: 60, rotation: 0 },
  ...extra,
});

test("a board's preview outlines its shapes and arrows and collects its words", () => {
  const preview = boardPreview({
    elements: {
      api: element("api", "shape", { shapeKind: "rectangle", content: doc("API"), transform: { x: 100, y: 50, width: 120, height: 60, rotation: 0 } }),
      db: element("db", "shape", { shapeKind: "ellipse", content: doc("Database"), transform: { x: 400, y: 50, width: 80, height: 80, rotation: 0 } }),
      link: element("link", "connector", { start: { point: { x: 220, y: 80 } }, end: { point: { x: 400, y: 90 } }, label: doc("reads") }),
      note: element("note", "sticky", { content: doc("Cache later"), transform: { x: 120, y: 200, width: 100, height: 100, rotation: 0 } }),
      gone: element("gone", "shape", { status: "deleted", content: doc("Removed") }),
      hidden: element("hidden", "shape", { visible: false, content: doc("Hidden") }),
      ink: element("ink", "drawing", { points: [] }),
    },
  });
  assert.equal(preview.shapes.length, 3);
  assert.deepEqual(preview.shapes.find((shape) => shape.round), { kind: "shape", x: 400, y: 50, width: 80, height: 80, round: true });
  assert.deepEqual(preview.lines, [{ x1: 220, y1: 80, x2: 400, y2: 90 }]);
  assert.deepEqual(preview.bounds, { x: 100, y: 50, width: 380, height: 250 });
  assert.deepEqual(preview.text.sort(), ["API", "Cache later", "Database", "reads"]);
});

test("stored state that isn't a usable board gives an empty preview", () => {
  for (const state of [null, "board", 42, {}, { elements: null }, { elements: { a: null, b: { kind: "shape", transform: { x: "1" } } } }]) {
    assert.deepEqual(boardPreview(state), { bounds: null, shapes: [], lines: [], text: [] });
  }
});

test("previews stay small however large the board is", () => {
  const elements = {};
  for (let index = 0; index < 200; index += 1) {
    elements[`s${index}`] = element(`s${index}`, "shape", { zIndex: index, content: doc(`Box ${index}`), transform: { x: index * 10, y: 0, width: 10, height: 10, rotation: 0 } });
  }
  const preview = boardPreview({ elements });
  assert.equal(preview.shapes.length, 60);
  assert.equal(preview.text.length, 40);
});
