import assert from "node:assert/strict";
import test from "node:test";

import { boardCardDetail, boardMatchesQuery, previewViewBox } from "../src/features/product/boardLibrary.ts";

const board = {
  title: "Checkout flow",
  updated_at: "2026-11-05T10:00:00Z",
  visibility: "private",
  preview: { bounds: { x: 0, y: 0, width: 200, height: 100 }, shapes: [], lines: [], text: ["Payments API", "Fraud check"] },
};

test("library search matches titles and the words on a board", () => {
  assert.equal(boardMatchesQuery(board, "checkout"), true);
  assert.equal(boardMatchesQuery(board, "fraud"), true);
  assert.equal(boardMatchesQuery(board, "  PAYMENTS "), true);
  assert.equal(boardMatchesQuery(board, "inventory"), false);
  assert.equal(boardMatchesQuery(board, ""), true);
  assert.equal(boardMatchesQuery({ ...board, preview: undefined }, "fraud"), false);
});

test("cards say when a board changed and who can open it, not internal versions", () => {
  const now = new Date("2026-11-05T10:05:00Z");
  assert.match(boardCardDetail(board, now), /^Updated 5 minutes ago · Only you$/);
  assert.match(boardCardDetail({ ...board, visibility: "organization" }, new Date("2026-11-05T10:00:20Z")), /^Updated just now · Shared$/);
  assert.match(boardCardDetail(board, new Date("2026-11-20T10:00:00Z")), /^Updated \d+ Nov · Only you$|^Updated Nov \d+ · Only you$/);
});

test("previews are framed with a little padding around the content", () => {
  assert.equal(previewViewBox({ x: 0, y: 0, width: 200, height: 100 }), "-16 -16 232 132");
  // A single point still gets a visible frame.
  assert.equal(previewViewBox({ x: 5, y: 5, width: 0, height: 0 }), "4.9 4.9 1.2 1.2");
});
