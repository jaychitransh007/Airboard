#!/usr/bin/env node

import { pathToFileURL } from "node:url";

import {
  applyDiagramCommand,
  applyDiagramUndo,
  createInitialBoardState,
  parseSemanticPlan,
} from "../packages/core/src/index.ts";
import { commitCommandTurn } from "../apps/web/src/features/board/commandTurnCoordinator.ts";
import {
  coordinateGestureFrame,
  GestureTraceJournal,
  reportGestureInferenceFailure,
} from "../apps/web/src/features/board/gestureFrameCoordinator.ts";
import { createRealtimeSpeechSession } from "../apps/web/src/features/board/realtimeSpeech.ts";
import { SnapGestureTracker } from "../apps/web/src/features/board/snapGestureTracker.ts";
import { evaluateInteractionCase } from "./lib/interaction-eval-harness.mjs";
import { executeInteractionEvalCase } from "./lib/interaction-eval-production-executor.mjs";

export const REQUIRED_SEEDED_FAULT_IDS = Object.freeze([
  "duplicate-final-transcript",
  "wrong-label-grounding",
  "stale-semantic-response",
  "malformed-model-output",
  "audio-frame-drop",
  "two-hand-false-blocking",
  "gesture-threshold-bypass",
  "camera-loss-during-grab",
  "inference-exception",
  "remote-event-race",
  "broken-undo",
]);

const EMPTY_BOARD = {
  boardId: "board:primary",
  nodes: [],
  edges: [],
  strokes: [],
};
const CHECKOUT_BOARD = {
  ...EMPTY_BOARD,
  nodes: [
    {
      id: "node:checkout",
      annotation: {
        type: "flow_node",
        nodeType: "service",
        label: "Checkout",
        bounds: { x: 100, y: 100, width: 152, height: 80 },
      },
    },
  ],
};
const CHECKOUT_AND_SHIPPING_BOARD = {
  ...EMPTY_BOARD,
  nodes: [
    CHECKOUT_BOARD.nodes[0],
    {
      id: "node:shipping",
      annotation: {
        type: "flow_node",
        nodeType: "service",
        label: "Shipping",
        bounds: { x: 400, y: 100, width: 152, height: 80 },
      },
    },
  ],
};

/**
 * Run every required seeded fault against a production seam and then ask the
 * shared InteractionEvalCase evaluator to distinguish the healthy control from
 * the fault. A declared component is never enough: the invocation recorder is
 * populated only by the wrappers that actually call production code.
 */
export async function runSeededFaultTrials() {
  const results = [];
  for (const trial of trialDefinitions()) {
    const recorder = createInvocationRecorder();
    let observations;
    try {
      observations = await trial.exercise(recorder);
    } catch (error) {
      const evidenceProvenance = {
        ...buildEvidenceProvenance(
          trial,
          recorder,
          describeError(error),
        ),
        productionSeamInvoked: false,
      };
      results.push({
        id: trial.id,
        healthyPassed: false,
        faultDetected: false,
        intendedCheck: trial.intendedCheck,
        failedChecks: [],
        productionSeamInvoked: false,
        evidenceProvenance,
        error: describeError(error),
      });
      continue;
    }

    const evidenceProvenance = buildEvidenceProvenance(trial, recorder);
    const healthyObservation = {
      ...observations.healthy,
      evidenceProvenance: {
        ...evidenceProvenance,
        phase: "healthy",
      },
    };
    const faultObservation = {
      ...observations.fault,
      evidenceProvenance: {
        ...evidenceProvenance,
        phase: "fault",
      },
    };
    const healthy = evaluateInteractionCase(
      trial.evalCase,
      healthyObservation,
    );
    const fault = evaluateInteractionCase(trial.evalCase, faultObservation);
    const intendedCheck = fault.checks.find(
      ({ id }) => id === trial.intendedCheck,
    );
    const productionSeamInvoked =
      evidenceProvenance.productionSeamInvoked === true;
    results.push({
      id: trial.id,
      healthyPassed:
        productionSeamInvoked && healthy.status === "passed",
      faultDetected:
        productionSeamInvoked &&
        fault.status === "failed" &&
        intendedCheck?.status === "failed",
      intendedCheck: trial.intendedCheck,
      intendedCheckStatus: intendedCheck?.status ?? "missing",
      failedChecks: fault.checks
        .filter(({ status }) => status === "failed")
        .map(({ id }) => id),
      productionSeamInvoked,
      evidenceProvenance,
    });
  }
  return results;
}

export function validateProductionSeamEvidence(requiredByPhase, observedByPhase) {
  const missingByPhase = {};
  for (const phase of ["healthy", "fault"]) {
    const observed = new Set(observedByPhase?.[phase] ?? []);
    const missing = (requiredByPhase?.[phase] ?? []).filter(
      (component) => !observed.has(component),
    );
    if (missing.length > 0) missingByPhase[phase] = missing;
  }
  return {
    valid: Object.keys(missingByPhase).length === 0,
    missingByPhase,
  };
}

function trialDefinitions() {
  return [
    {
      id: "duplicate-final-transcript",
      intendedCheck: "grounded-command-exact-once",
      injection: {
        kind: "production-input",
        description:
          "The transcription provider delivers the same final transcript twice.",
      },
      requiredSeams: requiredSeams(
        [
          "executeInteractionEvalCase",
          "VoiceCommandRouter",
          "parseIntentCanvasCommand",
          "resolveIntentOperation",
          "commitCommandTurn",
        ],
        ["executeInteractionEvalCase", "VoiceCommandRouter"],
      ),
      evalCase: evalCase("duplicate-final-transcript", {
        outcome: "applied",
        requiredActions: [
          {
            id: "grounded-command-exact-once",
            match: { type: "node.create", label: "Checkout" },
            count: 1,
          },
        ],
      }),
      async exercise(recorder) {
        const base = voiceCreateCase("duplicate-final-transcript");
        return {
          healthy: await executeProductionCase(recorder, "healthy", base),
          fault: await executeProductionCase(recorder, "fault", {
            ...base,
            interaction: {
              channel: "voice",
              input: {},
              sequence: [
                {
                  atMs: 0,
                  type: "transcript",
                  transcript: "Airo, add a service named Checkout",
                },
                {
                  atMs: 10,
                  type: "transcript",
                  transcript: "Airo, add a service named Checkout",
                },
              ],
            },
          }),
        };
      },
    },
    {
      id: "wrong-label-grounding",
      intendedCheck: "unique-label-grounding",
      injection: {
        kind: "production-output-mutation",
        description:
          "A correctly parsed and grounded rename has its unique object ID corrupted before commit.",
      },
      requiredSeams: requiredSeams(
        [
          "executeInteractionEvalCase",
          "parseIntentCanvasCommand",
          "resolveIntentOperation",
          "commitCommandTurn",
        ],
        [
          "executeInteractionEvalCase",
          "parseIntentCanvasCommand",
          "resolveIntentOperation",
          "commitCommandTurn",
          "applyDiagramUndo",
        ],
      ),
      evalCase: evalCase("wrong-label-grounding", {
        outcome: "applied",
        requiredActions: [
          {
            id: "unique-label-grounding",
            match: { type: "object.rename", objectId: "node:checkout" },
          },
        ],
      }),
      async exercise(recorder) {
        const input = voiceRenameCase("wrong-label-grounding");
        const healthy = await executeProductionCase(
          recorder,
          "healthy",
          input,
        );
        const faultBase = await executeProductionCase(
          recorder,
          "fault",
          input,
        );
        const command = {
          ...faultBase.groundedCommands[0],
          objectId: "node:shipping",
        };
        const committed = await recorder.invoke(
          "fault",
          "commitCommandTurn",
          () =>
            commitCommandTurn({
              snapshot: {
                boardState: faultBase.initialBoardState,
                selectionIds: [],
              },
              currentState: faultBase.initialBoardState,
              currentSelectionIds: [],
              commands: [command],
              contextForCommand: seededCommandContext(
                "wrong-label-grounding",
              ),
            }),
        );
        if (committed.status !== "applied") {
          throw new Error("The corrupted grounding did not reach commit.");
        }
        const undone = await recorder.invoke(
          "fault",
          "applyDiagramUndo",
          () =>
            applyDiagramUndo(
              committed.state,
              { undoEvents: committed.undoEvents },
              seededContext("wrong-label-grounding-undo", 0),
            ),
        );
        return {
          healthy,
          fault: {
            ...faultBase,
            groundedCommands: [command],
            finalBoardState: committed.state,
            events: committed.events,
            undoBoardState: undone.state,
            undoEvents: undone.events,
          },
        };
      },
    },
    {
      id: "stale-semantic-response",
      intendedCheck: "stale-response-must-not-apply",
      injection: {
        kind: "production-coordinator-bypass",
        description:
          "The stale snapshot is incorrectly refreshed just before the semantic command commits.",
      },
      requiredSeams: requiredSeams(
        ["applyDiagramCommand", "commitCommandTurn"],
        ["applyDiagramCommand", "commitCommandTurn"],
      ),
      evalCase: evalCase("stale-semantic-response", {
        outcome: "rejected",
        forbiddenActions: [
          {
            id: "stale-response-must-not-apply",
            match: { type: "node.create" },
          },
        ],
      }),
      async exercise(recorder) {
        const healthy = await exerciseStaleCommit(
          recorder,
          "healthy",
          false,
        );
        const fault = await exerciseStaleCommit(recorder, "fault", true);
        return { healthy, fault };
      },
    },
    {
      id: "malformed-model-output",
      intendedCheck: "stage-outcomes",
      injection: {
        kind: "production-output-mutation",
        description:
          "The semantic schema validator rejects malformed actions, then its rejection result is flipped to accepted.",
      },
      requiredSeams: requiredSeams(
        ["parseSemanticPlan"],
        ["parseSemanticPlan"],
      ),
      evalCase: evalCase("malformed-model-output", {
        outcome: "error",
        stageOutcomes: {
          semantic_validation: { status: "rejected", mutationCount: 0 },
        },
      }),
      async exercise(recorder) {
        const malformed = {
          contractVersion: "1.1",
          status: "resolved",
          actions: "not-an-array",
        };
        const healthyParse = await recorder.invoke(
          "healthy",
          "parseSemanticPlan",
          () => parseSemanticPlan(malformed),
        );
        const faultParse = await recorder.invoke(
          "fault",
          "parseSemanticPlan",
          () => parseSemanticPlan(malformed),
        );
        const common = emptyObservation();
        return {
          healthy: {
            ...common,
            outcome: healthyParse.ok ? "applied" : "error",
            semanticPlan: malformed,
            stageOutcomes: {
              semantic_validation: {
                status: healthyParse.ok ? "accepted" : "rejected",
                mutationCount: 0,
              },
            },
          },
          fault: {
            ...common,
            outcome: "error",
            semanticPlan: faultParse.ok ? faultParse.value : malformed,
            stageOutcomes: {
              semantic_validation: {
                status: "accepted",
                mutationCount: 0,
              },
            },
          },
        };
      },
    },
    {
      id: "audio-frame-drop",
      intendedCheck: "stage-outcomes",
      injection: {
        kind: "production-input",
        description:
          "WebSocket backpressure stays over the production bound while eight PCM frames arrive.",
      },
      requiredSeams: requiredSeams(
        ["createRealtimeSpeechSession"],
        ["createRealtimeSpeechSession"],
      ),
      evalCase: evalCase("audio-frame-drop", {
        outcome: "applied",
        stageOutcomes: {
          audio_transport: { droppedFrames: 0, finalized: true },
        },
      }),
      async exercise(recorder) {
        const healthyTransport = await recorder.invoke(
          "healthy",
          "createRealtimeSpeechSession",
          () => exerciseRealtimeTransport(false),
        );
        const faultTransport = await recorder.invoke(
          "fault",
          "createRealtimeSpeechSession",
          () => exerciseRealtimeTransport(true),
        );
        const common = emptyObservation();
        return {
          healthy: {
            ...common,
            outcome: "applied",
            stageOutcomes: { audio_transport: healthyTransport },
          },
          fault: {
            ...common,
            outcome: "applied",
            stageOutcomes: { audio_transport: faultTransport },
          },
        };
      },
    },
    {
      id: "two-hand-false-blocking",
      intendedCheck: "route",
      injection: {
        kind: "production-stage-adapter",
        description:
          "A navigation participant falsely claims a two-hand manipulation frame.",
      },
      requiredSeams: requiredSeams(
        ["coordinateGestureFrame"],
        ["coordinateGestureFrame"],
      ),
      evalCase: evalCase("two-hand-false-blocking", {
        outcome: "applied",
        route: { gestureOwner: "manipulation", handsDetected: 2 },
      }),
      async exercise(recorder) {
        const healthyOwner = await coordinateSeededGesture(
          recorder,
          "healthy",
          "manipulation",
        );
        const faultOwner = await coordinateSeededGesture(
          recorder,
          "fault",
          "navigation",
        );
        const common = emptyObservation();
        return {
          healthy: {
            ...common,
            outcome: "applied",
            route: {
              gestureOwner: healthyOwner,
              handsDetected: 2,
            },
          },
          fault: {
            ...common,
            outcome: "applied",
            route: {
              gestureOwner: faultOwner,
              handsDetected: 2,
            },
          },
        };
      },
    },
    {
      id: "gesture-threshold-bypass",
      intendedCheck: "visibility-must-not-fire",
      injection: {
        kind: "production-config",
        description:
          "The shipped snap recognizer is run with a lowered hand-confidence threshold.",
      },
      requiredSeams: requiredSeams(
        ["SnapGestureTracker.update"],
        ["SnapGestureTracker.update"],
      ),
      evalCase: evalCase("gesture-threshold-bypass", {
        outcome: "no-op",
        forbiddenActions: [
          {
            id: "visibility-must-not-fire",
            match: { type: "gesture.visibility_toggle" },
          },
        ],
      }),
      async exercise(recorder) {
        const healthySnap = await recorder.invoke(
          "healthy",
          "SnapGestureTracker.update",
          () => exerciseSnapThreshold(),
        );
        const bypassedSnap = await recorder.invoke(
          "fault",
          "SnapGestureTracker.update",
          () => exerciseSnapThreshold({ minConfidence: 0.4 }),
        );
        const common = emptyObservation();
        return {
          healthy: {
            ...common,
            outcome: healthySnap ? "applied" : "no-op",
            groundedCommands: healthySnap
              ? [{ type: "gesture.visibility_toggle" }]
              : [],
          },
          fault: {
            ...common,
            outcome: bypassedSnap ? "applied" : "no-op",
            groundedCommands: bypassedSnap
              ? [{ type: "gesture.visibility_toggle" }]
              : [],
          },
        };
      },
    },
    {
      id: "camera-loss-during-grab",
      intendedCheck: "final-board-state",
      injection: {
        kind: "production-compensation-bypass",
        description:
          "Camera loss occurs after a production move, but the production Undo compensation is omitted.",
      },
      requiredSeams: requiredSeams(
        [
          "executeInteractionEvalCase",
          "commitCommandTurn",
          "applyDiagramUndo",
        ],
        [
          "executeInteractionEvalCase",
          "commitCommandTurn",
          "applyDiagramUndo",
        ],
      ),
      evalCase: evalCase("camera-loss-during-grab", {
        outcome: "no-op",
        finalBoardState: CHECKOUT_BOARD,
        stageOutcomes: {
          camera: { status: "lost", interaction: "cancelled" },
        },
      }),
      async exercise(recorder) {
        const healthyMove = await executeProductionCase(
          recorder,
          "healthy",
          voiceMoveCase("camera-loss-during-grab-healthy"),
        );
        const faultMove = await executeProductionCase(
          recorder,
          "fault",
          voiceMoveCase("camera-loss-during-grab-fault"),
        );
        return {
          healthy: {
            ...healthyMove,
            outcome: "no-op",
            finalBoardState: healthyMove.undoBoardState,
            stageOutcomes: {
              camera: { status: "lost", interaction: "cancelled" },
            },
          },
          fault: {
            ...faultMove,
            outcome: "no-op",
            stageOutcomes: {
              camera: { status: "lost", interaction: "cancelled" },
            },
          },
        };
      },
    },
    {
      id: "inference-exception",
      intendedCheck: "inference-must-not-mutate",
      injection: {
        kind: "production-failure-output-leak",
        description:
          "A move leaks after the production perception failure and cancellation stages.",
      },
      requiredSeams: requiredSeams(
        [
          "executeInteractionEvalCase",
          "reportGestureInferenceFailure",
        ],
        [
          "executeInteractionEvalCase",
          "reportGestureInferenceFailure",
          "commitCommandTurn",
        ],
      ),
      evalCase: evalCase("inference-exception", {
        outcome: "error",
        forbiddenActions: [
          {
            id: "inference-must-not-mutate",
            match: { type: "objects.move" },
          },
        ],
        stageOutcomes: {
          perception: { status: "error", interaction: "cancelled" },
        },
      }),
      async exercise(recorder) {
        const healthyMove = await executeProductionCase(
          recorder,
          "healthy",
          voiceMoveCase("inference-exception-healthy"),
        );
        const faultMove = await executeProductionCase(
          recorder,
          "fault",
          voiceMoveCase("inference-exception-fault"),
        );
        const healthyPerception = await exerciseInferenceFailure(
          recorder,
          "healthy",
        );
        const faultPerception = await exerciseInferenceFailure(
          recorder,
          "fault",
        );
        return {
          healthy: {
            ...healthyMove,
            outcome: "error",
            finalBoardState: healthyMove.initialBoardState,
            groundedCommands: [],
            events: [],
            stageOutcomes: { perception: healthyPerception },
          },
          fault: {
            ...faultMove,
            outcome: "error",
            stageOutcomes: { perception: faultPerception },
          },
        };
      },
    },
    {
      id: "remote-event-race",
      intendedCheck: "remote-update-exact-once",
      injection: {
        kind: "production-input",
        description:
          "Two unique remote events race through the production reducer for one logical label update.",
      },
      requiredSeams: requiredSeams(
        ["executeInteractionEvalCase", "applyBoardEvent"],
        ["executeInteractionEvalCase", "applyBoardEvent"],
      ),
      evalCase: evalCase("remote-event-race", {
        outcome: "applied",
        exactOnce: [
          {
            id: "remote-update-exact-once",
            match: {
              type: "stroke.label_updated",
              strokeId: "node:checkout",
            },
            count: 1,
          },
        ],
      }),
      async exercise(recorder) {
        const base = remoteLabelCase("remote-event-race", [
          labelEvent("remote-1"),
        ]);
        return {
          healthy: await executeProductionCase(recorder, "healthy", base),
          fault: await executeProductionCase(
            recorder,
            "fault",
            remoteLabelCase("remote-event-race-fault", [
              labelEvent("remote-1"),
              labelEvent("remote-2"),
            ]),
          ),
        };
      },
    },
    {
      id: "broken-undo",
      intendedCheck: "undo-board-round-trip",
      injection: {
        kind: "production-output-mutation",
        description:
          "A production command and Undo run, then the observed Undo state is replaced with the pre-Undo state.",
      },
      requiredSeams: requiredSeams(
        [
          "executeInteractionEvalCase",
          "commitCommandTurn",
          "applyDiagramUndo",
        ],
        [
          "executeInteractionEvalCase",
          "commitCommandTurn",
          "applyDiagramUndo",
        ],
      ),
      evalCase: evalCase("broken-undo", {
        outcome: "applied",
        undoRoundTrip: {
          board: true,
          nonBoard: false,
          requireUndoEvents: true,
        },
      }),
      async exercise(recorder) {
        const input = voiceCreateCase("broken-undo");
        const healthy = await executeProductionCase(
          recorder,
          "healthy",
          input,
        );
        const faultBase = await executeProductionCase(
          recorder,
          "fault",
          input,
        );
        return {
          healthy,
          fault: {
            ...faultBase,
            undoBoardState: faultBase.finalBoardState,
          },
        };
      },
    },
  ];
}

function requiredSeams(healthy, fault) {
  return { healthy, fault };
}

function createInvocationRecorder() {
  const observed = {
    healthy: new Set(),
    fault: new Set(),
  };
  return {
    async invoke(phase, component, callback) {
      observed[phase].add(component);
      return await callback();
    },
    observe(phase, components) {
      for (const component of components ?? []) {
        if (typeof component === "string" && component.length > 0) {
          observed[phase].add(component);
        }
      }
    },
    snapshot() {
      return {
        healthy: [...observed.healthy].sort(),
        fault: [...observed.fault].sort(),
      };
    },
  };
}

function buildEvidenceProvenance(trial, recorder, error) {
  const observedComponents = recorder.snapshot();
  const validation = validateProductionSeamEvidence(
    trial.requiredSeams,
    observedComponents,
  );
  return {
    class: "seeded-production-fault",
    productionSeamInvoked: validation.valid,
    requiredComponents: structuredClone(trial.requiredSeams),
    observedComponents,
    missingComponents: validation.missingByPhase,
    faultInjection: structuredClone(trial.injection),
    ...(error ? { error } : {}),
  };
}

async function executeProductionCase(recorder, phase, evalCaseValue) {
  const observation = await recorder.invoke(
    phase,
    "executeInteractionEvalCase",
    () => executeInteractionEvalCase(evalCaseValue),
  );
  recorder.observe(phase, observation.evidenceProvenance?.components);
  return observation;
}

async function exerciseStaleCommit(recorder, phase, bypassStaleness) {
  const initial = createInitialBoardState("board:primary");
  const current = await recorder.invoke(
    phase,
    "applyDiagramCommand",
    () =>
      applyDiagramCommand(
        initial,
        {
          type: "node.create",
          nodeId: "node:remote",
          nodeType: "service",
          label: "Remote",
          center: { x: 100, y: 100 },
        },
        seededContext(`stale-${phase}-remote`, 0),
      ).state,
  );
  const command = {
    type: "node.create",
    nodeId: "node:stale",
    nodeType: "service",
    label: "Stale",
    center: { x: 400, y: 100 },
  };
  const commit = await recorder.invoke(
    phase,
    "commitCommandTurn",
    () =>
      commitCommandTurn({
        snapshot: {
          boardState: bypassStaleness ? current : initial,
          selectionIds: [],
        },
        currentState: current,
        currentSelectionIds: [],
        commands: [command],
        contextForCommand: seededCommandContext(`stale-${phase}`),
      }),
  );
  if (!bypassStaleness && commit.status !== "stale") {
    throw new Error("Production coordinator did not reject the stale snapshot.");
  }
  if (bypassStaleness && commit.status !== "applied") {
    throw new Error("Seeded stale-context bypass did not commit.");
  }
  return {
    ...emptyObservation(),
    initialBoardState: current,
    finalBoardState: commit.status === "applied" ? commit.state : current,
    outcome: commit.status === "applied" ? "applied" : "rejected",
    groundedCommands: commit.status === "applied" ? [command] : [],
    events: commit.status === "applied" ? commit.events : [],
    stageOutcomes: {
      transaction: {
        status: commit.status === "applied" ? "committed" : "stale",
        eventCount: commit.status === "applied" ? commit.events.length : 0,
      },
    },
  };
}

async function coordinateSeededGesture(recorder, phase, winner) {
  let manipulationRuns = 0;
  const result = await recorder.invoke(
    phase,
    "coordinateGestureFrame",
    () =>
      coordinateGestureFrame({
        interactionId: `two-hand-${phase}`,
        timestampMs: 100,
        handsDetected: 2,
        stages: {
          navigation: { update: () => winner === "navigation" },
          snap: { update: () => false },
          voice: { observe: () => undefined },
          manipulation: {
            run: () => {
              manipulationRuns += 1;
            },
          },
        },
      }),
  );
  if (winner === "manipulation" && manipulationRuns !== 1) {
    throw new Error("Production manipulation stage did not receive the frame.");
  }
  return result.owner;
}

async function exerciseInferenceFailure(recorder, phase) {
  const journal = new GestureTraceJournal();
  await recorder.invoke(
    phase,
    "reportGestureInferenceFailure",
    () =>
      reportGestureInferenceFailure(
        {
          interactionId: `inference-${phase}`,
          timestampMs: 200,
          report: journal.append,
        },
        new RangeError("seeded inference failure"),
      ),
  );
  const events = journal.snapshot();
  const health = events.find(
    (event) => event.stage === "perception_health",
  );
  const cancellation = events.find(
    (event) => event.stage === "cancellation",
  );
  return {
    status: health?.data.status,
    interaction: cancellation ? "cancelled" : "active",
    code: health?.data.code,
  };
}

async function exerciseRealtimeTransport(congested) {
  const socket = new SeededRealtimeSocket();
  let pcmHandlers;
  let dropWarningCount = 0;
  const endReasons = [];
  const session = createRealtimeSpeechSession(
    {
      onFinal() {},
      onAudioDropped: () => {
        dropWarningCount += 1;
      },
      onEnd: (reason) => endReasons.push(reason),
    },
    {
      url: "ws://seeded.test/transcription/ws",
      maxBufferedBytes: 100,
    },
    {
      createWebSocket: () => socket,
      startPcmInput: async (handlers) => {
        pcmHandlers = handlers;
        return { stop() {} };
      },
    },
  );
  if (!session) {
    throw new Error("Production realtime speech session was unavailable.");
  }
  session.start();
  await nextTurn();
  socket.open();
  socket.serverMessage({
    type: "transcription.ready",
    provider: "seeded",
    model: "seeded",
    sampleRate: 16_000,
  });
  await nextTurn();
  if (!pcmHandlers || !session.isListening()) {
    throw new Error("Production PCM input did not enter the listening state.");
  }

  socket.bufferedAmount = congested ? 100 : 0;
  const inputFrames = 8;
  for (let index = 0; index < inputFrames; index += 1) {
    pcmHandlers.onChunk(new Float32Array(1_280), 16_000);
  }
  const sentFrames = socket.sent.filter(
    (entry) => entry instanceof ArrayBuffer,
  ).length;
  session.abort();
  return {
    inputFrames,
    sentFrames,
    droppedFrames: inputFrames - sentFrames,
    dropWarningCount,
    finalized: endReasons.length === 1,
  };
}

class SeededRealtimeSocket {
  binaryType = "blob";
  bufferedAmount = 0;
  readyState = 0;
  sent = [];
  listeners = new Map();

  addEventListener(type, listener) {
    const listeners = this.listeners.get(type) ?? [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }

  send(value) {
    this.sent.push(value);
  }

  close(code = 1000, reason = "") {
    if (this.readyState >= 2) return;
    this.readyState = 3;
    this.emit("close", { code, reason });
  }

  open() {
    this.readyState = 1;
    this.emit("open", {});
  }

  serverMessage(message) {
    this.emit("message", { data: JSON.stringify(message) });
  }

  emit(type, event) {
    for (const listener of this.listeners.get(type) ?? []) {
      listener(event);
    }
  }
}

function exerciseSnapThreshold(config = {}) {
  const tracker = new SnapGestureTracker(config);
  const outputs = [
    tracker.update(snapFrame([snapHand({ contact: true })], 0)),
    tracker.update(snapFrame([snapHand({ contact: true })], 40)),
    tracker.update(
      snapFrame([snapHand({ contact: false, middleX: 0.59 })], 140),
    ),
  ];
  return outputs.includes("snap");
}

function snapHand({ contact, middleX = 0.5 }) {
  const points = Array.from(
    { length: 21 },
    () => ({ x: 0.5, y: 0.6, z: 0 }),
  );
  points[0] = { x: 0.5, y: 0.82, z: 0 };
  points[5] = { x: 0.42, y: 0.64, z: 0 };
  points[6] = { x: 0.42, y: 0.5, z: 0 };
  points[8] = { x: 0.4, y: 0.3, z: 0 };
  points[9] = { x: 0.5, y: 0.62, z: 0 };
  points[10] = { x: 0.5, y: 0.49, z: 0 };
  points[12] = { x: middleX, y: 0.36, z: 0 };
  points[13] = { x: 0.56, y: 0.64, z: 0 };
  points[14] = { x: 0.57, y: 0.51, z: 0 };
  points[16] = { x: 0.58, y: 0.32, z: 0 };
  points[17] = { x: 0.63, y: 0.67, z: 0 };
  points[18] = { x: 0.65, y: 0.54, z: 0 };
  points[20] = { x: 0.67, y: 0.38, z: 0 };
  points[4] = contact
    ? { x: middleX + 0.005, y: 0.365, z: 0 }
    : { x: 0.31, y: 0.47, z: 0 };
  return {
    handedness: "Right",
    // Deliberately below the shipped 0.72 minimum.
    confidence: 0.5,
    landmarks: points,
  };
}

function snapFrame(hands, timestampMs) {
  return { hands, timestampMs, suppressed: false };
}

function voiceCreateCase(id) {
  return {
    id,
    surface: "replay",
    initial: {
      boardState: EMPTY_BOARD,
      nonBoardState: { selection: [] },
      pointer: { x: 450, y: 300 },
    },
    interaction: {
      channel: "voice",
      input: {
        transcript: "Airo, add a service named Checkout",
      },
    },
  };
}

function voiceRenameCase(id) {
  return {
    id,
    surface: "replay",
    initial: {
      boardState: CHECKOUT_AND_SHIPPING_BOARD,
      nonBoardState: { selection: [] },
    },
    interaction: {
      channel: "voice",
      input: {
        activation: "ptt",
        transcript: "Rename Checkout to Payments",
      },
    },
  };
}

function voiceMoveCase(id) {
  return {
    id,
    surface: "replay",
    initial: {
      boardState: CHECKOUT_BOARD,
      nonBoardState: { selection: ["node:checkout"] },
    },
    interaction: {
      channel: "voice",
      input: {
        activation: "ptt",
        transcript: "move selected right",
      },
    },
  };
}

function remoteLabelCase(id, events) {
  return {
    id,
    surface: "replay",
    initial: {
      boardState: CHECKOUT_BOARD,
      nonBoardState: {},
    },
    interaction: {
      channel: "remote",
      sequence: events.map((event, index) => ({
        atMs: index * 10,
        type: "remote_board_event",
        event,
      })),
    },
  };
}

function emptyObservation() {
  return {
    initialBoardState: EMPTY_BOARD,
    finalBoardState: EMPTY_BOARD,
    initialNonBoardState: {},
    finalNonBoardState: {},
    groundedCommands: [],
    events: [],
    durationMs: 10,
  };
}

function evalCase(id, expected) {
  return {
    schemaVersion: "interaction-eval-case.v1",
    id,
    title: id,
    capabilities: ["contract:forbidden-mutations"],
    interaction: { channel: "replay", input: { seededFault: id } },
    expected,
  };
}

function labelEvent(id) {
  return {
    id,
    boardSessionId: "board:primary",
    actorParticipantId: "participant:remote",
    createdAt: "2026-07-30T00:00:00.000Z",
    type: "stroke.label_updated",
    strokeId: "node:checkout",
    label: "Payments",
  };
}

function seededCommandContext(caseId) {
  return (commandIndex) => seededContext(caseId, commandIndex);
}

function seededContext(caseId, commandIndex) {
  let eventIndex = 0;
  let objectIndex = 0;
  return {
    boardSessionId: "board:primary",
    actorParticipantId: "participant:eval",
    userId: "user:eval",
    createdAt: "2026-07-30T00:00:00.000Z",
    eventIdFactory: () =>
      `event:${caseId}:${commandIndex}:${++eventIndex}`,
    objectIdFactory: () =>
      `object:${caseId}:${commandIndex}:${++objectIndex}`,
  };
}

function nextTurn() {
  return new Promise((resolve) => setImmediate(resolve));
}

function describeError(error) {
  return error instanceof Error ? error.message : String(error);
}

async function main() {
  const results = await runSeededFaultTrials();
  for (const result of results) {
    const passed =
      result.healthyPassed &&
      result.faultDetected &&
      result.productionSeamInvoked;
    console.log(
      `${passed ? "PASS" : "FAIL"} ${result.id} -> ${result.intendedCheck} ` +
        `[production=${result.productionSeamInvoked ? "observed" : "missing"}]`,
    );
    if (!result.productionSeamInvoked) {
      console.log(
        `  missing: ${JSON.stringify(result.evidenceProvenance.missingComponents)}`,
      );
    }
  }
  const failed = results.filter(
    ({ healthyPassed, faultDetected, productionSeamInvoked }) =>
      !healthyPassed || !faultDetected || !productionSeamInvoked,
  );
  console.log(
    `Seeded production faults: ${results.length - failed.length}/${results.length} detected`,
  );
  if (failed.length) process.exitCode = 1;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  await main();
}
