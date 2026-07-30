import assert from "node:assert/strict";
import test from "node:test";

import {
  AIRBOARD_LEGACY_NON_RUNTIME_INPUTS,
  AIRBOARD_SHIPPED_INPUT_CHANNELS,
  isShippedInputChannel,
  strokeInputSourceForPointer,
} from "../src/features/board/inputCapabilities.ts";

test("the shipped channel contract includes every production input surface", () => {
  assert.deepEqual(AIRBOARD_SHIPPED_INPUT_CHANNELS, [
    "typed",
    "voice",
    "gesture",
    "pointer",
    "touchpad",
    "stylus",
    "keyboard",
    "catalog",
    "remote",
  ]);
});

test("pen pointer events remain attributable to stylus input", () => {
  assert.equal(strokeInputSourceForPointer("pen", "gesture"), "stylus");
  assert.equal(strokeInputSourceForPointer("pen", "touchpad"), "stylus");
  assert.equal(strokeInputSourceForPointer("mouse", "gesture"), "pointer");
  assert.equal(strokeInputSourceForPointer("touch", "touchpad"), "touchpad");
});

test("non-pen pointer events cannot be misattributed to stylus", () => {
  for (const pointerType of ["mouse", "touch", "", "unknown"]) {
    assert.notEqual(
      strokeInputSourceForPointer(pointerType, "gesture"),
      "stylus",
    );
    assert.notEqual(
      strokeInputSourceForPointer(pointerType, "touchpad"),
      "stylus",
    );
  }
});

test("legacy physical-marker and air-writing paths cannot silently become runtime owners", () => {
  assert.deepEqual(AIRBOARD_LEGACY_NON_RUNTIME_INPUTS, [
    "physical_marker",
    "air_writing",
  ]);
  for (const legacy of AIRBOARD_LEGACY_NON_RUNTIME_INPUTS) {
    assert.equal(isShippedInputChannel(legacy), false);
    assert.equal(AIRBOARD_SHIPPED_INPUT_CHANNELS.includes(legacy), false);
  }
});
