import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULT_PERSON_MASK_TUNING,
  PERSON_SEGMENTER_MODEL_PATH,
  personMaskAlpha,
} from "../src/features/board/personOcclusion.ts";

test("person mask alpha is clamped and smoothly feathered", () => {
  assert.equal(personMaskAlpha(-1), 0);
  assert.equal(personMaskAlpha(DEFAULT_PERSON_MASK_TUNING.lowConfidence), 0);
  assert.equal(personMaskAlpha(0.5), 128);
  assert.equal(personMaskAlpha(DEFAULT_PERSON_MASK_TUNING.highConfidence), 255);
  assert.equal(personMaskAlpha(2), 255);
});

test("person segmentation uses the vendored landscape model", () => {
  assert.equal(
    PERSON_SEGMENTER_MODEL_PATH,
    "/vendor/mediapipe/models/selfie_segmenter_landscape.tflite",
  );
});
