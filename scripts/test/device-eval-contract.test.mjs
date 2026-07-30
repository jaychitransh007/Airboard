import assert from "node:assert/strict";
import {
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import test from "node:test";

import {
  MEET_ATTESTATION_SCHEMA_VERSION,
  validateDeviceEvalContract,
  validateMeetStationAttestation,
} from "../lib/device-eval-contract.mjs";

const NOW = Date.parse("2026-07-30T10:00:00.000Z");
const ROOT = resolve(import.meta.dirname, "../..");

test("real-device contract requires physical-device bindings and fresh Meet evidence", async (t) => {
  const directory = await mkdtemp(
    resolve(tmpdir(), "airboard-device-attestation-"),
  );
  t.after(() => rm(directory, { recursive: true, force: true }));
  const path = resolve(directory, "meet-attestation.json");
  await writeFile(path, `${JSON.stringify(attestation())}\n`);

  const result = validateDeviceEvalContract({
    env: environment(path),
    platform: "darwin",
    nowMs: NOW,
    repositoryRoot: ROOT,
  });

  assert.equal(result.valid, true);
  assert.deepEqual(result.failures, []);
  assert.deepEqual(result.attestation, {
    schemaVersion: MEET_ATTESTATION_SCHEMA_VERSION,
    receiverVerified: true,
    rawMediaRetained: false,
  });
});

test("device tier explicitly owns a no-fake browser smoke and weekly/manual workflow policy", async () => {
  const [spec, config, suite, workflow, schemaText] = await Promise.all([
    readFile(resolve(ROOT, "apps/web/e2e/realDeviceMedia.spec.ts"), "utf8"),
    readFile(resolve(ROOT, "apps/web/playwright.config.ts"), "utf8"),
    readFile(resolve(ROOT, "scripts/run-eval-suite.mjs"), "utf8"),
    readFile(resolve(ROOT, ".github/workflows/device-evals.yml"), "utf8"),
    readFile(
      resolve(
        ROOT,
        "evals/schema/meet-station-attestation.v1.schema.json",
      ),
      "utf8",
    ),
  ]);

  assert.doesNotMatch(spec, /--use-fake-device-for-media-stream/u);
  assert.doesNotMatch(config, /--use-fake-device-for-media-stream/u);
  assert.match(spec, /navigator\.mediaDevices\.getUserMedia/u);
  assert.match(spec, /stage === "perception_health"/u);
  assert.match(suite, /"real-device-browser-smoke"/u);
  assert.match(suite, /"e2e\/realDeviceMedia\.spec\.ts"/u);
  assert.match(workflow, /^\s+schedule:\s*$/mu);
  assert.match(workflow, /github\.event_name == 'workflow_dispatch'/u);
  assert.equal(
    JSON.parse(schemaText).properties.schemaVersion.const,
    MEET_ATTESTATION_SCHEMA_VERSION,
  );
});

test("a Meet opt-in flag without a station artifact fails closed", () => {
  const result = validateDeviceEvalContract({
    env: {
      ...environment("/does/not/exist/attestation.json"),
      AIRBOARD_EVAL_MEET_BRIDGE: "1",
    },
    platform: "win32",
    nowMs: NOW,
  });

  assert.equal(result.valid, false);
  assert.ok(
    result.failures.includes(
      "Meet station attestation could not be read or parsed",
    ),
  );
});

test("stale, sender-only, or media-retaining Meet claims are rejected", () => {
  const unsafe = attestation();
  unsafe.observedAt = "2026-07-30T05:00:00.000Z";
  unsafe.expiresAt = "2026-07-30T11:00:00.000Z";
  unsafe.receiver.expectedOverlayObserved = false;
  unsafe.privacy.rawMediaRetained = true;

  const result = validateMeetStationAttestation(unsafe, {
    deviceId: "station-macos-01",
    nowMs: NOW,
  });

  assert.equal(result.summary, null);
  assert.ok(
    result.failures.includes(
      "Meet station attestation is older than two hours",
    ),
  );
  assert.ok(
    result.failures.includes("Meet receiver overlay observation was not proven"),
  );
  assert.ok(
    result.failures.includes(
      "Meet raw-media retention declaration is invalid",
    ),
  );
});

test("station label patterns cannot be empty-match wildcards", () => {
  const result = validateDeviceEvalContract({
    env: {
      ...environment("/does/not/exist/attestation.json"),
      AIRBOARD_EVAL_EXPECTED_CAMERA_LABEL_PATTERN: ".*",
      AIRBOARD_EVAL_EXPECTED_MICROPHONE_LABEL_PATTERN: ".?",
    },
    platform: "darwin",
    nowMs: NOW,
  });

  assert.ok(
    result.failures.some((failure) =>
      failure.includes("must not match an empty device label"),
    ),
  );
  assert.ok(
    result.failures.some((failure) =>
      failure.includes("too broad to bind the station hardware"),
    ),
  );
});

function environment(attestationPath) {
  return {
    AIRBOARD_EVAL_REAL_CAMERA: "1",
    AIRBOARD_EVAL_REAL_MICROPHONE: "1",
    AIRBOARD_EVAL_MEET_BRIDGE: "1",
    AIRBOARD_EVAL_DEVICE_ID: "station-macos-01",
    AIRBOARD_EVAL_EXPECTED_CAMERA_LABEL_PATTERN: "FaceTime HD Camera",
    AIRBOARD_EVAL_EXPECTED_MICROPHONE_LABEL_PATTERN:
      "MacBook Pro Microphone",
    AIRBOARD_EVAL_MEET_ATTESTATION_PATH: attestationPath,
  };
}

function attestation() {
  return {
    schemaVersion: MEET_ATTESTATION_SCHEMA_VERSION,
    attestationId: "station-check-20260730-01",
    stationDeviceId: "station-macos-01",
    issuedBy: "receiver-station-automation",
    observedAt: "2026-07-30T09:30:00.000Z",
    expiresAt: "2026-07-30T11:00:00.000Z",
    meetingCodeHash: "a".repeat(64),
    sender: {
      compositorEngaged: true,
      senderAttached: true,
      encodedFramesDelta: 180,
      outboundBytesDelta: 42_000,
    },
    receiver: {
      method: "receiver_station_automation",
      expectedOverlayObserved: true,
      participantCount: 1,
    },
    privacy: {
      rawMediaRetained: false,
      contentCaptured: false,
    },
  };
}
