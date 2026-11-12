import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(
  new URL("../run-eval-suite.mjs", import.meta.url),
  "utf8",
);

test("the PR tier runs every blocking offline correctness gate", () => {
  const prSuite = suiteBody("pr");
  for (const gate of [
    "deterministic-contract-matrix",
    "deterministic-positive-corpus",
    "grounded-ambient-negatives",
    "semantic-ambient-negative-replay",
    "provider-event-replay",
    "seeded-evaluator-faults",
  ]) {
    assert.match(prSuite, new RegExp(`"${gate}"`, "u"));
  }
});

test("only the offline PR tier remains", () => {
  const tiers = [
    ...source
      .slice(source.indexOf("const suites = {"))
      .matchAll(/^ {2}(?<name>[a-z]+): \[/gmu),
  ].map(({ groups }) => groups.name);
  assert.deepEqual(tiers, ["pr"]);
  assert.doesNotMatch(source, /live-websocket|requiredEnvironment/u);
});

test("PR browser journeys execute the direct touchpad and stylus evidence", () => {
  assert.match(
    source,
    /const coreBrowserFiles = \[[\s\S]*?"e2e\/directInputChannels\.spec\.ts"/u,
  );
});

function suiteBody(name) {
  const startMarker = `  ${name}: [`;
  const start = source.indexOf(startMarker);
  assert.notEqual(start, -1, `${name} suite must exist`);
  const end = source.indexOf("\n  ],\n", start + startMarker.length);
  assert.notEqual(end, -1, `${name} suite must have a closing boundary`);
  return source.slice(start, end);
}
