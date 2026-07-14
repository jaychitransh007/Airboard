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

  const wake = { activations: [], hard: [], soft: [] };
  const gated = { hard: [], soft: [], clarifications: [] };

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
        if (risk === "soft") wake.soft.push({ id, command: routed.command, kind: parsed.command.kind });
      }
    }

    // Channel B — open gate.
    const parsed = parseIntentCanvasCommand(text, {
      activationPolicy: "externally_activated",
    });
    if (parsed.status === "parsed") {
      const risk = classifyParsedRisk(parsed.command);
      if (risk === "hard") gated.hard.push({ id, text, kind: parsed.command.kind });
      if (risk === "soft") gated.soft.push({ id, text, kind: parsed.command.kind });
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
  printItems(wake.hard, (item) => `${item.id}: routed “${item.command}” → ${item.kind}`);
  printItems(wake.soft, (item) => `${item.id}: routed “${item.command}” → ${item.kind} (label-grounded)`);

  console.log("\nChannel B — open push-to-talk gate (worst case):");
  console.log(`  HARD false accepts:   ${gated.hard.length}/${total}`);
  console.log(`  soft (named-ref):     ${gated.soft.length}/${total}`);
  console.log(`  clarification noise:  ${gated.clarifications.length}/${total}`);
  printItems(gated.hard, (item) => `${item.id}: “${item.text}” → ${item.kind}`);
  printItems(gated.soft, (item) => `${item.id}: “${item.text}” → ${item.kind} (label-grounded)`);
  printItems(
    gated.clarifications,
    (item) => `${item.id}: “${item.text}” → prompt (${item.issue})`,
    "  (noise, non-fatal)",
  );

  const hardTotal = wake.hard.length + gated.hard.length;
  console.log(
    `\nResult: ${hardTotal === 0 ? "PASS" : "FAIL"} — ${hardTotal} hard false accept(s); target is 0.`,
  );
  console.log(
    "Note: soft accepts mutate only when a spoken label matches a real board object;",
  );
  console.log(
    "they are tracked here so the corpus keeps them visible as the grammar evolves.",
  );
  if (hardTotal > 0) {
    process.exitCode = 1;
  }
}

function classifyParsedRisk(command) {
  if (command.kind === "cancel") {
    // Cancels a pending preview at most; it cannot mutate the board.
    return "harmless";
  }
  if (command.kind === "connect") {
    return [command.from, command.to].some((ref) => ref.kind === "deictic") ? "hard" : "soft";
  }
  if (command.kind === "rename_object" || command.kind === "resize_object") {
    return command.target.kind === "deictic" ? "hard" : "soft";
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
