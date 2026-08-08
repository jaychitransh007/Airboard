import assert from "node:assert/strict";
import test from "node:test";
import {
  applyOverlayWindowCapabilities,
  buildOverlayUrl,
  createOverlayWindowOptions,
  moveOverlayToDisplay,
} from "../src/overlayWindow.mjs";

test("buildOverlayUrl preserves the configured route and enables desktop mode", () => {
  assert.equal(
    buildOverlayUrl("https://airboard.example/board?session=abc"),
    "https://airboard.example/board?session=abc&desktopOverlay=1",
  );
  assert.throws(() => buildOverlayUrl("file:///tmp/index.html"), /http or https/);
});

test("createOverlayWindowOptions produces a transparent frameless display-sized window", () => {
  const options = createOverlayWindowOptions(
    { bounds: { x: -1440, y: 0, width: 1440, height: 900 } },
    "/app/preload.mjs",
  );
  assert.deepEqual(
    { x: options.x, y: options.y, width: options.width, height: options.height },
    { x: -1440, y: 0, width: 1440, height: 900 },
  );
  assert.equal(options.transparent, true);
  assert.equal(options.frame, false);
  assert.equal(options.backgroundColor, "#00000000");
  assert.equal(options.focusable, false);
  assert.equal(options.skipTaskbar, true);
  assert.equal(options.webPreferences.contextIsolation, true);
  assert.equal(options.webPreferences.nodeIntegration, false);
  assert.equal(options.webPreferences.sandbox, true);
});

test("applyOverlayWindowCapabilities makes the native surface topmost and click-through", () => {
  const calls = [];
  const window = {
    setAlwaysOnTop: (...args) => calls.push(["always", ...args]),
    setVisibleOnAllWorkspaces: (...args) => calls.push(["workspaces", ...args]),
    setIgnoreMouseEvents: (...args) => calls.push(["ignore", ...args]),
    setFocusable: (...args) => calls.push(["focusable", ...args]),
  };
  applyOverlayWindowCapabilities(window, { clickThrough: true, platform: "darwin" });
  assert.deepEqual(calls, [
    ["always", true, "screen-saver"],
    [
      "workspaces",
      true,
      { visibleOnFullScreen: true, skipTransformProcessType: true },
    ],
    ["ignore", true, { forward: true }],
    ["focusable", false],
  ]);
});

test("pointer-control mode stops passing clicks to the app below", () => {
  const calls = [];
  const window = {
    setAlwaysOnTop: (...args) => calls.push(["always", ...args]),
    setIgnoreMouseEvents: (...args) => calls.push(["ignore", ...args]),
    setFocusable: (...args) => calls.push(["focusable", ...args]),
  };
  applyOverlayWindowCapabilities(window, { clickThrough: false, platform: "win32" });
  assert.deepEqual(calls, [
    ["always", true, "pop-up-menu"],
    ["ignore", false, { forward: false }],
    ["focusable", true],
  ]);
});

test("moveOverlayToDisplay applies exact OS display bounds", () => {
  let applied = null;
  moveOverlayToDisplay(
    { setBounds: (bounds, animate) => (applied = { bounds, animate }) },
    { bounds: { x: 100, y: -900, width: 1600, height: 900 } },
  );
  assert.deepEqual(applied, {
    bounds: { x: 100, y: -900, width: 1600, height: 900 },
    animate: false,
  });
});
