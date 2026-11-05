#!/usr/bin/env node

/**
 * Offline false-accept evaluation for Airboard's voice addressing.
 *
 * Replays a corpus of ambient meeting talk — utterances that must NEVER
 * execute as board commands — through both addressing channels:
 *
 *   Channel A (wake word): the transcript hits the wake-word router with the
 *   mic armed but no gate open. A false accept is a routed command that also
 *   parses as a board mutation.
 *
 *   Channel B (gated): the worst case — a push-to-talk/hold-to-edit gate is
 *   open while the speaker addresses a colleague, so the transcript reaches
 *   the deterministic parser as externally activated. A false accept is a
 *   parse that would mutate the board.
 *
 * Parsed commands whose only object references are labels ("connect X to Y")
 * are reported as SOFT accepts: they mutate only if the labels ground against
 * real board objects. Everything else that parses (create/undo/selection
 * edits/deictic refs) is a HARD accept and fails the run.
 *
 * Caveat: this eval covers the deterministic layer only. Utterances the
 * parser rejects can still reach the semantic (LLM) fallback in a live
 * session; that path needs the API and is exercised by `pnpm eval:voice`.
 */

import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { classifyBrowserWakeTranscript } from "../apps/web/src/features/board/browserSpeech.ts";
import { parseIntentCanvasCommand } from "../apps/web/src/features/board/intentCanvasParser.ts";
import { resolveIntentOperation } from "../apps/web/src/features/board/intentPipeline.ts";
import {
  applyDiagramCommand,
  createInitialBoardState,
} from "../packages/core/src/index.ts";

const SCRIPT_DIRECTORY = dirname(fileURLToPath(import.meta.url));
const REPOSITORY_ROOT = resolve(SCRIPT_DIRECTORY, "..");
const DEFAULT_FIXTURE = resolve(
  REPOSITORY_ROOT,
  "evals/voice-intent/meeting-negatives.v1.json",
);

main().catch((error) => {
  console.error(
    `False-accept evaluation could not start: ${error instanceof Error ? error.message : String(error)}`,
  );
  process.exitCode = 2;
});

async function main() {
  const fixturePath = resolve(process.cwd(), process.argv[2] ?? DEFAULT_FIXTURE);
  const corpus = JSON.parse(await readFile(fixturePath, "utf8"));
  if (
    corpus?.schemaVersion !== "1.0" ||
    !Array.isArray(corpus.utterances) ||
    corpus.utterances.some(
      (utterance) => typeof utterance?.id !== "string" || typeof utterance?.text !== "string",
    )
  ) {
    throw new Error(`${fixturePath} is not a meeting-negatives corpus with schemaVersion 1.0`);
  }

  const wake = { activations: [], hard: [], soft: [], groundedMutations: [] };
  const gated = { hard: [], soft: [], groundedMutations: [], clarifications: [] };

  for (const { id, text } of corpus.utterances) {
    // Channel A — wake router.
    const classification = classifyBrowserWakeTranscript(text);
    for (const routed of classification.commands) {
      wake.activations.push({ id, command: routed.command });
      const parsed = parseIntentCanvasCommand(routed.command, {
        activationPolicy: "externally_activated",
      });
      if (parsed.status === "parsed") {
        const risk = classifyParsedRisk(parsed.command);
        if (risk === "hard") wake.hard.push({ id, command: routed.command, kind: parsed.command.kind });
        if (risk === "soft") {
          const item = { id, command: routed.command, kind: parsed.command.kind };
          wake.soft.push(item);
          if (wouldMutateAgainstTemptingBoard(parsed.command)) {
            wake.groundedMutations.push(item);
          }
        }
      }
    }

    // Channel B — open gate.
    const parsed = parseIntentCanvasCommand(text, {
      activationPolicy: "externally_activated",
    });
    if (parsed.status === "parsed") {
      const risk = classifyParsedRisk(parsed.command);
      if (risk === "hard") gated.hard.push({ id, text, kind: parsed.command.kind });
      if (risk === "soft") {
        const item = { id, text, kind: parsed.command.kind };
        gated.soft.push(item);
        if (wouldMutateAgainstTemptingBoard(parsed.command)) {
          gated.groundedMutations.push(item);
        }
      }
    } else if (parsed.status === "clarification") {
      gated.clarifications.push({ id, text, issue: parsed.issue.code });
    }
  }

  const total = corpus.utterances.length;
  console.log(`Airboard false-accept evaluation (${total} meeting-talk utterances)`);
  console.log(`Fixture: ${fixturePath}\n`);

  console.log("Channel A — wake-word router (armed mic, no gate):");
  console.log(`  activations:          ${wake.activations.length}/${total}`);
  console.log(`  HARD false accepts:   ${wake.hard.length}/${total}`);
  console.log(`  soft (named-ref):     ${wake.soft.length}/${total}`);
  console.log(`  grounded mutations:   ${wake.groundedMutations.length}/${total}`);
  printItems(wake.hard, (item) => `${item.id}: routed “${item.command}” → ${item.kind}`);
  printItems(wake.soft, (item) => `${item.id}: routed “${item.command}” → ${item.kind} (label-grounded)`);
  printItems(
    wake.groundedMutations,
    (item) => `${item.id}: routed “${item.command}” would mutate a tempting board`,
  );

  console.log("\nChannel B — open push-to-talk gate (worst case):");
  console.log(`  HARD false accepts:   ${gated.hard.length}/${total}`);
  console.log(`  soft (named-ref):     ${gated.soft.length}/${total}`);
  console.log(`  grounded mutations:   ${gated.groundedMutations.length}/${total}`);
  console.log(`  clarification noise:  ${gated.clarifications.length}/${total}`);
  printItems(gated.hard, (item) => `${item.id}: “${item.text}” → ${item.kind}`);
  printItems(gated.soft, (item) => `${item.id}: “${item.text}” → ${item.kind} (label-grounded)`);
  printItems(
    gated.groundedMutations,
    (item) => `${item.id}: “${item.text}” would mutate a tempting board`,
  );
  printItems(
    gated.clarifications,
    (item) => `${item.id}: “${item.text}” → prompt (${item.issue})`,
    "  (noise, non-fatal)",
  );

  const hardTotal =
    wake.hard.length +
    gated.hard.length +
    wake.groundedMutations.length +
    gated.groundedMutations.length;
  console.log(
    `\nResult: ${hardTotal === 0 ? "PASS" : "FAIL"} — ${hardTotal} actionable false accept(s); target is 0.`,
  );
  if (hardTotal > 0) {
    process.exitCode = 1;
  }
}

function wouldMutateAgainstTemptingBoard(command) {
  const references =
    command.kind === "connect" || command.kind === "delete_connection"
      ? [command.from, command.to]
      : "target" in command
        ? [command.target]
        : [];
  const labels = [
    ...new Set(
      references
        .filter((reference) => reference?.kind === "named")
        .map((reference) => reference.label),
    ),
  ];
  if (labels.length === 0) return false;

  let board = createInitialBoardState("false-accept-board");
  const context = (index) => {
    let eventIndex = 0;
    return {
      boardSessionId: "false-accept-board",
      actorParticipantId: "eval",
      userId: "eval",
      createdAt: `2026-07-30T00:00:0${index}.000Z`,
      eventIdFactory: () => `event-${index}-${++eventIndex}`,
    };
  };
  const ids = new Map();
  for (const [index, label] of labels.entries()) {
    const nodeId = `tempting-${index}`;
    ids.set(label, nodeId);
    board = applyDiagramCommand(
      board,
      {
        type: "node.create",
        nodeId,
        nodeType: "custom",
        label,
        center: { x: 120 + index * 240, y: 180 },
      },
      context(index),
    ).state;
  }
  if (command.kind === "delete_connection" && labels.length >= 2) {
    board = applyDiagramCommand(
      board,
      {
        type: "nodes.connect",
        connectorId: "tempting-connector",
        fromId: ids.get(labels[0]),
        toId: ids.get(labels[1]),
      },
      context(labels.length),
    ).state;
  }
  const resolved = resolveIntentOperation(command, {
    boardState: board,
    pointer: { x: 450, y: 300 },
    canvasWidth: 900,
    canvasHeight: 600,
    selectionIds: [],
    primarySelectionId: null,
    hoverStrokeId: null,
    strokeColor: "#111111",
  });
  return !("error" in resolved) && resolved.commands.length > 0;
}

function classifyParsedRisk(command) {
  if (command.kind === "cancel") {
    // Cancels a pending preview at most; it cannot mutate the board.
    return "harmless";
  }
  if (command.kind === "connect") {
    return [command.from, command.to].some((ref) => ref.kind === "deictic") ? "hard" : "soft";
  }
  if (
    command.kind === "rename_object" ||
    command.kind === "resize_object" ||
    command.kind === "recolor_object"
  ) {
    return command.target.kind === "deictic" ? "hard" : "soft";
  }
  if (command.kind === "select_all") {
    // Changes selection only; board content is untouched.
    return "harmless";
  }
  if (command.kind === "delete_connection") {
    return [command.from, command.to].some((ref) => ref.kind === "deictic") ? "hard" : "soft";
  }
  return "hard";
}

function printItems(items, format, suffix = "") {
  for (const item of items) {
    console.log(`    - ${format(item)}${suffix}`);
  }
}
