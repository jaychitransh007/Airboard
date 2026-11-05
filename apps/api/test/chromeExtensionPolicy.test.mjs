import assert from "node:assert/strict";
import test from "node:test";

import {
  effectiveChromeExtensionPolicy,
  failClosedChromeExtensionPolicy,
} from "../src/chromeExtensionPolicy.ts";

test("the emergency switch removes Chrome Meet without disabling other platforms", () => {
  assert.deepEqual(effectiveChromeExtensionPolicy({
    allowed_platforms: ["standalone", "chrome_meet", "desktop"],
    camera_enabled: true,
  }, false), {
    allowed_platforms: ["standalone", "desktop"],
    camera_enabled: true,
    chrome_extension_enabled: false,
  });
  assert.deepEqual(effectiveChromeExtensionPolicy(null, false), {
    allowed_platforms: [],
    chrome_extension_enabled: false,
  });
});

test("enabled status preserves the organization policy unchanged", () => {
  const policy = { allowed_platforms: ["chrome_meet"], camera_enabled: false };
  assert.equal(effectiveChromeExtensionPolicy(policy, true), policy);
});

test("dependency failures explicitly deny every Chrome media capability", () => {
  assert.deepEqual(failClosedChromeExtensionPolicy({
    allowed_platforms: ["standalone", "chrome_meet", "desktop"],
    camera_enabled: true,
    voice_enabled: true,
    gesture_enabled: true,
  }), {
    allowed_platforms: ["standalone", "desktop"],
    camera_enabled: false,
    voice_enabled: false,
    gesture_enabled: false,
    chrome_extension_enabled: false,
  });
});
