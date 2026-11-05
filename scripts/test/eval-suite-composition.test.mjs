import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(
  new URL("../run-eval-suite.mjs", import.meta.url),
  "utf8",
);

test("PR and release share every blocking offline correctness gate", () => {
  const helper = source.match(
    /function offlineCoreReleaseGateSteps\(\) \{(?<body>[\s\S]*?)\n\}/u,
  )?.groups?.body;
  assert.ok(helper, "offline release gate helper must exist");

  for (const gate of [
    "deterministic-contract-matrix",
    "deterministic-positive-corpus",
    "grounded-ambient-negatives",
    "provider-event-replay",
    "seeded-evaluator-faults",
  ]) {
    assert.match(helper, new RegExp(`"${gate}"`, "u"));
  }

  const prSuite = suiteBody("pr", "canary");
  const releaseSuite = suiteBody("release", null);
  assert.match(prSuite, /\.\.\.offlineCoreReleaseGateSteps\(\)/u);
  assert.match(releaseSuite, /\.\.\.offlineCoreReleaseGateSteps\(\)/u);
});

test("nightly and release evaluate direct and Meet audio transport", () => {
  for (const body of [
    suiteBody("nightly", "device"),
    suiteBody("release", null),
  ]) {
    assert.match(
      body,
      /"--adapter",\s*"live-websocket",\s*"--adapter",\s*"meet-bridge-replay"/u,
    );
    assert.match(body, /"--model",\s*candidateSemanticModel/u);
    assert.match(body, /"--frame-delay-ms",\s*"0"/u);
  }
});

test("canary runs the full approximately-30 semantic set and a bounded live STT sample", () => {
  const body = suiteBody("canary", "nightly");
  const semanticStep = body.match(
    /"live-semantic-canary"(?<step>[\s\S]*?)requiredEnvironment/u,
  )?.groups?.step;
  assert.ok(semanticStep, "live semantic canary step must exist");
  assert.doesNotMatch(semanticStep, /"--case"/u);
  assert.match(
    body,
    /"live-audio-canary"[\s\S]*?"--adapter",\s*"live-websocket",\s*"--adapter",\s*"meet-bridge-replay"/u,
  );
  assert.match(body, /"--max-scenarios",\s*"30"/u);
  assert.match(body, /"--require-assets"/u);
});

test("PR browser journeys execute the direct touchpad and stylus evidence", () => {
  assert.match(
    source,
    /const coreBrowserFiles = \[[\s\S]*?"e2e\/directInputChannels\.spec\.ts"/u,
  );
});

function suiteBody(name, nextName) {
  const startMarker = `  ${name}: [`;
  const start = source.indexOf(startMarker);
  assert.notEqual(start, -1, `${name} suite must exist`);
  const end = nextName
    ? source.indexOf(`  ${nextName}: [`, start + startMarker.length)
    : source.indexOf("\n  ],\n};", start + startMarker.length);
  assert.notEqual(end, -1, `${name} suite must have a closing boundary`);
  return source.slice(start, end);
}
