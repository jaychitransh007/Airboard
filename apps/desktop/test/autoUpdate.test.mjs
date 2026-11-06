import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";
import {
  autoUpdatePolicy,
  createUpdateLog,
  startAutoUpdates,
  UPDATE_CHECK_INTERVAL_MS,
} from "../src/autoUpdate.mjs";

const installed = { isPackaged: true, argv: ["Airboard"], env: {}, platform: "darwin" };

test("only installed macOS and Windows builds look for updates", () => {
  assert.deepEqual(autoUpdatePolicy(installed), { enabled: true, reason: "installed build" });
  assert.equal(autoUpdatePolicy({ ...installed, platform: "win32" }).enabled, true);
  assert.deepEqual(autoUpdatePolicy({ ...installed, isPackaged: false }), {
    enabled: false,
    reason: "development build",
  });
  assert.deepEqual(autoUpdatePolicy({ ...installed, argv: ["Airboard", "--smoke-test"] }), {
    enabled: false,
    reason: "smoke test",
  });
  assert.equal(autoUpdatePolicy({ ...installed, platform: "linux" }).enabled, false);
});

test("AIRBOARD_DESKTOP_AUTO_UPDATE turns updates off", () => {
  for (const value of ["0", "false", "OFF", " no "]) {
    assert.equal(
      autoUpdatePolicy({ ...installed, env: { AIRBOARD_DESKTOP_AUTO_UPDATE: value } }).enabled,
      false,
      value,
    );
  }
  assert.equal(autoUpdatePolicy({ ...installed, env: { AIRBOARD_DESKTOP_AUTO_UPDATE: "on" } }).enabled, true);
});

function fakeUpdater(checkForUpdates) {
  const updater = new EventEmitter();
  updater.checks = 0;
  updater.checkForUpdates = () => {
    updater.checks += 1;
    return checkForUpdates();
  };
  return updater;
}

function recordingLog() {
  const lines = [];
  return {
    lines,
    info: (message) => lines.push(["info", message]),
    warn: (message) => lines.push(["warn", message]),
    error: (message) => lines.push(["error", message]),
    debug: () => {},
  };
}

test("an installed build checks at start and on a timer, downloads, and installs on quit", () => {
  const updater = fakeUpdater(() => Promise.resolve(null));
  const scheduled = [];
  const cancelled = [];
  const stop = startAutoUpdates({
    updater,
    policy: { enabled: true, reason: "installed build" },
    log: recordingLog(),
    schedule: (callback, ms) => {
      scheduled.push({ callback, ms });
      return "timer";
    },
    cancel: (timer) => cancelled.push(timer),
  });
  assert.equal(updater.checks, 1);
  assert.equal(updater.autoDownload, true);
  assert.equal(updater.autoInstallOnAppQuit, true);
  assert.equal(scheduled.length, 1);
  assert.equal(scheduled[0].ms, UPDATE_CHECK_INTERVAL_MS);
  scheduled[0].callback();
  assert.equal(updater.checks, 2);
  stop();
  assert.deepEqual(cancelled, ["timer"]);
});

test("failed checks are logged, never thrown", async () => {
  const log = recordingLog();
  const rejecting = fakeUpdater(() => Promise.reject(new Error("offline")));
  startAutoUpdates({ updater: rejecting, policy: { enabled: true }, log, schedule: () => null, cancel: () => {} });
  // The updater's own error event has a listener, so emitting it can't crash the app.
  rejecting.emit("error", new Error("bad signature"));
  const throwing = fakeUpdater(() => {
    throw new Error("no feed");
  });
  assert.doesNotThrow(() =>
    startAutoUpdates({ updater: throwing, policy: { enabled: true }, log, schedule: () => null, cancel: () => {} }),
  );
  await new Promise((resolve) => setImmediate(resolve));
  const warnings = log.lines.filter(([level]) => level === "warn").map(([, message]) => message);
  assert.deepEqual(warnings.sort(), [
    "Update check failed: no feed",
    "Update check failed: offline",
    "Update failed: bad signature",
  ]);
});

test("with updates off nothing is checked, and the reason is logged", () => {
  const log = recordingLog();
  const updater = fakeUpdater(() => Promise.resolve(null));
  startAutoUpdates({ updater, policy: { enabled: false, reason: "smoke test" }, log });
  assert.equal(updater.checks, 0);
  assert.deepEqual(log.lines, [["info", "Automatic updates are off: smoke test."]]);
});

test("the update log appends lines to its file and survives a write failure", async () => {
  const written = [];
  const log = createUpdateLog({
    filePath: "/logs/updates.log",
    appendFile: async (file, text) => written.push([file, text]),
    now: () => new Date("2026-11-07T10:00:00.000Z"),
  });
  const quiet = { log: console.log, warn: console.warn };
  console.log = () => {};
  console.warn = () => {};
  try {
    log.info("checking");
    createUpdateLog({ filePath: "/logs/updates.log", appendFile: async () => { throw new Error("disk full"); } }).warn("x");
    await new Promise((resolve) => setImmediate(resolve));
  } finally {
    Object.assign(console, quiet);
  }
  assert.deepEqual(written, [["/logs/updates.log", "2026-11-07T10:00:00.000Z INFO checking\n"]]);
});
