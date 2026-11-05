import assert from "node:assert/strict";
import test from "node:test";

import {
  boardPointFromScreen,
  boundsFitViewport,
  clampViewport,
  fitViewportToBounds,
  IDENTITY_VIEWPORT,
  panViewport,
  screenPointFromBoard,
  unobscuredCanvasCenter,
  zoomViewport,
} from "../src/features/board/boardViewport.ts";
import { CanvasNavigationTracker } from "../src/features/board/canvasNavigationTracker.ts";

const LIMITS = {
  minScale: 0.25,
  maxScale: 3,
  worldExtent: 2_400,
  canvasWidth: 900,
  canvasHeight: 600,
};

test("screen/board round-trip under pan and zoom", () => {
  const viewport = { x: 120, y: -40, scale: 1.5 };
  const screen = { x: 300, y: 200 };
  const board = boardPointFromScreen(viewport, screen);
  assert.deepEqual(screenPointFromBoard(viewport, board), screen);
});

test("zoom keeps the anchor point stationary on screen", () => {
  const anchor = { x: 450, y: 300 };
  const before = boardPointFromScreen(IDENTITY_VIEWPORT, anchor);
  const zoomed = zoomViewport(IDENTITY_VIEWPORT, 2, anchor, LIMITS);
  assert.equal(zoomed.scale, 2);
  const after = boardPointFromScreen(zoomed, anchor);
  assert.ok(Math.abs(after.x - before.x) < 1e-9);
  assert.ok(Math.abs(after.y - before.y) < 1e-9);
});

test("zoom clamps to the scale limits", () => {
  const maxed = zoomViewport({ x: 0, y: 0, scale: 2.9 }, 4, { x: 0, y: 0 }, LIMITS);
  assert.equal(maxed.scale, 3);
  const mined = zoomViewport({ x: 0, y: 0, scale: 0.3 }, 0.01, { x: 0, y: 0 }, LIMITS);
  assert.equal(mined.scale, 0.25);
});

test("panning is bounded: the window center cannot leave the world extent", () => {
  let viewport = IDENTITY_VIEWPORT;
  for (let i = 0; i < 100; i += 1) {
    viewport = panViewport(viewport, 500, 0, LIMITS); // shove hard rightward
  }
  const center = boardPointFromScreen(viewport, { x: 450, y: 300 });
  assert.ok(center.x >= -LIMITS.worldExtent - 1e-9, `center drifted to ${center.x}`);
  assert.equal(Math.round(center.x), -LIMITS.worldExtent);
  // clamp is idempotent
  assert.deepEqual(clampViewport(viewport, LIMITS), viewport);
});

// ---- CanvasNavigationTracker ------------------------------------------------

const open = (x, y) => ({ point: { x, y }, grabStrength: 0.1 });
const closed = (x, y) => ({ point: { x, y }, grabStrength: 0.9 });

test("two open palms moving together pan after the engage debounce", () => {
  const tracker = new CanvasNavigationTracker();
  assert.deepEqual(
    tracker.update({ hands: [open(100, 100), open(300, 100)], timestampMs: 0 }),
    { mode: "idle" },
  );
  assert.deepEqual(
    tracker.update({ hands: [open(100, 100), open(300, 100)], timestampMs: 160 }),
    { mode: "idle" },
    "engage frame itself emits no delta",
  );
  const update = tracker.update({
    hands: [open(120, 110), open(320, 110)],
    timestampMs: 200,
  });
  assert.deepEqual(update, { mode: "pan", dx: 20, dy: 10 });
  assert.equal(tracker.mode, "pan");
});

test("two closed hands spreading zoom around their midpoint", () => {
  const tracker = new CanvasNavigationTracker();
  tracker.update({ hands: [closed(400, 300), closed(500, 300)], timestampMs: 0 });
  assert.equal(
    tracker.reserving,
    true,
    "the first two-hand frame reserves input before zoom finishes debouncing",
  );
  assert.equal(tracker.engaged, false);
  tracker.update({ hands: [closed(400, 300), closed(500, 300)], timestampMs: 160 });
  const update = tracker.update({
    hands: [closed(350, 300), closed(550, 300)],
    timestampMs: 200,
  });
  assert.equal(update.mode, "zoom");
  assert.ok(Math.abs(update.factor - 2) < 1e-9, `factor ${update.factor}`);
  assert.deepEqual(update.anchor, { x: 450, y: 300 });
});

test("SEPARATION: one hand — or mixed poses — never navigates", () => {
  const tracker = new CanvasNavigationTracker();
  for (let t = 0; t <= 1_000; t += 33) {
    assert.deepEqual(tracker.update({ hands: [open(100, 100)], timestampMs: t }), {
      mode: "idle",
    });
  }
  for (let t = 1_100; t <= 2_000; t += 33) {
    assert.deepEqual(
      tracker.update({ hands: [open(100, 100), closed(300, 100)], timestampMs: t }),
      { mode: "idle" },
      "one open + one closed is ambiguous, never navigation",
    );
  }
  assert.equal(tracker.engaged, false);
  assert.equal(tracker.reserving, false);
});

test("SEPARATION: pan never morphs into zoom — pose switch releases first", () => {
  const tracker = new CanvasNavigationTracker();
  tracker.update({ hands: [open(100, 100), open(300, 100)], timestampMs: 0 });
  tracker.update({ hands: [open(100, 100), open(300, 100)], timestampMs: 160 });
  assert.equal(tracker.mode, "pan");

  // Hands close (zoom pose): the pan session freezes, then releases.
  assert.deepEqual(
    tracker.update({ hands: [closed(100, 100), closed(300, 100)], timestampMs: 200 }),
    { mode: "idle" },
  );
  assert.deepEqual(
    tracker.update({ hands: [closed(100, 100), closed(320, 100)], timestampMs: 420 }),
    { mode: "idle" },
    "past releaseMs: session released, zoom not yet engaged",
  );
  assert.equal(tracker.engaged, false);
  // Zoom then engages on its own debounce.
  tracker.update({ hands: [closed(100, 100), closed(320, 100)], timestampMs: 440 });
  tracker.update({ hands: [closed(100, 100), closed(320, 100)], timestampMs: 600 });
  assert.equal(tracker.mode, "zoom");
});

test("pose flicker freezes and rebases instead of jumping", () => {
  const tracker = new CanvasNavigationTracker();
  tracker.update({ hands: [open(100, 100), open(300, 100)], timestampMs: 0 });
  tracker.update({ hands: [open(100, 100), open(300, 100)], timestampMs: 160 });
  // One dropout frame (hand lost), well inside releaseMs.
  tracker.update({ hands: [open(100, 100)], timestampMs: 190 });
  // Pose returns far away: the first frame back only rebases…
  assert.deepEqual(
    tracker.update({ hands: [open(500, 100), open(700, 100)], timestampMs: 220 }),
    { mode: "idle" },
  );
  // …so the next movement is measured from the new position, not the old one.
  const update = tracker.update({
    hands: [open(510, 100), open(710, 100)],
    timestampMs: 250,
  });
  assert.deepEqual(update, { mode: "pan", dx: 10, dy: 0 });
});

test("fitting a diagram frames it beside the Airo panel without zooming in", () => {
  const limits = { minScale: 0.25, maxScale: 3, worldExtent: 2_400, canvasWidth: 1_200, canvasHeight: 700 };
  // A wide diagram shrinks to fit the 800px left visible by a 400px panel.
  const wide = fitViewportToBounds({ x: -600, y: -100, width: 1_200, height: 200 }, limits, { rightInset: 400 });
  assert.ok(wide.scale < 1);
  const left = screenPointFromBoard(wide, { x: -600, y: 0 });
  const right = screenPointFromBoard(wide, { x: 600, y: 0 });
  assert.ok(left.x >= 48 - 0.01 && right.x <= 800 - 48 + 0.01);
  assert.ok(Math.abs((left.x + right.x) / 2 - 400) < 0.01);
  // A small diagram keeps its natural size, centred in the visible area.
  const small = fitViewportToBounds({ x: 0, y: 0, width: 200, height: 100 }, limits, { rightInset: 400 });
  assert.equal(small.scale, 1);
  assert.deepEqual(screenPointFromBoard(small, { x: 100, y: 50 }), { x: 400, y: 350 });
});


test("a board laid out on a laptop is detected as partly off a phone screen", () => {
  const diagram = { x: 0, y: 0, width: 900, height: 300 };
  const laptop = { canvasWidth: 1_400, canvasHeight: 800 };
  const phone = { canvasWidth: 360, canvasHeight: 640 };
  assert.equal(boundsFitViewport(diagram, IDENTITY_VIEWPORT, laptop), true);
  assert.equal(boundsFitViewport(diagram, IDENTITY_VIEWPORT, phone), false);
  // A panel over the right edge hides what sits beneath it.
  assert.equal(boundsFitViewport(diagram, IDENTITY_VIEWPORT, laptop, 600), false);
  // Content above or left of the visible area counts as hidden too.
  assert.equal(boundsFitViewport({ x: -40, y: 10, width: 100, height: 100 }, IDENTITY_VIEWPORT, laptop), false);
});

test("commands place new objects in the part of the canvas the Airo panel leaves visible", () => {
  const canvas = { left: 0, top: 60, width: 1_200, height: 700 };
  assert.deepEqual(unobscuredCanvasCenter(canvas, null), { x: 600, y: 350 });
  // Side panel on a laptop: centre of the area left of it.
  assert.deepEqual(unobscuredCanvasCenter(canvas, { left: 820, top: 78, width: 360, height: 660 }), { x: 410, y: 350 });
  // Bottom sheet on a phone: centre of the area above it.
  const phone = { left: 6, top: 64, width: 363, height: 740 };
  assert.deepEqual(unobscuredCanvasCenter(phone, { left: 14, top: 344, width: 347, height: 452 }), { x: 181.5, y: 140 });
  // A panel covering nearly everything still leaves a usable quarter.
  assert.deepEqual(unobscuredCanvasCenter(canvas, { left: 20, top: 70, width: 1_180, height: 690 }), { x: 600, y: 87.5 });
});
