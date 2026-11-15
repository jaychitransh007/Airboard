import assert from "node:assert/strict";
import test from "node:test";

import {
  boardImageSources,
  fetchSharedBoard,
  sharedBoardBounds,
  sharedBoardState,
  sharedImageSources,
} from "../src/features/share/sharedBoard.ts";

const ASSET = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

function element(overrides) {
  return { id: "e", kind: "shape", status: "active", transform: { x: 0, y: 0, width: 10, height: 10 }, ...overrides };
}

test("a shared board keeps its content and never members or cursors", () => {
  const state = sharedBoardState({
    elements: { a: element({ id: "a" }) },
    strokes: {},
    participants: { p: { displayName: "Priya" } },
    cursors: { p: { x: 1, y: 1 } },
    activeStrokes: { s: {} },
  });
  assert.deepEqual(Object.keys(state.elements), ["a"]);
  assert.deepEqual(state.participants, {});
  assert.deepEqual(state.cursors, {});
  assert.deepEqual(state.activeStrokes, {});
  assert.equal("strokes" in state, false, "the API's empty strokes key is dropped");
});

test("fit frames every object, but not deleted ones", () => {
  const state = sharedBoardState({
    elements: {
      a: element({ id: "a", transform: { x: 100, y: 50, width: 200, height: 80 } }),
      ink: element({ id: "ink", kind: "drawing", transform: { x: 20, y: 400, width: 580, height: 10 } }),
      gone: element({ id: "gone", status: "deleted", transform: { x: -5000, y: -5000, width: 10, height: 10 } }),
    },
  });
  assert.deepEqual(sharedBoardBounds(state), { x: 20, y: 50, width: 580, height: 360 });
  assert.equal(sharedBoardBounds(sharedBoardState({})), null);
});

test("a board saved with legacy strokes is converted on read and framed whole", () => {
  const stroke = (id, status, points, annotation) => ({
    id,
    boardId: "b",
    userId: "u",
    color: "#111",
    thickness: 3,
    status,
    points: points.map((point, t) => ({ ...point, t })),
    createdAt: "2026-01-01T00:00:00.000Z",
    ...(annotation ? { annotation } : {}),
  });
  const saved = {
    elements: { a: element({ id: "a", transform: { x: 100, y: 50, width: 200, height: 80 } }) },
    strokes: {
      ink: stroke("ink", "committed", [{ x: 20, y: 400 }, { x: 600, y: 410 }]),
      erased: stroke("erased", "deleted", [{ x: 9000, y: 9000 }]),
      node: stroke("node", "committed", [{ x: 700, y: 100 }], {
        type: "flow_node",
        source: "voice",
        confidence: 1,
        nodeType: "service",
        label: "Billing",
        bounds: { x: 700, y: 100, width: 160, height: 80 },
      }),
    },
  };
  const state = sharedBoardState(saved);
  assert.equal("strokes" in state, false);
  assert.equal(state.elements.ink.kind, "drawing");
  assert.equal(state.elements.node.kind, "shape");
  assert.equal(state.elements.erased.status, "deleted");
  assert.equal(JSON.stringify(state.elements).includes("legacyStroke"), false, "no bridge fields remain");
  assert.deepEqual(sharedBoardBounds(state), { x: 20, y: 50, width: 840, height: 360 });
  assert.deepEqual(sharedBoardState(saved), state, "conversion on read is deterministic");
});

test("pictures load through the link, under every key the renderer uses", () => {
  const url = `/boards/b/assets/${ASSET}/content`;
  const state = sharedBoardState({
    elements: {
      m: element({ id: "m", kind: "media", mediaKind: "image", asset: { id: ASSET, url } }),
    },
  });
  const [source] = sharedImageSources(state, "TOKEN");
  assert.match(source.url, new RegExp(`/shared-boards/TOKEN/assets/${ASSET}/content$`));
  assert.deepEqual(source.aliases, [ASSET, url]);
});

test("an unavailable link reads as null; other failures throw", async () => {
  const reply = (status, body = {}) => async () => new Response(JSON.stringify(body), { status });
  assert.equal(await fetchSharedBoard("t", reply(404)), null);
  await assert.rejects(() => fetchSharedBoard("t", reply(503)), /SHARED_BOARD_503/);
  const board = await fetchSharedBoard("t", reply(200, { title: "Plan", state: { elements: {} } }));
  assert.equal(board.title, "Plan");
});

test("a member's view-only board loads its pictures from the members-only route", () => {
  const state = sharedBoardState({
    elements: {
      photo: element({ id: "photo", kind: "media", mediaKind: "image", asset: { id: ASSET, url: `/boards/b/assets/${ASSET}/content` } }),
    },
  });
  assert.deepEqual(boardImageSources(state, (assetId) => `https://api.airboard.test/boards/b/assets/${assetId}/content`), [
    { url: `https://api.airboard.test/boards/b/assets/${ASSET}/content`, aliases: [ASSET, `/boards/b/assets/${ASSET}/content`] },
  ]);
});
