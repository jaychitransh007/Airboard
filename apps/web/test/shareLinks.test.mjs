import assert from "node:assert/strict";
import test from "node:test";

import {
  forgetLiveSession,
  guestDisplayName,
  liveBoardLink,
  liveJoinFailure,
  liveStartFailure,
  liveLinkFromBoardAddress,
  rememberedLiveSession,
  rememberLiveSession,
  savedBoardLink,
} from "../src/features/board/shareLinks.ts";

test("a live link opens the guest join page with the session's join token", () => {
  assert.equal(
    liveBoardLink("https://airboard.app", "session-1", "a.b+c/d"),
    "https://airboard.app/live/session-1?joinToken=a.b%2Bc%2Fd",
  );
  assert.equal(savedBoardLink("https://airboard.app", "board-1"), "https://airboard.app/app/boards/board-1");
});

test("guest names are trimmed and never blank", () => {
  assert.equal(guestDisplayName("  Priya   R  "), "Priya R");
  assert.equal(guestDisplayName(""), "Guest");
  assert.equal(guestDisplayName(null), "Guest");
  assert.equal(guestDisplayName("x".repeat(80)).length, 40);
});

test("join failures map to the next step a guest can take", () => {
  assert.equal(liveJoinFailure("Board session join failed: VALID_JOIN_TOKEN_REQUIRED"), "expired");
  assert.equal(liveJoinFailure("Board session join failed: SESSION_NOT_JOINABLE"), "ended");
  assert.equal(liveJoinFailure("Board session join failed: HTTP_404"), "ended");
  assert.equal(liveJoinFailure("Failed to fetch"), "offline");
  assert.equal(liveJoinFailure(undefined), "offline");
  // During a short upgrade the API refuses the join with MAINTENANCE.
  assert.equal(liveJoinFailure("Board session join failed: MAINTENANCE"), "maintenance");
  assert.equal(liveJoinFailure("Board session join failed: EXTERNAL_GUESTS_DISABLED"), "members_only");
});

test("a board address carrying a live session falls back to the live route", () => {
  assert.equal(
    liveLinkFromBoardAddress("https://airboard.app", "?boardSessionId=s-1&joinToken=t-1"),
    "https://airboard.app/live/s-1?joinToken=t-1",
  );
  assert.equal(liveLinkFromBoardAddress("https://airboard.app", "?boardSessionId=s-1"), null);
  assert.equal(liveLinkFromBoardAddress("https://airboard.app", ""), null);
});

test("a host whose pilot ended is told so instead of blaming the live server", () => {
  assert.equal(liveStartFailure("Board session start failed: OWNER_ENTITLEMENT_REQUIRED"), "pilot_ended");
  assert.equal(liveStartFailure("Board session start failed: BOARD_ACCESS_DENIED"), "offline");
  assert.equal(liveStartFailure("Failed to fetch"), "offline");
  assert.equal(liveStartFailure(undefined), "offline");
  assert.equal(liveStartFailure("Board session start failed: MAINTENANCE"), "maintenance");
});

test("a saved board's live session is remembered per tab, never in the address", () => {
  const store = new Map();
  const previous = globalThis.window;
  globalThis.window = {
    sessionStorage: {
      getItem: (key) => store.get(key) ?? null,
      setItem: (key, value) => store.set(key, String(value)),
      removeItem: (key) => store.delete(key),
    },
  };
  try {
    assert.equal(rememberedLiveSession("board-1"), null);
    rememberLiveSession("board-1", { boardSessionId: "session-1", joinToken: "token-1" });
    assert.deepEqual(rememberedLiveSession("board-1"), { boardSessionId: "session-1", joinToken: "token-1" });
    assert.equal(rememberedLiveSession("board-2"), null, "each board remembers its own");
    store.set("airboard.liveSession.board-3", "{not json");
    assert.equal(rememberedLiveSession("board-3"), null, "unreadable memory counts as none");
    forgetLiveSession("board-1");
    assert.equal(rememberedLiveSession("board-1"), null);

    // Blocked storage (some private windows) never breaks the board.
    globalThis.window = { get sessionStorage() { throw new Error("SecurityError"); } };
    rememberLiveSession("board-1", { boardSessionId: "session-1", joinToken: "token-1" });
    assert.equal(rememberedLiveSession("board-1"), null);
    forgetLiveSession("board-1");
  } finally {
    globalThis.window = previous;
  }
});
