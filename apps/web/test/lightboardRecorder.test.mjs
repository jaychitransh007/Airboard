import assert from "node:assert/strict";
import test from "node:test";

import {
  coverRect,
  recordingDimensions,
  recordingFileName,
} from "../src/features/board/lightboardRecorder.ts";

test("recording dimensions keep aspect, cap width, and stay even", () => {
  assert.deepEqual(recordingDimensions(2880, 1620, 1920), { width: 1920, height: 1080 });
  assert.deepEqual(recordingDimensions(1280, 720, 1920), { width: 1280, height: 720 });
  // Odd source dimensions floor to even (encoder requirement).
  assert.deepEqual(recordingDimensions(1281, 721, 1920), { width: 1280, height: 720 });
  // Degenerate canvases never produce a zero-size recording.
  assert.deepEqual(recordingDimensions(0, 0, 1920), { width: 2, height: 2 });
});

test("cover geometry fills the target and centers the overflow", () => {
  // Wide video into a squarer target: width overflows, centered horizontally.
  const wide = coverRect(1600, 900, 1000, 800);
  assert.equal(wide.height, 800);
  assert.ok(wide.width > 1000);
  assert.ok(Math.abs(wide.x - (1000 - wide.width) / 2) < 1e-9);
  assert.equal(wide.y, 0);

  // Matching aspect maps exactly.
  assert.deepEqual(coverRect(1280, 720, 640, 360), { x: 0, y: 0, width: 640, height: 360 });
});

test("recording file names are sortable and second-precise", () => {
  const name = recordingFileName(new Date(2026, 6, 18, 9, 5, 7));
  assert.equal(name, "airboard-lightboard-20260718-090507.webm");
});
