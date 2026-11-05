import assert from "node:assert/strict";
import test from "node:test";

import {
  blockedMediaHelp,
  browserFamily,
  deniedMediaHelp,
} from "../src/features/board/mediaPermissionHelp.ts";

const CHROME = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";
const EDGE = `${CHROME} Edg/130.0.0.0`;
const SAFARI = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15";
const IOS_CHROME = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/130.0 Mobile/15E148 Safari/604.1";
const FIREFOX = "Mozilla/5.0 (Macintosh; Intel Mac OS X 14.0; rv:131.0) Gecko/20100101 Firefox/131.0";

test("browsers are told apart by the permission controls they use", () => {
  assert.equal(browserFamily(CHROME), "chromium");
  assert.equal(browserFamily(EDGE), "chromium");
  assert.equal(browserFamily(SAFARI), "safari");
  assert.equal(browserFamily(IOS_CHROME), "safari");
  assert.equal(browserFamily(FIREFOX), "firefox");
  assert.equal(browserFamily(""), "other");
});

test("blocked help names the browser's own control and what still works", () => {
  const camera = blockedMediaHelp("camera", CHROME);
  assert.match(camera, /blocking the camera/);
  assert.match(camera, /left of the address bar, turn Camera on/);
  assert.match(camera, /still draw and type/);
  assert.doesNotMatch(camera, /localhost/);
  assert.match(blockedMediaHelp("microphone", SAFARI), /Settings for This Website, set Microphone to Allow.*still type commands/);
});

test("denied permissions are summarised together", () => {
  assert.equal(deniedMediaHelp("granted", "prompt", CHROME), null);
  assert.match(deniedMediaHelp("denied", "denied", CHROME), /blocking the camera and microphone.*turn Camera and Microphone on/);
  assert.match(deniedMediaHelp("prompt", "denied", FIREFOX), /blocking the microphone.*crossed-out icon/);
});
