#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  acceptDeepgramFinal,
  translateDeepgramFluxMessage,
} from "../apps/api/src/transcription/deepgramFluxProtocol.ts";
import {
  VoiceCommandRouter,
} from "../apps/web/src/features/board/voiceCommandRouter.ts";
import {
  parseIntentCanvasCommand,
} from "../apps/web/src/features/board/intentCanvasParser.ts";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const fixturePath = resolve(
  process.cwd(),
  process.argv[2] ??
    resolve(ROOT, "evals/provider-events/deepgram-flux.v1.json"),
);

main().catch((error) => {
  console.error(
    `Provider-event replay could not start: ${error instanceof Error ? error.message : String(error)}`,
  );
  process.exitCode = 2;
});

async function main() {
  const corpus = JSON.parse(await readFile(fixturePath, "utf8"));
  if (corpus?.schemaVersion !== "1.0" || !Array.isArray(corpus.cases)) {
    throw new Error("Expected provider replay schemaVersion 1.0.");
  }

  const failures = [];
  for (const testCase of corpus.cases) {
    const result = replay(testCase);
    const problems = compare(result, testCase.expected);
    if (problems.length > 0) {
      failures.push({ id: testCase.id, problems });
    }
  }

  console.log(
    `Airboard provider-event replay: ${corpus.cases.length - failures.length}/${corpus.cases.length}`,
  );
  for (const failure of failures) {
    console.log(`  FAIL ${failure.id}`);
    for (const problem of failure.problems) console.log(`     - ${problem}`);
  }
  if (failures.length > 0) process.exitCode = 1;
}

function replay(testCase) {
  const seenFinals = new Set();
  const router = new VoiceCommandRouter({ now: () => 1_000 });
  if (testCase.channel === "ptt") router.openGate({ mode: "ptt" });
  const result = {
    connected: 0,
    configured: 0,
    acceptedFinals: [],
    commandKinds: [],
    fatalErrors: 0,
  };
  const messages = [
    ...(testCase.messages ?? []).map((message) => JSON.stringify(message)),
    ...(testCase.rawMessages ?? []),
  ];
  for (const message of messages) {
    const translation = translateDeepgramFluxMessage(message);
    if (translation.connected) result.connected += 1;
    if (translation.configured) result.configured += 1;
    for (const event of translation.events) {
      if (event.type === "error") {
        if (event.fatal) result.fatalErrors += 1;
        continue;
      }
      if (event.type !== "final") continue;
      if (
        translation.finalDedupeKey &&
        !acceptDeepgramFinal(seenFinals, translation.finalDedupeKey)
      ) {
        continue;
      }
      result.acceptedFinals.push(event.transcript);
      const routed = router.handleFinalTranscript(event.transcript);
      for (const decision of routed.decisions) {
        const parsed = parseIntentCanvasCommand(decision.command, {
          activationPolicy: "externally_activated",
        });
        result.commandKinds.push(
          parsed.status === "parsed"
            ? parsed.command.kind
            : `${parsed.status}:${parsed.issue.code}`,
        );
      }
    }
  }
  return result;
}

function compare(actual, expected) {
  const problems = [];
  for (const key of [
    "connected",
    "configured",
    "acceptedFinals",
    "commandKinds",
    "fatalErrors",
  ]) {
    if (JSON.stringify(actual[key]) !== JSON.stringify(expected[key])) {
      problems.push(
        `${key}: expected ${JSON.stringify(expected[key])}, received ${JSON.stringify(actual[key])}`,
      );
    }
  }
  return problems;
}
