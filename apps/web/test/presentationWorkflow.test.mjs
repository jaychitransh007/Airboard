import assert from "node:assert/strict";
import test from "node:test";

import {
  SCREEN_PRESENTATION_SCRIM,
  assessPresentationReadiness,
  screenFriendlyScrim,
} from "../src/features/board/presentationWorkflow.ts";

test("screen presentations require the live composite and local contrast", () => {
  const result = assessPresentationReadiness({
    theme: "lightboard",
    source: "screen",
    canvasReady: true,
    screenReady: true,
    cameraReady: false,
    localContrastPlates: true,
  });
  assert.equal(result.ready, true);

  const withoutScreen = assessPresentationReadiness({
    theme: "lightboard",
    source: "screen",
    canvasReady: true,
    screenReady: false,
    cameraReady: false,
    localContrastPlates: true,
  });
  assert.equal(withoutScreen.ready, false);
  assert.equal(withoutScreen.checks.find((check) => check.id === "source")?.passed, false);
});

test("camera and dark-canvas sources use their own readiness requirements", () => {
  assert.equal(
    assessPresentationReadiness({
      theme: "lightboard",
      source: "camera",
      canvasReady: true,
      screenReady: false,
      cameraReady: true,
      localContrastPlates: false,
    }).ready,
    true,
  );
  assert.equal(
    assessPresentationReadiness({
      theme: "lightboard",
      source: "dark",
      canvasReady: true,
      screenReady: false,
      cameraReady: false,
      localContrastPlates: false,
    }).ready,
    true,
  );
});

test("unfinished previews and the classic theme block clean output", () => {
  const result = assessPresentationReadiness({
    theme: "classic",
    source: "dark",
    canvasReady: true,
    screenReady: false,
    cameraReady: false,
    localContrastPlates: false,
    pendingPreview: true,
  });
  assert.equal(result.ready, false);
  assert.deepEqual(
    result.checks.filter((check) => !check.passed).map((check) => check.id),
    ["theme", "preview"],
  );
});

test("screen-friendly dimming lowers only overly dark global scrims", () => {
  assert.equal(screenFriendlyScrim(0.85), SCREEN_PRESENTATION_SCRIM);
  assert.equal(screenFriendlyScrim(0.4), 0.4);
  assert.equal(screenFriendlyScrim(0), 0);
});
