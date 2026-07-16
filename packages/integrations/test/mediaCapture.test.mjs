import assert from "node:assert/strict";
import test from "node:test";

import { resolveMediaCaptureCapability } from "../src/mediaCapture.ts";

const policy = (allowed) => ({
  allowsFeature: (feature) => allowed.includes(feature),
});

test("top-level pages (standalone) always capture embedded", () => {
  assert.equal(
    resolveMediaCaptureCapability({ isTopLevel: true, policy: null }),
    "embedded",
  );
});

test("a frame with camera and microphone delegated captures embedded", () => {
  assert.equal(
    resolveMediaCaptureCapability({
      isTopLevel: false,
      policy: policy(["camera", "microphone"]),
    }),
    "embedded",
  );
});

test("partial or missing delegation falls back to the companion window", () => {
  for (const allowed of [[], ["camera"], ["microphone"]]) {
    assert.equal(
      resolveMediaCaptureCapability({ isTopLevel: false, policy: policy(allowed) }),
      "companion-only",
      `delegated: ${JSON.stringify(allowed)}`,
    );
  }
});

test("an absent or broken policy API never claims embedded capture", () => {
  const throwing = {
    allowsFeature: () => {
      throw new Error("unsupported feature");
    },
  };
  for (const badPolicy of [null, undefined, {}, throwing]) {
    assert.equal(
      resolveMediaCaptureCapability({ isTopLevel: false, policy: badPolicy }),
      "companion-only",
    );
  }
});
