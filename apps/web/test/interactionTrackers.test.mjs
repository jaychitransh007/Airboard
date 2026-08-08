import assert from "node:assert/strict";
import test from "node:test";

import { HoldToEditTracker } from "../src/features/board/holdToEditTracker.ts";
import {
  catalogIdForDockGestureHover,
  chooseDockGestureTarget,
  DockGestureActivationTracker,
} from "../src/features/board/dockGestureActivation.ts";

const P = { x: 0.5, y: 0.4 };

test("catalog category hover maps to open without treating tools as categories", () => {
  assert.equal(catalogIdForDockGestureHover("category:flow"), "flow");
  assert.equal(catalogIdForDockGestureHover("category:system"), "system");
  assert.equal(catalogIdForDockGestureHover("category:"), null);
  assert.equal(catalogIdForDockGestureHover("tool:decision"), null);
  assert.equal(catalogIdForDockGestureHover("select"), null);
  assert.equal(catalogIdForDockGestureHover(null), null);
});

test("a category close edge never activates or consumes the tool latch", () => {
  const tracker = new DockGestureActivationTracker();
  assert.equal(tracker.update("category:flow", "closing"), null);
  assert.equal(tracker.update("category:flow", "closed"), null);
  assert.equal(
    tracker.update("tool:decision", "closed"),
    null,
    "moving a held close from category to tool cannot pick it up",
  );
  tracker.update("tool:decision", "open");
  tracker.update("tool:decision", "closing");
  assert.equal(tracker.update("tool:decision", "closed"), "tool:decision");
});

test("a tool must stay targeted from closing through closed and activates once", () => {
  const tracker = new DockGestureActivationTracker();
  assert.equal(tracker.update("tool:decision", "open"), null, "hover cannot select");
  assert.equal(tracker.update("tool:decision", "closing"), null);
  assert.equal(tracker.update("tool:process", "closed"), null, "target changed mid-close");
  tracker.update("tool:decision", "open");
  tracker.update("tool:decision", "closing");
  assert.equal(tracker.update("tool:decision", "closed"), "tool:decision");
  assert.equal(
    tracker.update("tool:process", "closed"),
    null,
    "same close cannot activate a neighboring tool",
  );
});

test("opening-to-closed jitter does not fabricate a second activation edge", () => {
  const tracker = new DockGestureActivationTracker();
  tracker.update("tool:decision", "open");
  tracker.update("tool:decision", "closing");
  assert.equal(tracker.update("tool:decision", "closed"), "tool:decision");
  assert.equal(tracker.update("tool:process", "opening"), null);
  assert.equal(tracker.update("tool:process", "closed"), null);
  tracker.update("tool:process", "open");
  tracker.update("tool:process", "closing");
  assert.equal(tracker.update("tool:process", "closed"), "tool:process");
});

test("top-level dock controls retain the stable close activation contract", () => {
  const tracker = new DockGestureActivationTracker();
  tracker.update("select", "closing");
  assert.equal(tracker.update("select", "closed"), "select");
  tracker.update("eraser", "open");
  tracker.update("eraser", "closing");
  assert.equal(tracker.update("eraser", "closed"), "eraser");
});

test("dock choose uses padded hit areas and resolves overlap by nearest center", () => {
  const targets = [
    {
      id: "flow",
      bounds: { left: 0, top: 0, width: 40, height: 40 },
    },
    {
      id: "system",
      bounds: { left: 45, top: 0, width: 40, height: 40 },
    },
  ];
  assert.equal(
    chooseDockGestureTarget({ x: 43, y: 20 }, targets, 10),
    "system",
  );
  assert.equal(
    chooseDockGestureTarget(
      { x: 20, y: 20 },
      [{ ...targets[0], disabled: true }],
      10,
    ),
    null,
  );
});

test("hold-to-edit scopes after holding an element still", () => {
  const tracker = new HoldToEditTracker();
  const grab = (x, now) => ({
    interaction: { strokeId: "s1", point: { x, y: 100 } },
    now,
    scopedActiveForStroke: false,
  });
  assert.equal(tracker.update(grab(100, 0)), null);
  assert.equal(tracker.update(grab(104, 300)), null, "within tolerance");
  assert.deepEqual(tracker.update(grab(104, 650)), { type: "scope", strokeId: "s1" });
});

test("hold-to-edit never scopes a moving drag", () => {
  const tracker = new HoldToEditTracker();
  const at = (x, now) => ({
    interaction: { strokeId: "s1", point: { x, y: 100 } },
    now,
    scopedActiveForStroke: false,
  });
  tracker.update(at(100, 0));
  tracker.update(at(140, 200)); // moved 40px — a drag
  assert.equal(tracker.update(at(140, 900)), null, "a drag stays a drag");
});

test("hold-to-edit emits released when the grab ends, and re-arms per grab", () => {
  const tracker = new HoldToEditTracker();
  const grab = (now) => ({
    interaction: { strokeId: "s2", point: { x: 50, y: 50 } },
    now,
    scopedActiveForStroke: false,
  });
  tracker.update(grab(0));
  assert.deepEqual(tracker.update(grab(700)), { type: "scope", strokeId: "s2" });
  assert.deepEqual(
    tracker.update({ interaction: null, now: 800, scopedActiveForStroke: false }),
    { type: "released" },
  );
  assert.equal(
    tracker.update({ interaction: null, now: 900, scopedActiveForStroke: false }),
    null,
    "released fires once",
  );
});

test("hold-to-edit does not re-fire while the element is already scoped", () => {
  const tracker = new HoldToEditTracker();
  const grab = (now, scoped) => ({
    interaction: { strokeId: "s3", point: { x: 10, y: 10 } },
    now,
    scopedActiveForStroke: scoped,
  });
  tracker.update(grab(0, false));
  assert.deepEqual(tracker.update(grab(700, false)), { type: "scope", strokeId: "s3" });
  assert.equal(tracker.update(grab(1_400, true)), null);
});
