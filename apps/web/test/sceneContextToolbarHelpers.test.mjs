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
