#!/usr/bin/env node

/**
 * Offline deterministic contract matrix.
 *
 * The checked-in corpus remains human-reviewable; this runner expands every
 * case across routing/metamorphic variants so the PR gate exercises more than
 * 600 turns without copying hundreds of near-identical JSON objects.
 */

import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  AIRBOARD_SEMANTIC_NODE_CAPABILITIES,
} from "../packages/core/src/semanticCapabilities.ts";
import {
  classifyBrowserWakeTranscript,
  normalizeScopedVoiceUtterance,
} from "../apps/web/src/features/board/browserSpeech.ts";
import {
  parseIntentCanvasCommand,
} from "../apps/web/src/features/board/intentCanvasParser.ts";
import {
  assertAllGrammarGapScenariosExecuted,
  compareGrammarExpectation,
  prepareGrammarEvalCorpus,
} from "./lib/grammar-eval-corpus.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const fixturePath = resolve(
  process.cwd(),
  process.argv[2] ?? resolve(ROOT, "evals/voice-intent/deterministic-positives.v1.json"),
);

const variants = [
  { id: "original", transform: (text) => text, channel: "typed" },
  { id: "uppercase", transform: (text) => text.toLocaleUpperCase("en-US"), channel: "ptt" },
  { id: "punctuated", transform: (text) => `${text}.`, channel: "wake" },
  {
    id: "whitespace",
    transform: (text) => `  ${text.replace(/\s+/g, "   ")}  `,
    channel: "typed",
  },
  { id: "courtesy", transform: (text) => `please, ${text}`, channel: "ptt" },
];

main().catch((error) => {
  console.error(
    `Contract matrix could not start: ${error instanceof Error ? error.message : String(error)}`,
  );
  process.exitCode = 2;
});

async function main() {
  const corpus = JSON.parse(await readFile(fixturePath, "utf8"));
  const prepared = prepareGrammarEvalCorpus(corpus);

  const expanded = prepared.allCases.flatMap((fixtureCase) =>
    variants.map((variant) => ({
      id: `${fixtureCase.id}::${variant.id}`,
      fixtureCase,
      variant,
    })),
  );
  if (expanded.length < 600) {
    throw new Error(`Contract matrix must contain at least 600 cases; found ${expanded.length}.`);
  }

  const failures = [];
  const channels = new Map();
  const executedGapScenarioIds = new Set();
  for (const expandedCase of expanded) {
    const { fixtureCase, variant } = expandedCase;
    let text = variant.transform(fixtureCase.text);
    let result;
    let effectiveChannel = variant.channel;

    if (fixtureCase.scoped) {
      text = normalizeScopedVoiceUtterance(text);
      effectiveChannel = "scoped";
      result = parseIntentCanvasCommand(text, {
        activationPolicy: "externally_activated",
      });
    } else if (variant.channel === "wake") {
      const bare = stripLeadingWakePhrase(text);
      const classification = classifyBrowserWakeTranscript(`Airo, ${bare}`);
      const routed = classification.commands[0]?.command;
      result = routed
        ? parseIntentCanvasCommand(routed, {
            activationPolicy: "externally_activated",
          })
        : {
            status: "inactive",
            issue: { code: "wake_not_routed" },
          };
    } else {
      result = parseIntentCanvasCommand(text, {
        activationPolicy: "externally_activated",
      });
    }
    channels.set(effectiveChannel, (channels.get(effectiveChannel) ?? 0) + 1);
    const problems = compareGrammarExpectation(result, fixtureCase.expected, {
      variantId: variant.id,
      effectiveText: text,
    });
    if (problems.length > 0) {
      failures.push({ id: expandedCase.id, text, problems });
    }
    if (fixtureCase.knownGapId) {
      executedGapScenarioIds.add(fixtureCase.id);
    }
  }
  assertAllGrammarGapScenariosExecuted(
    prepared.knownGaps,
    executedGapScenarioIds,
  );

  const expectedNodeTypes = new Set(
    prepared.allCases.map((entry) => entry.expected?.nodeType).filter(Boolean),
  );
  const missingNodeTypes = AIRBOARD_SEMANTIC_NODE_CAPABILITIES
    .map(({ nodeType }) => nodeType)
    .filter((nodeType) => !expectedNodeTypes.has(nodeType));
  if (missingNodeTypes.length > 0) {
    failures.push({
      id: "capability-coverage",
      text: "",
      problems: [`missing node types: ${missingNodeTypes.join(", ")}`],
    });
  }

  console.log(
    `Airboard deterministic contract matrix: ${expanded.length - failures.length}/${expanded.length}`,
  );
  console.log(
    `Channels: ${[...channels.entries()].map(([key, value]) => `${key}=${value}`).join(", ")}`,
  );
  console.log(`Node capabilities: ${expectedNodeTypes.size}/${AIRBOARD_SEMANTIC_NODE_CAPABILITIES.length}`);
  console.log(
    `Executable grammar gaps: ${prepared.knownGaps.length}/${corpus.knownGapCount} gaps, ${executedGapScenarioIds.size}/${prepared.gapCases.length} scenarios`,
  );
  for (const failure of failures.slice(0, 30)) {
    console.log(`  FAIL ${failure.id}${failure.text ? `: “${failure.text}”` : ""}`);
    for (const problem of failure.problems) {
      console.log(`     - ${problem}`);
    }
  }
  if (failures.length > 30) {
    console.log(`  … ${failures.length - 30} additional failures omitted`);
  }
  if (failures.length > 0) {
    process.exitCode = 1;
  }
}

function stripLeadingWakePhrase(text) {
  return text
    .trim()
    .replace(/^(?:(?:hey|okay|ok)\s+)?(?:airo|airboard)\b[\s,:;-]*/i, "");
}
