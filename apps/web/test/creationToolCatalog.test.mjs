import assert from "node:assert/strict";
import test from "node:test";
import {
  ADVANCED_SHAPES,
  AIRBOARD_SHAPES,
  ALL_SHAPES,
  BASIC_SHAPES,
  FIGJAM_SHAPES,
  FLOWCHART_SHAPES,
  legacyToolForCreationTool,
  resolveCreationShortcut,
} from "../src/features/board/creationToolCatalog.ts";

test("the shape catalog includes every in-scope FigJam shape and Airboard extra", () => {
  assert.equal(BASIC_SHAPES.length, 14);
  assert.equal(FLOWCHART_SHAPES.length, 16);
  assert.equal(ADVANCED_SHAPES.length, 26);
  assert.equal(FIGJAM_SHAPES.length, 56);
  assert.equal(AIRBOARD_SHAPES.length, 4);
  assert.equal(ALL_SHAPES.length, 60);
  assert.equal(new Set(ALL_SHAPES.map((shape) => shape.id)).size, ALL_SHAPES.length);
});

test("canonical shapes retain their legacy placement aliases", () => {
  assert.equal(legacyToolForCreationTool("shape:basic-square"), "box");
  assert.equal(legacyToolForCreationTool("shape:basic-ellipse"), "circle");
  assert.equal(legacyToolForCreationTool("shape:basic-diamond"), "decision");
  assert.equal(legacyToolForCreationTool("shape:flowchart-right-parallelogram"), "io");
  assert.equal(legacyToolForCreationTool("shape:flowchart-document"), "document");
  assert.equal(legacyToolForCreationTool("shape:advanced-service"), "service");
  assert.equal(legacyToolForCreationTool("shape:airboard-api"), "api");
  assert.equal(legacyToolForCreationTool("connector:bent"), "connector");
  assert.equal(legacyToolForCreationTool("connector:straight"), "arrow");
});

test("FigJam creation shortcuts resolve without stealing modified browser shortcuts", () => {
  assert.equal(resolveCreationShortcut({ key: "v" }), "move");
  assert.equal(resolveCreationShortcut({ key: "h" }), "hand");
  assert.equal(resolveCreationShortcut({ key: "m" }), "draw:marker");
  assert.equal(resolveCreationShortcut({ key: "M", shiftKey: true }), "draw:highlighter");
  assert.equal(resolveCreationShortcut({ key: "s" }), "sticky");
  assert.equal(resolveCreationShortcut({ key: "S", shiftKey: true }), "section");
  assert.equal(resolveCreationShortcut({ key: "T", shiftKey: true }), "table");
  assert.equal(resolveCreationShortcut({ key: "Delete", shiftKey: true }), "draw:eraser");
  assert.equal(
    resolveCreationShortcut({ key: "K", shiftKey: true, metaKey: true }),
    "insert:media",
  );
  assert.equal(resolveCreationShortcut({ key: "z", metaKey: true }), null);
  assert.equal(resolveCreationShortcut({ key: "m", altKey: true }), null);
});
