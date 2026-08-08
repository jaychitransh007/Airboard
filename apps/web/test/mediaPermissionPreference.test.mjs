import assert from "node:assert/strict";
import test from "node:test";

import {
  mediaPermissionLabel,
  mediaResumeEnabled,
  queryMediaPermission,
  setMediaResumeEnabled,
  shouldResumeMedia,
} from "../src/features/board/mediaPermissionPreference.ts";

function memoryStorage() {
  const values = new Map();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
  };
}

test("media resume intent persists independently for microphone and camera", () => {
  const storage = memoryStorage();
  setMediaResumeEnabled("microphone", true, storage);
  assert.equal(mediaResumeEnabled("microphone", storage), true);
  assert.equal(mediaResumeEnabled("camera", storage), false);
  setMediaResumeEnabled("microphone", false, storage);
  assert.equal(mediaResumeEnabled("microphone", storage), false);
});

test("automatic resume requires both remembered intent and an existing browser grant", () => {
  assert.equal(shouldResumeMedia("granted", true), true);
  assert.equal(shouldResumeMedia("granted", false), false);
  assert.equal(shouldResumeMedia("prompt", true), false);
  assert.equal(shouldResumeMedia("denied", true), false);
  assert.equal(shouldResumeMedia("unsupported", true), false);
});

test("permission queries fail closed without creating a browser prompt", async () => {
  assert.equal(await queryMediaPermission("microphone", undefined), "unsupported");
  assert.equal(
    await queryMediaPermission("camera", {
      query: async () => ({ state: "granted" }),
    }),
    "granted",
  );
  assert.equal(
    await queryMediaPermission("camera", {
      query: async () => {
        throw new Error("descriptor unsupported");
      },
    }),
    "unsupported",
  );
});

test("permission labels stay plain and actionable", () => {
  assert.equal(mediaPermissionLabel("granted"), "Allowed");
  assert.equal(mediaPermissionLabel("prompt"), "Ask once");
  assert.equal(mediaPermissionLabel("denied"), "Blocked");
  assert.equal(mediaPermissionLabel("unsupported"), "Browser managed");
});
