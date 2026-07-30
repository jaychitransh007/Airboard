import {
  parseIntentCanvasCommand,
} from "../../../apps/web/src/features/board/intentCanvasParser.ts";
import { createHash } from "node:crypto";
import {
  VoiceCommandRouter,
} from "../../../apps/web/src/features/board/voiceCommandRouter.ts";
import {
  evaluateDeterministicAudioActions,
} from "./action-eval.mjs";
import {
  evaluateGroundedSemanticPlan,
  validateGroundedSemanticOutcome,
} from "../semantic-grounding-eval.mjs";

/**
 * One transcript-to-action oracle shared by fake, provider-replay, and live
 * audio adapters. Action names come only from the production parser output.
 */
export function scoreAudioSttEvents(scenario, events, timing = {}) {
  const routing = routeFinalTranscripts(
    scenario,
    events
      .filter((event) => event.type === "final")
      .map((event) => event.transcript),
  );
  const boardOutcome = evaluateDeterministicAudioActions(
    scenario,
    routing.parsedOperations,
  );
  return finishAssessment({
    scenario,
    events,
    timing,
    routing,
    boardOutcome,
    semantic: null,
  });
}

/**
 * Production-equivalent transcript routing with optional semantic fallback.
 * The STT adapter is deliberately independent from the semantic adapter so
 * the same audio scenario and final-state oracle can run against fake,
 * recorded, or live providers.
 */
export async function scoreAudioSttEventsWithSemantic(
  scenario,
  events,
  timing = {},
  semanticAdapters = new Map(),
) {
  const finalTranscripts = events
    .filter((event) => event.type === "final")
    .map((event) => event.transcript);
  const routing = routeFinalTranscripts(scenario, finalTranscripts);
  let boardOutcome = evaluateDeterministicAudioActions(
    scenario,
    routing.parsedOperations,
  );
  const needsSemantic =
    routing.semanticRequests.length > 0 ||
    (routing.parsedOperations.length > 0 && !boardOutcome.passed);
  let semantic = null;

  if (needsSemantic) {
    const requests =
      routing.semanticRequests.length > 0
        ? routing.semanticRequests
        : routing.routedCommands.slice(0, 1).map((transcript) => ({
            transcript,
            parserIssue: "grounding_failed",
          }));
    if (requests.length !== 1 || routing.routeCount !== 1) {
      boardOutcome = failedBoardOutcome(
        boardOutcome,
        "Semantic audio evaluation requires exactly one routed command turn.",
      );
    } else {
      const adapterId =
        scenario.semanticAdapter ??
        (["live-websocket", "meet-bridge-replay"].includes(scenario.adapter)
          ? "live-api"
          : scenario.source?.fakeSemanticPlan
            ? "fake"
            : scenario.source?.semanticPlan ||
                scenario.source?.semanticProviderResponse
              ? "recorded-replay"
              : null);
      const adapter = adapterId
        ? semanticAdapters instanceof Map
          ? semanticAdapters.get(adapterId)
          : semanticAdapters.find(({ id }) => id === adapterId)
        : null;
      if (!adapter) {
        boardOutcome = failedBoardOutcome(
          boardOutcome,
          `Semantic fallback required, but semantic adapter ${adapterId ?? "none"} is unavailable.`,
        );
      } else {
        const semanticStartedAt = performance.now();
        const resolution = await adapter.resolve({
          scenario,
          interactionId: `audio-${scenario.id}`,
          transcript: requests[0].transcript,
          parserIssue: requests[0].parserIssue,
          context: scenario.context,
          pendingClarification: scenario.pendingClarification,
        });
        const expectedStatus =
          scenario.oracle.expectedSemanticStatus ??
          (scenario.oracle.expectedActions?.length > 0
            ? "resolved"
            : resolution.plan.status);
        const grounding = evaluateGroundedSemanticPlan(
          resolution.plan,
          scenario.context,
        );
        const semanticFailures = [];
        if (resolution.plan.status !== expectedStatus) {
          semanticFailures.push(
            `semantic status expected ${expectedStatus}, received ${resolution.plan.status}`,
          );
        }
        semanticFailures.push(
          ...validateGroundedSemanticOutcome(
            grounding,
            { finalState: scenario.finalState },
            expectedStatus,
          ),
        );
        const semanticActions = resolution.plan.actions.map(
          ({ type }) => type,
        );
        routing.actions = semanticActions;
        routing.parserOutcomes.push(
          `semantic:${resolution.plan.status}/${resolution.plan.issueCode}`,
        );
        boardOutcome = semanticBoardOutcome(
          grounding,
          semanticFailures,
        );
        semantic = {
          status: resolution.plan.status,
          issueCode: resolution.plan.issueCode,
          actionTypes: semanticActions,
          provider: resolution.provider,
          model: resolution.model,
          latencyMs:
            Number.isFinite(resolution.latencyMs)
              ? resolution.latencyMs
              : performance.now() - semanticStartedAt,
          retryCount: resolution.retryCount ?? 0,
          metadata: resolution.metadata ?? null,
        };
      }
    }
  }

  return finishAssessment({
    scenario,
    events,
    timing,
    routing,
    boardOutcome,
    semantic,
  });
}

function finishAssessment({
  scenario,
  events,
  timing,
  routing,
  boardOutcome,
  semantic,
}) {
  const finalEvents = events.filter((event) => event.type === "final");
  const fatalErrors = events.filter(
    (event) => event.type === "error" && event.fatal === true,
  );
  const transcripts = finalEvents.map((event) => event.transcript);
  const transcriptText = normalizeText(transcripts.join(" "));
  const expectedCriticalTokens = scenario.oracle.criticalTokens ?? [];
  const matchedCriticalTokens = expectedCriticalTokens.filter((token) =>
    containsPhrase(transcriptText, token),
  );
  const criticalTokenRecall =
    expectedCriticalTokens.length === 0
      ? 1
      : matchedCriticalTokens.length / expectedCriticalTokens.length;
  const criticalTokenRoles = Object.fromEntries(
    Object.entries(scenario.oracle.criticalTokenRoles ?? {}).map(
      ([role, tokens]) => {
        const matched = tokens.filter((token) =>
          containsPhrase(transcriptText, token),
        ).length;
        return [
          role,
          {
            expected: tokens.length,
            matched,
            recall: tokens.length === 0 ? 1 : matched / tokens.length,
          },
        ];
      },
    ),
  );

  const expectedActions = scenario.oracle.expectedActions ?? [];
  const actionScore = scoreMultiset(routing.actions, expectedActions);
  const failures = [];
  const minimumCriticalTokenRecall =
    scenario.oracle.minimumCriticalTokenRecall ??
    (expectedCriticalTokens.length > 0 ? 1 : 0);
  const minimumActionF1 =
    scenario.oracle.minimumActionF1 ??
    (scenario.oracle.expectedActions !== undefined ? 1 : 0);

  if (criticalTokenRecall < minimumCriticalTokenRecall) {
    const missing = expectedCriticalTokens.filter(
      (token) => !matchedCriticalTokens.includes(token),
    );
    failures.push(
      `critical-token recall ${formatScore(criticalTokenRecall)} is below ${formatScore(minimumCriticalTokenRecall)}; missing ${missing.join(", ")}`,
    );
  }
  if (actionScore.f1 < minimumActionF1) {
    failures.push(
      `routed-action F1 ${formatScore(actionScore.f1)} is below ${formatScore(minimumActionF1)}`,
    );
  }
  if (
    scenario.oracle.requireExactActions === true &&
    !actionScore.exact
  ) {
    failures.push(
      `routed actions expected ${JSON.stringify(expectedActions)}, received ${JSON.stringify(routing.actions)}`,
    );
  }
  if (
    Number.isInteger(scenario.oracle.expectedFinalCount) &&
    finalEvents.length !== scenario.oracle.expectedFinalCount
  ) {
    failures.push(
      `final count expected ${scenario.oracle.expectedFinalCount}, received ${finalEvents.length}`,
    );
  }
  if (
    Number.isInteger(scenario.oracle.maximumRoutedActions) &&
    routing.actions.length > scenario.oracle.maximumRoutedActions
  ) {
    failures.push(
      `routed action count ${routing.actions.length} exceeds ${scenario.oracle.maximumRoutedActions}`,
    );
  }
  if (typeof scenario.oracle.expectedRoutedCommandSha256 === "string") {
    const routedCommandHash =
      routing.routedCommands.length === 1
        ? sha256(routing.routedCommands[0])
        : null;
    if (routedCommandHash !== scenario.oracle.expectedRoutedCommandSha256) {
      failures.push(
        `routed command did not preserve the expected complete turn (received ${routing.routedCommands.length} command(s))`,
      );
    }
  }
  if (fatalErrors.length > 0 && scenario.oracle.allowFatalProviderError !== true) {
    failures.push(`provider emitted ${fatalErrors.length} fatal error event(s)`);
  }
  const observedProcessingPath = semantic
    ? "semantic"
    : routing.routeCount === 0
      ? "no_route"
      : "deterministic";
  if (
    scenario.processingPath &&
    observedProcessingPath !== scenario.processingPath
  ) {
    failures.push(
      `processing path expected ${scenario.processingPath}, received ${observedProcessingPath}`,
    );
  }
  failures.push(...boardOutcome.failures);
  const completedAtMs = performance.now();
  const endToActionMs =
    Number.isFinite(timing.audioEndedAtMs) &&
    (routing.parsedOperations.length > 0 || semantic?.status === "resolved") &&
    boardOutcome.passed
      ? Math.max(0, completedAtMs - timing.audioEndedAtMs)
      : null;

  return {
    passed: failures.length === 0,
    failures,
    finalCount: finalEvents.length,
    finalTranscriptCharacters: transcripts.map((transcript) => transcript.length),
    criticalTokens: {
      expected: expectedCriticalTokens.length,
      matched: matchedCriticalTokens.length,
      recall: criticalTokenRecall,
      roles: criticalTokenRoles,
    },
    routedActions: routing.actions,
    actionScore,
    routeCount: routing.routeCount,
    parserOutcomes: routing.parserOutcomes,
    fatalErrorCodes: fatalErrors.map((event) => event.code),
    boardOutcome,
    endToActionMs,
    semantic,
    processingPath: observedProcessingPath,
  };
}

function routeFinalTranscripts(scenario, transcripts) {
  let now = 1_000;
  const router = new VoiceCommandRouter({ now: () => now });
  if (scenario.channel === "ptt") {
    router.openGate({ mode: "ptt" });
  } else if (scenario.channel === "scoped") {
    router.openGate({ mode: "scoped", strokeId: "eval-scope" });
  }

  const actions = [];
  const parsedOperations = [];
  const parserOutcomes = [];
  const semanticRequests = [];
  const routedCommands = [];
  let routeCount = 0;
  for (const transcript of transcripts) {
    const routed = router.handleFinalTranscript(transcript);
    routeCount += routed.decisions.length;
    for (const decision of routed.decisions) {
      routedCommands.push(decision.command);
      const parsed = parseIntentCanvasCommand(decision.command, {
        activationPolicy: "externally_activated",
      });
      if (parsed.status === "parsed") {
        actions.push(parsed.command.kind);
        parsedOperations.push(parsed.command);
        parserOutcomes.push(`parsed:${parsed.command.kind}`);
      } else {
        parserOutcomes.push(`${parsed.status}:${parsed.issue.code}`);
        if (
          parsed.status !== "inactive" &&
          parsed.issue.code !== "empty_command" &&
          parsed.issue.code !== "activation_required"
        ) {
          semanticRequests.push({
            transcript: decision.command,
            parserIssue: parsed.issue.code,
          });
        }
      }
    }
    now += 1;
  }
  return {
    actions,
    parsedOperations,
    parserOutcomes,
    routeCount,
    semanticRequests,
    routedCommands,
  };
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function semanticBoardOutcome(grounding, failures) {
  return {
    passed: failures.length === 0,
    failures: [...new Set(failures)],
    groundedCommandCount: grounding.commands.length,
    boardEventCount: grounding.eventDelta.length,
    initialBoardState: grounding.initialBoardState,
    finalBoardState: grounding.finalBoardState,
    finalSelection: grounding.selectionIds,
    groundedCommands: grounding.commands,
    eventDelta: grounding.eventDelta,
    effects: grounding.effects,
    undoChecks: [
      {
        turnIndex: 0,
        operationKind: "semantic_plan",
        applicable: grounding.undo.applicable,
        roundTripPassed: grounding.undo.roundTripPassed,
        eventCount: grounding.undo.eventCount,
      },
    ],
  };
}

function failedBoardOutcome(boardOutcome, failure) {
  return {
    ...boardOutcome,
    passed: false,
    failures: [...new Set([...(boardOutcome.failures ?? []), failure])],
  };
}

function scoreMultiset(actual, expected) {
  const remaining = countBy(expected);
  let matches = 0;
  for (const value of actual) {
    if ((remaining.get(value) ?? 0) > 0) {
      matches += 1;
      remaining.set(value, remaining.get(value) - 1);
    }
  }
  const precision = actual.length === 0 ? (expected.length === 0 ? 1 : 0) : matches / actual.length;
  const recall = expected.length === 0 ? (actual.length === 0 ? 1 : 0) : matches / expected.length;
  const f1 =
    precision + recall === 0
      ? 0
      : (2 * precision * recall) / (precision + recall);
  return {
    precision,
    recall,
    f1,
    exact:
      actual.length === expected.length &&
      matches === expected.length,
  };
}

function countBy(values) {
  const counts = new Map();
  for (const value of values) {
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  return counts;
}

function containsPhrase(normalizedTranscript, phrase) {
  const normalizedPhrase = normalizeText(phrase);
  if (!normalizedPhrase) {
    return false;
  }
  return ` ${normalizedTranscript} `.includes(` ${normalizedPhrase} `);
}

function normalizeText(value) {
  return String(value)
    .normalize("NFKC")
    .toLocaleLowerCase("en-US")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .replace(/\s+/gu, " ");
}

function formatScore(value) {
  return value.toFixed(3);
}
