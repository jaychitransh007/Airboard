import {
  applyBoardEvent,
  applyDiagramCommand,
  applyDiagramUndo,
  createInitialBoardState,
  parseSemanticPlan,
} from "../../packages/core/src/index.ts";
import { commitCommandTurn } from "../../apps/web/src/features/board/commandTurnCoordinator.ts";
import { parseIntentCanvasCommand } from "../../apps/web/src/features/board/intentCanvasParser.ts";
import { resolveIntentOperation } from "../../apps/web/src/features/board/intentPipeline.ts";
import { VoiceCommandRouter } from "../../apps/web/src/features/board/voiceCommandRouter.ts";

const PRODUCTION_ROUTE_COMPONENTS = Object.freeze([
  "VoiceCommandRouter",
  "parseIntentCanvasCommand",
  "resolveIntentOperation",
  "commitCommandTurn",
  "applyDiagramUndo",
]);

/**
 * Execute an InteractionEvalCase without consulting its expected oracle.
 *
 * Voice transcripts enter the production router/parser/grounder/transaction
 * seams. Remote events enter the production reducer. Direct/gesture fixtures
 * that contain already-grounded DiagramCommands remain useful harness tests,
 * but are explicitly ineligible as release evidence.
 */
export async function executeInteractionEvalCase(evalCase) {
  const startedAt = performance.now();
  const initialBoardState = seedProjectedBoard(evalCase.initial?.boardState);
  const initialNonBoardState = structuredClone(
    evalCase.initial?.nonBoardState ?? {},
  );

  let observation;
  switch (evalCase.interaction?.channel) {
    case "voice":
      observation = executeVoiceInteraction(
        evalCase,
        initialBoardState,
        initialNonBoardState,
      );
      break;
    case "remote":
      observation = executeRemoteInteraction(
        evalCase,
        initialBoardState,
        initialNonBoardState,
      );
      break;
    default:
      observation = executeHarnessFixture(
        evalCase,
        initialBoardState,
        initialNonBoardState,
      );
      break;
  }

  return {
    ...observation,
    durationMs: Math.max(0, performance.now() - startedAt),
    versions: {
      semanticPlanContract: "production-imported",
      capabilityRegistry: "production-imported",
    },
    surface: evalCase.surface,
  };
}

function executeVoiceInteraction(
  evalCase,
  initialBoardState,
  initialNonBoardState,
) {
  let now = 1_000;
  const router = new VoiceCommandRouter({ now: () => now });
  const input = evalCase.interaction.input ?? {};
  if (input.activation === "ptt") {
    router.openGate({ mode: "ptt" });
  } else if (input.activation === "scoped") {
    router.openGate({
      mode: "scoped",
      ...(typeof input.strokeId === "string"
        ? { strokeId: input.strokeId }
        : {}),
    });
  }

  const transcriptInputs = timedTranscripts(evalCase);
  const decisions = [];
  let wakeDetected = false;
  for (const item of transcriptInputs) {
    now = 1_000 + item.atMs;
    const routed = router.handleFinalTranscript(item.transcript);
    wakeDetected ||= routed.wakeDetected;
    decisions.push(...routed.decisions);
  }

  if (decisions.length === 0) {
    return baseObservation({
      initialBoardState,
      initialNonBoardState,
      outcome: "no-op",
      route: {
        channel: "voice",
        activation: "none",
        routed: false,
        wakeDetected,
      },
      processingPath: ["voice", "route_rejected"],
      feedbackCategory: "inactive",
      evidenceProvenance: productionRouteEvidence({
        timedInputCount: transcriptInputs.length,
        components: ["VoiceCommandRouter"],
      }),
    });
  }

  let boardState = initialBoardState;
  let nonBoardState = structuredClone(initialNonBoardState);
  let selectionIds = selectionFrom(nonBoardState);
  let events = [];
  let undoEvents = [];
  let groundedCommands = [];
  let undoBoardState = initialBoardState;
  let outcome = "applied";
  let feedbackCategory = "success";
  let semanticPlan;
  const processingPath = ["voice", "deterministic_parser"];
  const routeDecision = decisions[0];
  const releaseEligible =
    decisions.length === 1 && input.semanticPlan === undefined;
  let stageOutcomes = {
    routing: {
      status: decisions.length === 1 ? "routed" : "duplicate_route",
      decisionCount: decisions.length,
    },
  };

  if (decisions.length !== 1) {
    outcome = "rejected";
    feedbackCategory = "error";
    processingPath.push("route_rejected");
  } else {
    const parsed = parseIntentCanvasCommand(routeDecision.command, {
      activationPolicy: "externally_activated",
    });
    if (parsed.status !== "parsed") {
      const semantic = semanticFixtureOutcome(input.semanticPlan);
      if (semantic) {
        semanticPlan = semantic.plan;
        outcome = semantic.outcome;
        feedbackCategory = semantic.feedbackCategory;
        nonBoardState = semantic.nonBoardState(nonBoardState);
        processingPath.push(
          "semantic_planner",
          semantic.plan.status,
        );
        stageOutcomes = {
          ...stageOutcomes,
          parser: {
            status: parsed.status,
            issueCode: parsed.issue.code,
          },
          semantic: {
            status: semantic.plan.status,
            issueCode: semantic.plan.issueCode,
          },
          transaction: { status: "not_started", eventCount: 0 },
        };
      } else {
        outcome =
          parsed.status === "clarification" ? "clarification" : "rejected";
        feedbackCategory =
          parsed.status === "clarification" ? "clarification" : "unsupported";
        processingPath.push(parsed.status);
        stageOutcomes = {
          ...stageOutcomes,
          parser: {
            status: parsed.status,
            issueCode: parsed.issue.code,
          },
          transaction: { status: "not_started", eventCount: 0 },
        };
      }
    } else {
      processingPath.push("grounding");
      const resolution = resolveIntentOperation(parsed.command, {
        boardState,
        pointer: pointerFrom(evalCase),
        canvasWidth: finitePositive(evalCase.initial?.viewport?.width) ?? 900,
        canvasHeight: finitePositive(evalCase.initial?.viewport?.height) ?? 600,
        selectionIds,
        primarySelectionId: selectionIds.at(-1) ?? null,
        hoverStrokeId:
          typeof evalCase.initial?.hoverStrokeId === "string"
            ? evalCase.initial.hoverStrokeId
            : null,
        strokeColor: "#111111",
      });
      if ("error" in resolution) {
        const semantic = semanticFixtureOutcome(input.semanticPlan);
        if (semantic) {
          semanticPlan = semantic.plan;
          outcome = semantic.outcome;
          feedbackCategory = semantic.feedbackCategory;
          nonBoardState = semantic.nonBoardState(nonBoardState);
          processingPath.push("semantic_planner", semantic.plan.status);
          stageOutcomes = {
            ...stageOutcomes,
            parser: { status: "parsed", operationKind: parsed.command.kind },
            grounding: { status: "rejected", reason: resolution.error },
            semantic: {
              status: semantic.plan.status,
              issueCode: semantic.plan.issueCode,
            },
            transaction: { status: "not_started", eventCount: 0 },
          };
        } else {
          outcome = "rejected";
          feedbackCategory = "error";
          processingPath.push("rejected");
          stageOutcomes = {
            ...stageOutcomes,
            parser: { status: "parsed", operationKind: parsed.command.kind },
            grounding: { status: "rejected", reason: resolution.error },
            transaction: { status: "not_started", eventCount: 0 },
          };
        }
      } else {
        const commit = commitCommandTurn({
          snapshot: { boardState, selectionIds },
          currentState: boardState,
          currentSelectionIds: selectionIds,
          commands: resolution.commands,
          ...(resolution.selectionAfter
            ? { requestedSelectionIds: resolution.selectionAfter }
            : {}),
          contextForCommand: (commandIndex) =>
            commandContext(evalCase.id, commandIndex),
        });
        if (commit.status !== "applied") {
          outcome = "rejected";
          feedbackCategory = "error";
          processingPath.push("stale_context_rejected");
          stageOutcomes = {
            ...stageOutcomes,
            parser: { status: "parsed", operationKind: parsed.command.kind },
            grounding: { status: "resolved" },
            transaction: { status: "stale", eventCount: 0 },
          };
        } else {
          boardState = commit.state;
          selectionIds = commit.selectionIds;
          nonBoardState = {
            ...nonBoardState,
            selection: [...selectionIds],
          };
          groundedCommands = structuredClone(resolution.commands);
          events = [...commit.events];
          undoEvents = [...commit.undoEvents];
          processingPath.push("atomic_transaction");
          stageOutcomes = {
            ...stageOutcomes,
            parser: { status: "parsed", operationKind: parsed.command.kind },
            grounding: {
              status: "resolved",
              commandCount: resolution.commands.length,
            },
            transaction: {
              status: "committed",
              eventCount: commit.events.length,
            },
          };
          if (undoEvents.length > 0) {
            const undone = applyDiagramUndo(
              boardState,
              { undoEvents },
              commandContext(evalCase.id, 99),
            );
            undoBoardState = undone.state;
            undoEvents = undone.events;
          }
        }
      }
    }
  }

  return baseObservation({
    initialBoardState,
    initialNonBoardState,
    finalBoardState: boardState,
    finalNonBoardState: nonBoardState,
    undoBoardState,
    undoNonBoardState: structuredClone(initialNonBoardState),
    events,
    undoEvents,
    groundedCommands,
    semanticPlan,
    outcome,
    route: {
      channel: "voice",
      activation: activationFromDecision(routeDecision),
      routed: decisions.length === 1,
      wakeDetected,
    },
    processingPath,
    feedbackCategory,
    stageOutcomes,
    evidenceProvenance: releaseEligible
      ? productionRouteEvidence({
          timedInputCount: transcriptInputs.length,
        })
      : input.semanticPlan !== undefined
        ? {
          class: "recorded-provider-fixture",
          releaseEligible: false,
          timedInput: true,
          timedInputCount: transcriptInputs.length,
          routeObservation: "production",
          outcomeObservation: "recorded_fixture",
          components: [
            "VoiceCommandRouter",
            "parseIntentCanvasCommand",
            "resolveIntentOperation",
            "parseSemanticPlan",
          ],
          reason:
            "A recorded semantic plan is suitable for offline regression but is not live release evidence.",
          }
        : {
            class: "production-route",
            releaseEligible: false,
            timedInput: true,
            timedInputCount: transcriptInputs.length,
            routeObservation: "production",
            outcomeObservation: "production",
            components: ["VoiceCommandRouter"],
            reason:
              "The production router emitted a non-singleton decision set, so this turn cannot support an exact-once release claim.",
          },
  });
}

function executeRemoteInteraction(
  evalCase,
  initialBoardState,
  initialNonBoardState,
) {
  let finalBoardState = initialBoardState;
  const events = [];
  const sequence = [...(evalCase.interaction.sequence ?? [])].sort(
    (left, right) => finiteNonNegative(left.atMs) - finiteNonNegative(right.atMs),
  );
  for (const item of sequence) {
    if (item.type !== "remote_board_event" || !item.event) continue;
    finalBoardState = applyBoardEvent(finalBoardState, item.event);
    events.push(structuredClone(item.event));
  }
  const applied = events.length > 0;
  return baseObservation({
    initialBoardState,
    initialNonBoardState,
    finalBoardState,
    events,
    outcome: applied ? "applied" : "no-op",
    route: {
      channel: "remote",
      activation: "direct",
      eventCount: events.length,
    },
    processingPath: ["remote", "board_event", "reducer"],
    feedbackCategory: applied ? "success" : "inactive",
    stageOutcomes: {
      reducer: {
        status: applied ? "applied" : "not_started",
        eventCount: events.length,
      },
    },
    evidenceProvenance: {
      class: "production-reducer",
      releaseEligible: false,
      timedInput: true,
      timedInputCount: sequence.length,
      routeObservation: "production_reducer",
      outcomeObservation: "production_reducer",
      components: ["applyBoardEvent"],
      reason:
        "Remote reducer evidence does not observe a local production input route.",
    },
  });
}

function executeHarnessFixture(
  evalCase,
  initialBoardState,
  initialNonBoardState,
) {
  let finalBoardState = initialBoardState;
  let finalNonBoardState = structuredClone(initialNonBoardState);
  let undoBoardState = initialBoardState;
  let undoEvents = [];
  let events = [];
  const sideEffects = [];
  const commands = structuredClone(evalCase.interaction.commands ?? []);

  if (commands.length > 0) {
    const initialSelectionIds = selectionFrom(initialNonBoardState);
    const commit = commitCommandTurn({
      snapshot: {
        boardState: initialBoardState,
        selectionIds: initialSelectionIds,
      },
      currentState: initialBoardState,
      currentSelectionIds: initialSelectionIds,
      commands,
      requestedSelectionIds: initialSelectionIds,
      contextForCommand: (commandIndex) =>
        commandContext(evalCase.id, commandIndex),
    });
    if (commit.status === "applied") {
      finalBoardState = commit.state;
      events = commit.events;
      undoEvents = commit.undoEvents;
      const undone = applyDiagramUndo(
        finalBoardState,
        { undoEvents },
        commandContext(evalCase.id, 99),
      );
      undoBoardState = undone.state;
      undoEvents = undone.events;
    }
  }

  if (evalCase.interaction.input?.gesture === "point-hold") {
    const objectId = evalCase.interaction.input.objectId;
    finalNonBoardState = {
      ...finalNonBoardState,
      selection: [objectId],
      mode: "selected",
    };
    sideEffects.push({ type: "selection.changed", objectId });
  }

  const changed = events.length > 0 || sideEffects.length > 0;
  return baseObservation({
    initialBoardState,
    initialNonBoardState,
    finalBoardState,
    finalNonBoardState,
    undoBoardState,
    undoNonBoardState: structuredClone(initialNonBoardState),
    events,
    undoEvents,
    groundedCommands: commands,
    sideEffects,
    outcome: changed ? "applied" : "no-op",
    route: fixtureRoute(evalCase),
    processingPath: fixtureProcessingPath(evalCase, changed),
    feedbackCategory:
      sideEffects.length > 0 ? "selection" : changed ? "success" : "inactive",
    stageOutcomes: {
      transaction: {
        status: events.length > 0 ? "committed" : "not_started",
        eventCount: events.length,
      },
    },
    evidenceProvenance: {
      class: "harness-fixture",
      releaseEligible: false,
      timedInput: Array.isArray(evalCase.interaction.sequence),
      timedInputCount: evalCase.interaction.sequence?.length ?? 1,
      routeObservation: "fixture_inferred",
      outcomeObservation: "production_reducer",
      components: ["commitCommandTurn", "applyDiagramUndo"],
      reason:
        "The harness received pre-grounded fixture commands and did not observe the production input route.",
    },
  });
}

function baseObservation({
  initialBoardState,
  initialNonBoardState,
  finalBoardState = initialBoardState,
  finalNonBoardState = initialNonBoardState,
  undoBoardState = initialBoardState,
  undoNonBoardState = initialNonBoardState,
  events = [],
  undoEvents = [],
  groundedCommands = [],
  sideEffects = [],
  semanticPlan,
  outcome,
  route,
  processingPath,
  feedbackCategory,
  stageOutcomes,
  evidenceProvenance,
}) {
  return {
    outcome,
    route,
    processingPath,
    groundedCommands,
    feedbackCategory,
    stageOutcomes,
    initialBoardState,
    finalBoardState,
    undoBoardState,
    initialNonBoardState,
    finalNonBoardState,
    undoNonBoardState,
    events,
    undoEvents,
    sideEffects,
    ...(semanticPlan ? { semanticPlan } : {}),
    evidenceProvenance,
  };
}

function productionRouteEvidence({
  timedInputCount,
  components = PRODUCTION_ROUTE_COMPONENTS,
}) {
  return {
    class: "production-route",
    releaseEligible: true,
    timedInput: true,
    timedInputCount,
    routeObservation: "production",
    outcomeObservation: "production",
    components: [...components],
  };
}

function semanticFixtureOutcome(input) {
  if (input === undefined) return null;
  const parsed = parseSemanticPlan(input);
  if (!parsed.ok) {
    throw new Error(
      `Recorded semantic plan is invalid at ${parsed.error.path}: ${parsed.error.message}`,
    );
  }
  const plan = parsed.value;
  if (plan.status === "resolved") {
    throw new Error(
      "Resolved recorded semantic plans must be executed by the semantic grounding evaluator.",
    );
  }
  return {
    plan,
    outcome: plan.status === "clarification" ? "clarification" : "rejected",
    feedbackCategory:
      plan.status === "clarification" ? "clarification" : "unsupported",
    nonBoardState: (state) =>
      plan.status === "clarification"
        ? {
            ...state,
            pendingClarification: {
              missingSlots: [...plan.missingSlots],
            },
          }
        : state,
  };
}

function timedTranscripts(evalCase) {
  const sequence = (evalCase.interaction.sequence ?? [])
    .filter(
      (item) =>
        item.type === "transcript" &&
        typeof item.transcript === "string",
    )
    .map((item) => ({
      atMs: finiteNonNegative(item.atMs),
      transcript: item.transcript,
    }));
  if (sequence.length > 0) {
    return sequence.sort((left, right) => left.atMs - right.atMs);
  }
  const transcript = evalCase.interaction.input?.transcript;
  return typeof transcript === "string"
    ? [{ atMs: 0, transcript }]
    : [];
}

function activationFromDecision(decision) {
  if (!decision) return "none";
  if (decision.channel === "wake") return "wake";
  if (decision.channel === "gated-ptt") return "ptt";
  if (decision.channel === "gated-scoped") return "scoped";
  return "none";
}

function fixtureRoute(evalCase) {
  const channel = evalCase.interaction.channel;
  if (channel === "gesture") {
    const gesture = evalCase.interaction.input?.gesture;
    return {
      channel,
      gestureOwner:
        gesture === "grab-drag-release" || gesture === "point-hold"
          ? "manipulation"
          : "unobserved",
    };
  }
  return { channel, activation: "direct" };
}

function fixtureProcessingPath(evalCase, changed) {
  const channel = evalCase.interaction.channel;
  if (channel === "gesture") {
    return [
      "camera_fixture",
      "landmark_fixture",
      "gesture_owner_fixture",
      evalCase.interaction.input?.gesture === "point-hold"
        ? "selection"
        : changed
          ? "atomic_transaction"
          : "no_op",
    ];
  }
  return [channel, "fixture_command", changed ? "atomic_transaction" : "no_op"];
}

function selectionFrom(nonBoardState) {
  const selection = nonBoardState?.selection;
  return Array.isArray(selection)
    ? selection.filter((value) => typeof value === "string")
    : [];
}

function pointerFrom(evalCase) {
  const pointer =
    evalCase.initial?.pointer ??
    evalCase.interaction.input?.pointer;
  return {
    x: finiteNumber(pointer?.x) ?? 450,
    y: finiteNumber(pointer?.y) ?? 300,
  };
}

function seedProjectedBoard(projected = {}) {
  let state = createInitialBoardState(projected.boardId ?? "board:primary");
  for (const [index, node] of (projected.nodes ?? []).entries()) {
    const annotation = node.annotation ?? {};
    const bounds = annotation.bounds;
    state = applyDiagramCommand(
      state,
      {
        type: "node.create",
        nodeId: node.id,
        nodeType: annotation.nodeType ?? "custom",
        label: annotation.label ?? node.id,
        ...(bounds
          ? { bounds }
          : { center: { x: 160 + index * 240, y: 180 } }),
        source: "voice",
      },
      commandContext("seed-node", index),
    ).state;
  }
  for (const [index, edge] of (projected.edges ?? []).entries()) {
    const annotation = edge.annotation ?? {};
    if (!annotation.snappedStartStrokeId || !annotation.snappedEndStrokeId) {
      continue;
    }
    state = applyDiagramCommand(
      state,
      {
        type: "nodes.connect",
        connectorId: edge.id,
        fromId: annotation.snappedStartStrokeId,
        toId: annotation.snappedEndStrokeId,
        ...(annotation.label ? { label: annotation.label } : {}),
        source: "voice",
      },
      commandContext("seed-edge", index),
    ).state;
  }
  return state;
}

function commandContext(caseId, index) {
  let eventIndex = 0;
  let objectIndex = 0;
  return {
    boardSessionId: "board:primary",
    actorParticipantId: "participant:eval",
    userId: "user:eval",
    createdAt: `2026-07-30T00:${String(index).padStart(2, "0")}:00.000Z`,
    eventIdFactory: () => `event:${caseId}:${index}:${++eventIndex}`,
    objectIdFactory: () => `object:${caseId}:${index}:${++objectIndex}`,
  };
}

function finiteNumber(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function finitePositive(value) {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? value
    : null;
}

function finiteNonNegative(value) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : 0;
}
