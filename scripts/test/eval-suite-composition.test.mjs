import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import test from "node:test";

import { prSteps } from "../run-eval-suite.mjs";

const root = new URL("../../", import.meta.url);

test("the PR tier runs every blocking offline safety gate", () => {
  const ids = prSteps.map(({ id }) => id);
  for (const gate of [
    "capability-coverage",
    "dataset-policy",
    "landmark-replay",
    "deterministic-contract-matrix",
    "deterministic-positive-corpus",
    "grounded-ambient-negatives",
    "semantic-ambient-negative-replay",
    "provider-event-replay",
    "seeded-evaluator-faults",
    "canonical-interactions",
  ]) {
    assert.ok(ids.includes(gate), `${gate} must stay in eval:pr`);
  }
  assert.equal(new Set(ids).size, ids.length, "step ids are unique");
});

test("the PR tier runs only eval CLIs, never a second test run", () => {
  for (const step of prSteps) {
    const [script, ...args] = step.args;
    assert.ok(!step.args.includes("--test"), `${step.id} must not re-run node --test`);
    assert.match(script, /^scripts\/[\w-]+\.mjs$/u, `${step.id} runs a script CLI`);
    assert.ok(existsSync(new URL(script, root)), `${script} exists`);
    assert.ok(!args.includes("--live"), `${step.id} stays offline`);
  }
});
