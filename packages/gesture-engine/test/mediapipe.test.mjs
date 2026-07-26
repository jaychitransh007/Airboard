import assert from "node:assert/strict";
import test from "node:test";

import { normalizeMediaPipeCannedGesture } from "../src/mediapipe.ts";

test("normalizes only the two MediaPipe labels mapped to Airboard actions", () => {
  assert.deepEqual(
    normalizeMediaPipeCannedGesture({ categoryName: "Victory", score: 0.91 }),
    { name: "Victory", score: 0.91 },
  );
  assert.deepEqual(
    normalizeMediaPipeCannedGesture({ categoryName: "Open_Palm", score: 0.88 }),
    { name: "Open_Palm", score: 0.88 },
  );
  assert.equal(
    normalizeMediaPipeCannedGesture({ categoryName: "Closed_Fist", score: 0.99 }),
    null,
  );
  assert.equal(
    normalizeMediaPipeCannedGesture({ categoryName: "None", score: 0.99 }),
    null,
  );
});

test("clamps classifier confidence and rejects malformed categories", () => {
  assert.deepEqual(
    normalizeMediaPipeCannedGesture({ categoryName: "Victory", score: 4 }),
    { name: "Victory", score: 1 },
  );
  assert.deepEqual(
    normalizeMediaPipeCannedGesture({ categoryName: "Open_Palm", score: -1 }),
    { name: "Open_Palm", score: 0 },
  );
  assert.equal(normalizeMediaPipeCannedGesture(null), null);
  assert.equal(normalizeMediaPipeCannedGesture({ score: 0.9 }), null);
});
