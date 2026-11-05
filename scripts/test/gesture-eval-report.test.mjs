import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";

import { main } from "../eval-gesture-replay.mjs";

const ROOT = resolve(import.meta.dirname, "../..");

test("gesture replay securely evaluates mounted derived traces and reports observed coverage", async (t) => {
  const directory = await mkdtemp(
    join(tmpdir(), "airboard-gesture-mounted-"),
  );
  t.after(() => rm(directory, { recursive: true, force: true }));
  const trace = await readFile(
    resolve(
      ROOT,
      "packages/gesture-engine/test/fixtures/palm-grab-pointing.trace.json",
    ),
  );
  const traceName = "approved-holdout.trace.json";
  await writeFile(join(directory, traceName), trace);
  const sourceManifest = JSON.parse(
    await readFile(resolve(ROOT, "evals/gesture/corpus.v1.json"), "utf8"),
  );
  const sourceAsset = sourceManifest.assets[0];
  const manifest = {
    ...sourceManifest,
    corpusVersion: "gesture-test-mounted-v1",
    assets: [
      {
        ...sourceAsset,
        id: "derived-holdout-01",
        assetClass: "derived",
        storageKey: traceName,
        sourceAssetIds: ["restricted-source-01"],
        datasetSplit: "holdout",
        participantId: "participant-01",
        meetingSessionId: "session-01",
        hash: {
          algorithm: "sha256",
          value: createHash("sha256").update(trace).digest("hex"),
        },
        byteLength: trace.byteLength,
        privacy: {
          classification: "restricted_derived_biometric",
          containsRawMedia: false,
          containsBiometricData: true,
        },
        consent: {
          status: "granted",
          scope: [
            "offline_gesture_evaluation",
            "benchmark_retention",
          ],
          evidence: "fixture consent reference",
        },
        annotations: {
          ...sourceAsset.annotations,
          gesture: "manipulation_grab",
          condition: "standalone-normal-light",
          validRepetitions: 3,
          sliceTags: ["core_lighting", "tracking_loss"],
        },
      },
    ],
  };
  delete manifest.assets[0].repositoryPath;
  const manifestPath = join(directory, "manifest.json");
  await writeFile(manifestPath, JSON.stringify(manifest));
  const output = join(directory, "reports");
  const priorOutput = process.env.AIRBOARD_EVAL_OUTPUT_DIR;
  process.env.AIRBOARD_EVAL_OUTPUT_DIR = output;
  try {
    await main([
      "--manifest",
      manifestPath,
      "--media-root",
      directory,
      "--dataset-split",
      "holdout",
    ]);
  } finally {
    if (priorOutput === undefined) {
      delete process.env.AIRBOARD_EVAL_OUTPUT_DIR;
    } else {
      process.env.AIRBOARD_EVAL_OUTPUT_DIR = priorOutput;
    }
  }

  const report = JSON.parse(
    await readFile(
      join(output, "gesture", "gesture-results.json"),
      "utf8",
    ),
  );
  assert.equal(report.datasetSplit, "holdout");
  assert.deepEqual(report.coverage, {
    participantCount: 1,
    minimumValidRepetitionsPerGesturePerCoreCondition: 0,
    neutralMinutesPerParticipantMinimum: 0,
    evaluatedHumanAssetCount: 1,
  });
  assert.equal(report.metrics.slices.core_lighting.score, 1);
  assert.equal(report.metrics.slices.tracking_loss.score, 1);
  assert.equal(report.results[0].hashVerified, true);
  assert.equal(JSON.stringify(report).includes(traceName), false);
  assert.equal(
    JSON.stringify(report).includes("participant-01"),
    false,
  );
});
