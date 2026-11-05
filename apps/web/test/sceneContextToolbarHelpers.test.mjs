import assert from "node:assert/strict";
import test from "node:test";

import {
  httpLinkHref,
  normalizeRotation,
  replaceRichTextPlainValue,
  richTextMarkIsActive,
  richTextPlainValue,
  toggleRichTextMark,
} from "../src/features/board/sceneContextToolbarHelpers.ts";

const document = {
  type: "doc",
  blocks: [
    {
      id: "title",
      type: "heading",
      level: 2,
      align: "center",
      runs: [{ text: "Hello", marks: { bold: true } }],
    },
  ],
};

test("plain editing retains block semantics and active marks", () => {
  const edited = replaceRichTextPlainValue(document, "First\nSecond");
  assert.equal(richTextPlainValue(edited), "First\nSecond");
  assert.equal(edited.blocks[0].type, "heading");
  assert.equal(edited.blocks[0].align, "center");
  assert.equal(edited.blocks[0].runs[0].marks.bold, true);
});

test("mark toggles apply and remove a mark across runs", () => {
  assert.equal(richTextMarkIsActive(document, "bold"), true);
  const withoutBold = toggleRichTextMark(document, "bold");
  assert.equal(richTextMarkIsActive(withoutBold, "bold"), false);
  assert.equal(richTextMarkIsActive(toggleRichTextMark(withoutBold, "italic"), "italic"), true);
});

test("rotation normalization and safe link handling are deterministic", () => {
  assert.equal(normalizeRotation(-90), 270);
  assert.equal(normalizeRotation(450), 90);
  assert.equal(httpLinkHref("javascript:alert(1)"), null);
  assert.equal(httpLinkHref("https://example.com/path"), "https://example.com/path");
});

test("the compact toolbar offers each kind's main colours as swatches", async () => {
  const { compactColorFields } = await import("../src/features/board/sceneContextToolbarHelpers.ts");
  const labels = (element) => compactColorFields(element).map((field) => `${field.label}:${field.path.join(".")}`);
  assert.deepEqual(labels({ kind: "section", style: { fill: "#dbeafe", stroke: "#60a5fa" } }), ["Fill:style.fill", "Border:style.stroke"]);
  assert.deepEqual(labels({ kind: "sticky", color: "#fde68a" }), ["Paper:color"]);
  assert.deepEqual(labels({ kind: "mind_map_node", style: { fill: "#fff", lineColor: "#999" } }), ["Fill:style.fill", "Line:style.lineColor"]);
  assert.deepEqual(labels({ kind: "table" }), []);
  assert.equal(compactColorFields({ kind: "shape", style: { fill: "#abcdef", stroke: "#123456" } })[0].value, "#abcdef");
});

test("the element toolbar floats above the selection, below it when the top is full, and inside the window", async () => {
  const { contextToolbarPosition } = await import("../src/features/board/sceneContextToolbarHelpers.ts");
  const size = { width: 300, height: 48 };
  const viewport = { width: 1000, height: 700 };
  // Room above: centred over the shape, 12px clear.
  assert.deepEqual(contextToolbarPosition({ left: 400, top: 300, right: 600, bottom: 400 }, size, viewport), { left: 350, top: 240 });
  // Shape near the top bar: the toolbar goes below it.
  assert.deepEqual(contextToolbarPosition({ left: 400, top: 90, right: 600, bottom: 200 }, size, viewport), { left: 350, top: 212 });
  // Shape at the left edge: kept 12px inside the window.
  assert.equal(contextToolbarPosition({ left: -200, top: 300, right: 0, bottom: 400 }, size, viewport).left, 12);
  // A shape filling the screen: kept clear of the bottom dock instead of off screen.
  assert.equal(contextToolbarPosition({ left: 0, top: 60, right: 1000, bottom: 900 }, size, viewport).top, 556);
});
