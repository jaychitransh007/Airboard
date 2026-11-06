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
});

test("fit frames every shape and stroke, but not deleted ones", () => {
  const state = sharedBoardState({
    elements: {
      a: element({ id: "a", transform: { x: 100, y: 50, width: 200, height: 80 } }),
      gone: element({ id: "gone", status: "deleted", transform: { x: -5000, y: -5000, width: 10, height: 10 } }),
    },
    strokes: {
      s: { id: "s", status: "committed", points: [{ x: 20, y: 400 }, { x: 600, y: 410 }] },
      erased: { id: "erased", status: "deleted", points: [{ x: 9000, y: 9000 }] },
    },
  });
  assert.deepEqual(sharedBoardBounds(state), { x: 20, y: 50, width: 580, height: 360 });
  assert.equal(sharedBoardBounds(sharedBoardState({})), null);
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
