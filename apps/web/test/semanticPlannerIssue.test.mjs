import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  createInitialBoardState,
  isCompoundBoardCommand,
  parseBoardSceneIntent,
} from "@airboard/core";

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith(".") && context.parentURL) {
      const candidate = new URL(`${specifier}.ts`, context.parentURL);
      if (existsSync(fileURLToPath(candidate))) {
        return nextResolve(candidate.href, context);
      }
    }
    return nextResolve(specifier, context);
  },
});

const {
  expandSpokenCreateAndConnect,
  parseDiagramVisibilityIntent,
  predictSemanticPlannerIssue,
  semanticParserIssue,
} = await import("../src/features/board/semanticPlannerIssue.ts");
const { parseIntentCanvasCommand } = await import("../src/features/board/intentCanvasParser.ts");
const { parseDesiredGraphCorrection } = await import("../src/features/board/desiredGraphCorrection.ts");
const { resolveExistingBoardFanIn } = await import("../src/features/board/existingBoardFanIn.ts");
const { buildSemanticIntentContext } = await import("../src/features/board/intentPipeline.ts");
const { buildSceneFanInContext } = await import("../src/features/board/scene/sceneTargets.ts");
const { classifyBrowserWakeTranscript, normalizeBrowserWakeCommand } = await import(
  "../src/features/board/browserSpeech.ts"
);

const readCorpus = (name) =>
  JSON.parse(readFileSync(new URL(`../../../evals/voice-intent/${name}`, import.meta.url), "utf8"));
const plannerCorpus = readCorpus("v1.json").cases.map((entry) => entry.transcript);
const grammarCorpus = readCorpus("deterministic-positives.v1.json").cases.map((entry) => entry.text);

function spokenCommand(transcript) {
  return (
    classifyBrowserWakeTranscript(transcript).commands[0]?.command ??
    normalizeBrowserWakeCommand(transcript)
  );
}

const PARSE = { activationPolicy: "externally_activated" };

/**
 * The stages of prepareIntentCommandWithSemantic (AirboardPrototype.tsx), in
 * its order, for a board whose fast rules cannot apply anything: the issue the
 * preparer sends to the planner, "local" when a stage handles the command
 * before the planner, or "board" when the outcome depends on applying it.
 */
function preparerOutcome(instruction, board) {
  if (parseDiagramVisibilityIntent(instruction)) return "local";
  if (
    resolveExistingBoardFanIn(instruction, buildSceneFanInContext(board, [])).status !==
    "unrecognized"
  ) {
    return "local";
  }
  if (parseBoardSceneIntent(instruction) !== null) return "board";
  if (parseDesiredGraphCorrection(instruction)) return "local";
  const fanIn = resolveExistingBoardFanIn(instruction, buildSemanticIntentContext(board, [], false));
  if (fanIn.status === "already_satisfied" || fanIn.status === "resolved") return "local";
  const older = parseIntentCanvasCommand(instruction, PARSE);
  // No scene intent here, so the pointing-word rule cannot apply.
  const compound =
    isCompoundBoardCommand(instruction) && older.status === "parsed" && older.command.kind === "create_node";
  if (!compound) {
    // prepareIntentCommand: a fully parsed linked create, or any parsed
    // command, is applied (or grounded against the board) locally.
    const linked = expandSpokenCreateAndConnect(instruction);
    if (linked && linked.every((step) => parseIntentCanvasCommand(step, PARSE).status === "parsed")) {
      return "local";
    }
    if (older.status === "parsed") return "board";
  }
  return semanticParserIssue(compound, older) ?? "local";
}

test("the speculation predictor agrees with the preparer's stages on every corpus sentence", () => {
  const board = createInitialBoardState("planner-issue-test");
  let predicted = 0;
  for (const transcript of [...plannerCorpus, ...grammarCorpus]) {
    const instruction = spokenCommand(transcript);
    const outcome = preparerOutcome(instruction, board);
    const prediction = predictSemanticPlannerIssue(instruction, board, []);
    if (outcome === "local" || outcome === "board") {
      assert.equal(prediction, null, `"${instruction}" is not sent to the planner as predicted`);
    } else {
      assert.equal(prediction, outcome, `"${instruction}"`);
      predicted += 1;
    }
  }
  assert.ok(predicted >= 30, `the predictor speculates on most planner sentences (${predicted})`);
});

test("commands the fast rules apply are never speculated", () => {
  const board = createInitialBoardState("planner-issue-test");
  for (const instruction of [
    "add a database",
    "make it red",
    "delete the box",
    "zoom to fit",
    "hide the diagram",
    "bring the canvas back",
    "add a database connected to the API",
    "rename it to Payments",
  ]) {
    assert.equal(predictSemanticPlannerIssue(instruction, board, []), null, instruction);
  }
});

test("the preparer's issue: compound, grounding failure, or the grammar's own issue", () => {
  const parsed = parseIntentCanvasCommand("add a database", PARSE);
  assert.equal(parsed.status, "parsed");
  assert.equal(semanticParserIssue(true, parsed), "compound_command");
  assert.equal(semanticParserIssue(false, parsed), "grounding_failed");
  const unknown = parseIntentCanvasCommand("animate the database so it pulses", PARSE);
  assert.equal(semanticParserIssue(false, unknown), "unknown_command");
});
