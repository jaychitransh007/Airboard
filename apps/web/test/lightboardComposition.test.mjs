import assert from "node:assert/strict";
import test from "node:test";

import {
  CAMERA_PRESENTATION_SCRIM,
  cameraCanvasScrim,
  MAX_CAMERA_PRESENTATION_SCRIM,
  SCREEN_PRESENTATION_SCRIM,
  screenFriendlyScrim,
} from "../src/features/board/lightboardComposition.ts";

test("screen-friendly dimming lowers only overly dark global scrims", () => {
  assert.equal(screenFriendlyScrim(0.85), SCREEN_PRESENTATION_SCRIM);
  assert.equal(screenFriendlyScrim(0.4), 0.4);
  assert.equal(screenFriendlyScrim(0), 0);
  assert.equal(screenFriendlyScrim(Number.NaN), SCREEN_PRESENTATION_SCRIM);
});

test("camera dimming restores a visible dark glass canvas", () => {
  assert.equal(cameraCanvasScrim(SCREEN_PRESENTATION_SCRIM), CAMERA_PRESENTATION_SCRIM);
  assert.equal(cameraCanvasScrim(0), CAMERA_PRESENTATION_SCRIM);
  assert.equal(cameraCanvasScrim(0.65), 0.65);
  assert.equal(cameraCanvasScrim(0.85), MAX_CAMERA_PRESENTATION_SCRIM);
});
