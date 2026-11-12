#!/usr/bin/env node

/**
 * Offline positive-grammar evaluation: replays the deterministic-positives
 * corpus through the real parser and fails if any case stops parsing to its
 * expected command. Together with eval-false-accepts (the negatives) this
 * makes every grammar change prove itself in CI: nothing users rely on may
 * break, and no meeting talk may start executing.
 */

import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { normalizeScopedVoiceUtterance } from "../apps/web/src/features/board/browserSpeech.ts";
import { parseIntentCanvasCommand } from "../apps/web/src/features/board/intentCanvasParser.ts";
import { parseBoardSceneIntent } from "../packages/core/src/sceneIntent.ts";
import {
  assertAllGrammarGapScenariosExecuted,
  compareGrammarExpectation,
  prepareGrammarEvalCorpus,
} from "./lib/grammar-eval-corpus.mjs";

const SCRIPT_DIRECTORY = dirname(fileURLToPath(import.meta.url));
const REPOSITORY_ROOT = resolve(SCRIPT_DIRECTORY, "..");
const DEFAULT_FIXTURE = resolve(
  REPOSITORY_ROOT,
  "evals/voice-intent/deterministic-positives.v1.json",
);
const MEETING_NEGATIVES_FIXTURE = resolve(
  REPOSITORY_ROOT,
  "evals/voice-intent/meeting-negatives.v1.json",
);

/**
 * The fast scene phrase rules (packages/core/src/sceneIntent.ts) run before
 * every other path and apply at once, so they carry their own contract:
 * `expected: null` means "hand off", anything else must match those fields
 * exactly. Gap 5 of Docs/archive/Hands-free Gap Audit.md is the origin of most rows.
 */
const contextualIt = { kind: "contextual", pronoun: "it" };
const SCENE_INTENT_CASES = [
  // Compound or open-ended: hand off to the AI planner.
  ["Airo, add a database and a cache", null],
  ["create a flowchart for user signup", null],
  ["add a database named Orders and connect it to the API", null],
  ["add three services named Auth, Billing and Search", null],
  ["connect User to API and API to Database", null],
  ["add two databases", null],
  ["add a cache between the API and the database", null],
  ["delete the API which talks to billing", null],
  ["make the database that handles orders red", null],
  ["create a mind map for the launch plan", null],
  // Plain undo and cancel stay with the intent parser, which runs them.
  ["undo", null],
  ["undo that", null],
  ["go back", null],
  ["never mind", null],
  // Clean commands apply.
  ["add a payments service", { type: "create", shapeKind: "service", label: "Payments Service" }],
  ["put the database below the API", {
    type: "move_to",
    target: { kind: "visible_label", label: "database" },
    destination: { direction: "down", target: "visible_label", label: "API" },
  }],
  ["make it a queue", { type: "change_shape", target: contextualIt, shapeKind: "queue" }],
  ["change it to a queue", { type: "change_shape", target: contextualIt, shapeKind: "queue" }],
  ["turn it into a decision", { type: "change_shape", target: contextualIt, shapeKind: "diamond" }],
  ["move the database to the right", { type: "move", target: { kind: "visible_label", label: "database" }, dx: 80, dy: 0 }],
  ["please add a database", { type: "create", shapeKind: "database", label: "Database" }],
  ["now add a database", { type: "create", shapeKind: "database", label: "Database" }],
  ["let's add a database", { type: "create", shapeKind: "database", label: "Database" }],
  ["rename it to Orders", { type: "rename", target: contextualIt, label: "Orders" }],
  ["make it blue", { type: "style", target: contextualIt, color: "#3b82f6" }],
  ["delete it", { type: "delete", target: contextualIt }],
  ["make it bigger", { type: "resize", target: contextualIt, scaleX: 1.25, scaleY: 1.25 }],
  ["add a database here", { type: "create", shapeKind: "database", placement: { target: "pointer" } }],
  ["connect this to that", {
    type: "connect",
    from: { kind: "contextual", pronoun: "this" },
    to: { kind: "contextual", pronoun: "that" },
  }],
  ["move it here", { type: "move_to", target: contextualIt, destination: { target: "pointer" } }],
  ["redo", { type: "redo", count: 1 }],
  ["bring it back", { type: "redo", count: 1 }],
  ["scratch that", { type: "undo", count: 1 }],
  ["undo twice", { type: "undo", count: 2 }],
  ["no, I meant a database", { type: "correct", remainder: "a database", shapeKind: "database" }],
  ["zoom to fit", { type: "zoom_to_fit" }],
  ["show everything", { type: "zoom_to_fit" }],
  ["focus on payments", { type: "focus", target: { kind: "visible_label", label: "payments" } }],
  ["bring it to the front", { type: "reorder", target: contextualIt, position: "front" }],
  ["send it to the back", { type: "reorder", target: contextualIt, position: "back" }],
];

function compareSceneIntent(result, expected) {
  if (expected === null) {
    return result === null ? [] : [`expected a hand-off (null), got ${JSON.stringify(result)}`];
  }
  if (result === null) return [`expected ${JSON.stringify(expected)}, got null`];
  return Object.entries(expected).flatMap(([key, value]) =>
    JSON.stringify(result[key]) === JSON.stringify(value)
      ? []
      : [`${key}: expected ${JSON.stringify(value)}, got ${JSON.stringify(result[key])}`]);
}

main().catch((error) => {
  console.error(
    `Grammar evaluation could not start: ${error instanceof Error ? error.message : String(error)}`,
  );
  process.exitCode = 2;
});

async function main() {
  const fixturePath = resolve(process.cwd(), process.argv[2] ?? DEFAULT_FIXTURE);
  const corpus = JSON.parse(await readFile(fixturePath, "utf8"));
  const prepared = prepareGrammarEvalCorpus(corpus);

  const failures = [];
  const executedGapScenarioIds = new Set();
  for (const testCase of prepared.allCases) {
    const text = testCase.scoped
      ? normalizeScopedVoiceUtterance(testCase.text)
      : testCase.text;
    // externally_activated both accepts bare commands and strips a leading
    // wake phrase, so one policy covers typed, gated, and wake-prefixed cases.
    const result = parseIntentCanvasCommand(text, {
      activationPolicy: "externally_activated",
    });
    const problems = compareGrammarExpectation(result, testCase.expected, {
      effectiveText: text,
    });
    if (problems.length > 0) {
      failures.push({ id: testCase.id, text: testCase.text, problems });
    }
    if (testCase.knownGapId) {
      executedGapScenarioIds.add(testCase.id);
    }
  }
  assertAllGrammarGapScenariosExecuted(
    prepared.knownGaps,
    executedGapScenarioIds,
  );

  // Fast scene phrase rules: their contract, and no meeting talk may parse.
  const sceneFailures = [];
  for (const [text, expected] of SCENE_INTENT_CASES) {
    const problems = compareSceneIntent(parseBoardSceneIntent(text), expected);
    if (problems.length > 0) sceneFailures.push({ id: "scene-intent", text, problems });
  }
  const meetingNegatives = JSON.parse(await readFile(MEETING_NEGATIVES_FIXTURE, "utf8")).utterances;
  for (const utterance of meetingNegatives) {
    const result = parseBoardSceneIntent(utterance.text);
    if (result !== null) {
      sceneFailures.push({
        id: `scene-intent:${utterance.id}`,
        text: utterance.text,
        problems: [`meeting talk parsed as ${JSON.stringify(result)}`],
      });
    }
  }
  const sceneCaseCount = SCENE_INTENT_CASES.length + meetingNegatives.length;
  console.log(
    `Scene phrase rules: ${sceneCaseCount - sceneFailures.length}/${sceneCaseCount} cases behave as expected (${meetingNegatives.length} meeting negatives)`,
  );
  failures.push(...sceneFailures);

  const passed = prepared.allCases.length - (failures.length - sceneFailures.length);
  console.log(
    `Airboard grammar evaluation: ${passed}/${prepared.allCases.length} contract cases behave as expected`,
  );
  console.log(
    `Executable grammar gaps: ${prepared.knownGaps.length}/${corpus.knownGapCount} gaps, ${executedGapScenarioIds.size}/${prepared.gapCases.length} scenarios`,
  );
  for (const failure of failures) {
    console.log(`  FAIL ${failure.id}: “${failure.text}”`);
    for (const problem of failure.problems) {
      console.log(`     - ${problem}`);
    }
  }
  if (failures.length > 0) {
    process.exitCode = 1;
  }
}
