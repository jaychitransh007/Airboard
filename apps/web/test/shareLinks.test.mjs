import assert from "node:assert/strict";
import test from "node:test";

import {
  guestDisplayName,
  liveBoardLink,
  liveJoinFailure,
  liveStartFailure,
  liveLinkFromBoardAddress,
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
});
