import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  parseLandmarkTrace,
  replayLandmarkTrace,
  segmentsAbove,
} from "../dist/landmarkTrace.js";

const FIXTURE = new URL("./fixtures/palm-grab-pointing.trace.json", import.meta.url);

test("replaying the reference trace detects each pose only in its segment", async () => {
  const trace = parseLandmarkTrace(JSON.parse(await readFile(FIXTURE, "utf8")));
  const samples = replayLandmarkTrace(trace);
  assert.equal(samples.length, trace.frames.length);
  assert.ok(
    samples.every((sample) => Number.isFinite(sample.victoryScore)),
    "every replay sample exposes the canonical Victory score",
  );

  // Palm-presentation pose: exactly one contiguous segment covering the
  // held-open-palm phase (the rising phase also scores — stillness gating is
  // the tracker's job, not the estimator's) and NOT the fist/pointing phases.
  const palmSegments = segmentsAbove(samples, (s) => s.palmScore, 0.62);
  assert.equal(palmSegments.length, 1, JSON.stringify(palmSegments));
  const palm = palmSegments[0];
  assert.ok(palm.fromMs <= 660, `palm detected from ${palm.fromMs}`);
  assert.ok(palm.toMs >= 1900 && palm.toMs < 2050, `palm held until ${palm.toMs}`);

  // Grab: exactly one segment, aligned with the fist phase.
  const grabSegments = segmentsAbove(samples, (s) => s.grabStrength, 0.68);
  assert.equal(grabSegments.length, 1, JSON.stringify(grabSegments));
  const grab = grabSegments[0];
  assert.ok(grab.fromMs >= 1950 && grab.fromMs <= 2100, `grab from ${grab.fromMs}`);
  assert.ok(grab.toMs >= 3100 && grab.toMs < 3250, `grab until ${grab.toMs}`);

  // The camera-pointing phase must trigger neither pose.
  const pointingSamples = samples.filter((s) => s.t >= 3300);
  assert.ok(pointingSamples.length > 20);
  for (const sample of pointingSamples) {
    assert.ok(sample.palmScore < 0.62, `pointing frame at ${sample.t} scored palm ${sample.palmScore}`);
    assert.ok(
      sample.victoryScore < 0.72,
      `pointing frame at ${sample.t} scored Victory ${sample.victoryScore}`,
    );
    assert.ok(sample.grabStrength < 0.68, `pointing frame at ${sample.t} scored grab ${sample.grabStrength}`);
  }
});

test("parseLandmarkTrace rejects malformed traces", () => {
  assert.throws(() => parseLandmarkTrace(null));
  assert.throws(() => parseLandmarkTrace({ schemaVersion: "2.0", frames: [] }));
  assert.throws(() => parseLandmarkTrace({ schemaVersion: "1.0", frames: [{ t: "x", hands: [] }] }));
});
