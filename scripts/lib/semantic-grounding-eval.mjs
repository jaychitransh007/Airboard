import {
  applyBoardEvent,
  applyDiagramCommand,
  applyDiagramUndo,
  connectorGeometryMatchesBindings,
  createInitialBoardState,
} from "../../packages/core/src/index.ts";
import { commitCommandTurn } from "../../apps/web/src/features/board/commandTurnCoordinator.ts";
import { resolveSemanticPlanAction } from "../../apps/web/src/features/board/intentPipeline.ts";
import { computeSemanticAutoLayout } from "../../apps/web/src/features/board/semanticAutoLayout.ts";
import {
  assessBoardSpatialQuality,
  inspectBoardSpatialQuality,
} from "../../packages/drawing-engine/src/spatialQuality.ts";
import {
  canonicalizeBoardEvents,
  canonicalizeBoardState,
  canonicalizeNonBoardState,
  createCanonicalizationContext,
} from "./interaction-eval-harness.mjs";

const BOARD_ID = "semantic-eval-board";
const PARTICIPANT_ID = "semantic-eval-participant";
const USER_ID = "semantic-eval-user";
const FIXED_TIME = "2026-07-30T00:00:00.000Z";

/**
 * Recreate the board snapshot sent to the semantic provider. The resulting
 * state is reduced through the production DiagramCommand implementation, so
 * grounding tests exercise the same annotation shapes as the application.
 */
export function seedBoardFromSemanticContext(semanticContext) {
  let state = createInitialBoardState(BOARD_ID);
  const objectIds = [];
  const objectIdBySummaryKey = new Map();

  for (const [index, object] of semanticContext.objects.entries()) {
    const nodeId = `seed-node-${index + 1}`;
    const position = pointValue(object.position, {
      x: 160 + (index % 4) * 220,
      y: 140 + Math.floor(index / 4) * 150,
    });
    const size = sizeValue(object.size, { width: 160, height: 92 });
    state = applyDiagramCommand(
      state,
      {
        type: "node.create",
        nodeId,
        nodeType: object.nodeType,
        label: object.label,
        bounds: {
          x: position.x - size.width / 2,
          y: position.y - size.height / 2,
          width: size.width,
          height: size.height,
        },
        source: "voice",
      },
      deterministicCommandContext(`seed-node-${index + 1}`),
    ).state;
    objectIds.push(nodeId);
    objectIdBySummaryKey.set(summaryKey(object), nodeId);
  }

  for (const [index, edge] of semanticContext.edges.entries()) {
    const fromId = findSummaryId(edge.from, semanticContext.objects, objectIds);
    const toId = findSummaryId(edge.to, semanticContext.objects, objectIds);
    if (!fromId || !toId) {
      throw new Error(
        `Semantic eval context edge ${index + 1} references an object absent from context.objects`,
      );
    }
    state = applyDiagramCommand(
      state,
      {
        type: "nodes.connect",
        connectorId: `seed-edge-${index + 1}`,
        fromId,
        toId,
        ...(typeof edge.label === "string" ? { label: edge.label } : {}),
        source: "voice",
      },
      deterministicCommandContext(`seed-edge-${index + 1}`),
    ).state;
    if (edge.seedGeometry?.start && edge.seedGeometry?.end) {
      const connectorId = `seed-edge-${index + 1}`;
      const current = state.strokes[connectorId];
      const annotation = {
        ...current.annotation,
        start: { ...edge.seedGeometry.start },
        end: { ...edge.seedGeometry.end },
      };
      if (edge.seedGeometry.snappedStart === false) {
        delete annotation.snappedStartStrokeId;
      }
      if (edge.seedGeometry.snappedEnd === false) {
        delete annotation.snappedEndStrokeId;
      }
      state = applyBoardEvent(state, {
        id: `seed-edge-geometry-${index + 1}`,
        boardSessionId: BOARD_ID,
        actorParticipantId: PARTICIPANT_ID,
        createdAt: FIXED_TIME,
        type: "stroke.annotation_updated",
        strokeId: connectorId,
        annotation,
        points: [
          { ...annotation.start, t: 1, inputSource: "pointer" },
          { ...annotation.end, t: 2, inputSource: "pointer" },
        ],
      });
    }
  }

  const selectedIds = [];
  for (const [index, object] of semanticContext.objects.entries()) {
    if (object.selected === true) selectedIds.push(objectIds[index]);
  }
  for (const selected of semanticContext.selected) {
    const id =
      objectIdBySummaryKey.get(summaryKey(selected)) ??
      findSummaryId(selected, semanticContext.objects, objectIds);
    if (id && !selectedIds.includes(id)) selectedIds.push(id);
  }

  return {
    state,
    objectIds,
    selectedIds,
    summaryIdMap: Object.fromEntries(
      semanticContext.objects.map((object, index) => [
        summaryKey(object),
        objectIds[index],
      ]),
    ),
  };
}

/**
 * Observe an orchestration-level supported no-op against the same canonical
 * board oracle used for executable semantic plans.
 */
export function evaluateSemanticNoChange(semanticContext) {
  const startedAt = performance.now();
  const seeded = seedBoardFromSemanticContext(semanticContext);
  const canonicalContext = createCanonicalizationContext({
    includeDeleted: false,
    ignoreFields: ["lastSequence"],
  });
  const boardState = canonicalizeBoardState(seeded.state, {
    context: canonicalContext,
  });
  return {
    status: "already_satisfied",
    mutationApplied: false,
    groundingError: null,
    commands: [],
    eventDelta: [],
    initialBoardState: boardState,
    finalBoardState: boardState,
    selectionIds: canonicalizeNonBoardState(seeded.selectedIds, {
      context: canonicalContext,
    }),
    effects: deriveBoardEffects(seeded.state, seeded.state),
    undo: {
      applicable: false,
      roundTripPassed: true,
      eventCount: 0,
    },
    timings: {
      groundingMs: performance.now() - startedAt,
      actionMs: 0,
    },
  };
}

/**
 * Ground, preview, atomically commit, and undo a production semantic plan.
 *
 * This intentionally mirrors AirboardPrototype.prepareSemanticActionPlan:
 * actions see the evolving preview state and plan handles; the final command
 * list is then committed as one command-turn transaction.
 */
export function evaluateGroundedSemanticPlan(plan, semanticContext) {
  const startedAt = performance.now();
  const seeded = seedBoardFromSemanticContext(semanticContext);
  const initialState = seeded.state;
  const initialSelectionIds = seeded.selectedIds;
  const canonicalContext = createCanonicalizationContext({
    includeDeleted: false,
    ignoreFields: ["lastSequence"],
  });
  const initialBoardState = canonicalizeBoardState(initialState, {
    context: canonicalContext,
  });

  if (plan.status !== "resolved") {
    return {
      status: "not_applied",
      mutationApplied: false,
      groundingError: null,
      commands: [],
      eventDelta: [],
      initialBoardState,
      finalBoardState: initialBoardState,
      selectionIds: canonicalizeNonBoardState(initialSelectionIds, {
        context: canonicalContext,
      }),
      effects: deriveBoardEffects(initialState, initialState),
      undo: {
        applicable: false,
        roundTripPassed: true,
        eventCount: 0,
      },
      timings: {
        groundingMs: performance.now() - startedAt,
        actionMs: 0,
      },
    };
  }

  if (
    plan.actions.some(
      (action) => action.type === "undo" || action.type === "cancel",
    )
  ) {
    const validImmediate =
      plan.actions.length === 1 &&
      (plan.actions[0]?.type === "undo" || plan.actions[0]?.type === "cancel");
    return {
      status: validImmediate ? "immediate_action" : "grounding_failed",
      mutationApplied: false,
      groundingError: validImmediate
        ? null
        : "Undo and cancel must be requested as separate actions.",
      immediateAction: validImmediate ? plan.actions[0].type : null,
      commands: [],
      eventDelta: [],
      initialBoardState,
      finalBoardState: initialBoardState,
      selectionIds: canonicalizeNonBoardState(initialSelectionIds, {
        context: canonicalContext,
      }),
      effects: deriveBoardEffects(initialState, initialState),
      undo: {
        applicable: false,
        roundTripPassed: validImmediate,
        eventCount: 0,
      },
      timings: {
        groundingMs: performance.now() - startedAt,
        actionMs: 0,
      },
    };
  }

  const pointer = pointValue(semanticContext.pointer, { x: 450, y: 300 });
  const canvasWidth =
    finitePositive(semanticContext.canvasWidth) ?? 900;
  const canvasHeight =
    finitePositive(semanticContext.canvasHeight) ?? 600;
  const viewOrigin = pointValue(semanticContext.viewOrigin, { x: 0, y: 0 });
  const hoverStrokeId = semanticContext.hoverObject
    ? findSummaryId(
        semanticContext.hoverObject,
        semanticContext.objects,
        seeded.objectIds,
      )
    : null;
  let previewState = initialState;
  const referenceSelectionIds = [...initialSelectionIds];
  const referencePrimarySelectionId =
    referenceSelectionIds[referenceSelectionIds.length - 1] ?? null;
  let workingSelectionIds = [...initialSelectionIds];
  let workingPrimarySelectionId =
    workingSelectionIds[workingSelectionIds.length - 1] ?? null;
  const autoCreateCenters = computeSemanticAutoLayout({
    actions: plan.actions,
    boardState: initialState,
    canvasWidth,
    canvasHeight,
    viewOrigin,
  });
  const planHandles = new Map();
  const commands = [];

  for (const [actionIndex, action] of plan.actions.entries()) {
    const resolved = resolveSemanticPlanAction(
      action,
      {
        boardState: previewState,
        pointer,
        pointerAvailable: semanticContext.pointerAvailable === true,
        canvasWidth,
        canvasHeight,
        viewOrigin,
        autoCreateCenters,
        selectionIds: referenceSelectionIds,
        primarySelectionId: referencePrimarySelectionId,
        hoverStrokeId,
        strokeColor: "#111111",
      },
      planHandles,
    );
    if ("error" in resolved) {
      return groundingFailure({
        error: resolved.error,
        startedAt,
        initialBoardState,
        initialSelectionIds,
        canonicalContext,
        commands,
        initialState,
        actionIndex,
        actionType: action.type,
      });
    }
    if (commands.length + resolved.commands.length > 40) {
      return groundingFailure({
        error: "The semantic plan expands to more than 40 diagram commands.",
        startedAt,
        initialBoardState,
        initialSelectionIds,
        canonicalContext,
        commands,
        initialState,
        actionIndex,
        actionType: action.type,
      });
    }
    for (const [commandIndex, command] of resolved.commands.entries()) {
      try {
        previewState = applyDiagramCommand(
          previewState,
          command,
          deterministicCommandContext(
            `preview-${actionIndex + 1}-${commandIndex + 1}`,
          ),
        ).state;
      } catch (error) {
        return groundingFailure({
          error: error instanceof Error ? error.message : String(error),
          startedAt,
          initialBoardState,
          initialSelectionIds,
          canonicalContext,
          commands: [...commands, ...resolved.commands],
          initialState,
          actionIndex,
          actionType: action.type,
        });
      }
    }
    commands.push(...resolved.commands);
    for (const [handle, ids] of Object.entries(
      resolved.handleAssignments ?? {},
    )) {
      planHandles.set(handle, ids);
    }
    if (resolved.selectionAfter) {
      workingSelectionIds = resolved.selectionAfter.filter(
        (strokeId) => previewState.strokes[strokeId]?.status === "committed",
      );
      workingPrimarySelectionId =
        workingSelectionIds[workingSelectionIds.length - 1] ?? null;
    }
  }

  const groundedAt = performance.now();
  if (commands.length === 0) {
    return {
      status: "applied",
      mutationApplied: false,
      groundingError: null,
      commands: [],
      eventDelta: [],
      initialBoardState,
      finalBoardState: initialBoardState,
      selectionIds: canonicalizeNonBoardState(workingSelectionIds, {
        context: canonicalContext,
      }),
      effects: deriveBoardEffects(initialState, initialState),
      undo: {
        applicable: false,
        roundTripPassed: true,
        eventCount: 0,
      },
      timings: {
        groundingMs: groundedAt - startedAt,
        actionMs: performance.now() - groundedAt,
      },
    };
  }

  let eventCounter = 0;
  let commit;
  try {
    commit = commitCommandTurn({
      snapshot: {
        boardState: initialState,
        selectionIds: initialSelectionIds,
      },
      currentState: initialState,
      currentSelectionIds: initialSelectionIds,
      commands,
      requestedSelectionIds: workingSelectionIds,
      contextForCommand: (commandIndex) => ({
        boardSessionId: BOARD_ID,
        actorParticipantId: PARTICIPANT_ID,
        userId: USER_ID,
        createdAt: FIXED_TIME,
        eventIdFactory: () =>
          `eval-event-${commandIndex + 1}-${++eventCounter}`,
        objectIdFactory: () =>
          `eval-object-${commandIndex + 1}-${eventCounter + 1}`,
      }),
    });
  } catch (error) {
    return groundingFailure({
      error: error instanceof Error ? error.message : String(error),
      startedAt,
      initialBoardState,
      initialSelectionIds,
      canonicalContext,
      commands,
      initialState,
      actionIndex: plan.actions.length - 1,
      actionType: plan.actions.at(-1)?.type ?? "unknown",
    });
  }
  if (commit.status !== "applied") {
    return groundingFailure({
      error: "The semantic command transaction was unexpectedly stale.",
      startedAt,
      initialBoardState,
      initialSelectionIds,
      canonicalContext,
      commands,
      initialState,
      actionIndex: plan.actions.length - 1,
      actionType: plan.actions.at(-1)?.type ?? "unknown",
    });
  }

  const undone = applyDiagramUndo(commit.state, {
    undoEvents: commit.undoEvents,
  });
  const finalBoardState = canonicalizeBoardState(commit.state, {
    context: canonicalContext,
  });
  const undoBoardState = canonicalizeBoardState(undone.state, {
    context: canonicalContext,
  });
  const actionCompletedAt = performance.now();
  return {
    status: "applied",
    mutationApplied: commit.events.length > 0,
    groundingError: null,
    commands: canonicalizeNonBoardState(commands, {
      context: canonicalContext,
    }),
    eventDelta: canonicalizeBoardEvents(commit.events, {
      context: canonicalContext,
    }),
    initialBoardState,
    finalBoardState,
    selectionIds: canonicalizeNonBoardState(commit.selectionIds, {
      context: canonicalContext,
    }),
    effects: deriveBoardEffects(initialState, commit.state),
    undo: {
      applicable: commit.undoEvents.length > 0,
      roundTripPassed:
        JSON.stringify(undoBoardState) === JSON.stringify(initialBoardState),
      eventCount: commit.undoEvents.length,
      boardState: undoBoardState,
    },
    timings: {
      groundingMs: groundedAt - startedAt,
      actionMs: actionCompletedAt - groundedAt,
    },
  };
}

export function validateGroundedSemanticOutcome(
  grounded,
  expected,
  expectedStatus,
) {
  const failures = [];
  if (expectedStatus !== "resolved") {
    if (grounded.mutationApplied || grounded.eventDelta.length > 0) {
      failures.push(
        `${expectedStatus} semantic result emitted ${grounded.eventDelta.length} board event(s)`,
      );
    }
  } else if (grounded.status === "grounding_failed") {
    failures.push(
      `production grounding rejected the plan: ${grounded.groundingError}`,
    );
    return failures;
  } else if (
    grounded.undo.applicable &&
    grounded.undo.roundTripPassed !== true
  ) {
    failures.push("one-step Undo did not restore the initial normalized board");
  }

  const constraints = expected.finalState;
  if (
    expected.selectionCount !== undefined &&
    grounded.selectionIds.length !== expected.selectionCount
  ) {
    failures.push(
      `expected selection count ${expected.selectionCount}, received ${grounded.selectionIds.length}`,
    );
  }
  if (!constraints) return failures;
  const effects = grounded.effects;
  compareOptionalDelta(
    constraints.nodeCountDelta,
    effects.nodeCountDelta,
    "node count delta",
    failures,
  );
  compareOptionalDelta(
    constraints.edgeCountDelta,
    effects.edgeCountDelta,
    "edge count delta",
    failures,
  );
  validateEntityConstraints(
    constraints.requiredNodes,
    effects.finalNodes,
    "required node",
    true,
    failures,
  );
  validateEntityConstraints(
    constraints.forbiddenNodes,
    effects.finalNodes,
    "forbidden node",
    false,
    failures,
  );
  validateEntityConstraints(
    constraints.requiredEdges,
    effects.finalEdges,
    "required edge",
    true,
    failures,
  );
  validateEntityConstraints(
    constraints.forbiddenEdges,
    effects.finalEdges,
    "forbidden edge",
    false,
    failures,
  );
  validateEntityConstraints(
    constraints.requiredDeletedNodes,
    effects.deletedNodes,
    "required deleted node",
    true,
    failures,
  );
  validateEntityConstraints(
    constraints.requiredDeletedEdges,
    effects.deletedEdges,
    "required deleted edge",
    true,
    failures,
  );
  if (constraints.spatialConstraints !== undefined) {
    const spatial = assessBoardSpatialQuality(
      effects.spatialFacts,
      constraints.spatialConstraints,
    );
    for (const violation of spatial.violations) {
      failures.push(`spatial ${violation.kind}: ${violation.message}`);
    }
  }
  return failures;
}

function groundingFailure({
  error,
  startedAt,
  initialBoardState,
  initialSelectionIds,
  canonicalContext,
  commands,
  initialState,
  actionIndex,
  actionType,
}) {
  return {
    status: "grounding_failed",
    mutationApplied: false,
    groundingError: error,
    failedAction: { index: actionIndex, type: actionType },
    commands: canonicalizeNonBoardState(commands, {
      context: canonicalContext,
    }),
    eventDelta: [],
    initialBoardState,
    finalBoardState: initialBoardState,
    selectionIds: canonicalizeNonBoardState(initialSelectionIds, {
      context: canonicalContext,
    }),
    effects: deriveBoardEffects(initialState, initialState),
    undo: {
      applicable: false,
      roundTripPassed: true,
      eventCount: 0,
    },
    timings: {
      groundingMs: performance.now() - startedAt,
      actionMs: 0,
    },
  };
}

export function deriveBoardEffects(initialState, finalState) {
  const initialNodes = semanticNodes(initialState);
  const finalNodes = semanticNodes(finalState);
  const initialEdges = semanticEdges(initialState);
  const finalEdges = semanticEdges(finalState);
  return {
    nodeCountDelta: finalNodes.length - initialNodes.length,
    edgeCountDelta: finalEdges.length - initialEdges.length,
    finalNodes,
    finalEdges,
    deletedNodes: initialNodes.filter(
      (initial) => !finalNodes.some((final) => final.id === initial.id),
    ),
    deletedEdges: initialEdges.filter(
      (initial) => !finalEdges.some((final) => final.id === initial.id),
    ),
    spatialFacts: inspectBoardSpatialQuality(finalState),
  };
}

function semanticNodes(state) {
  const nodes = Object.values(state.strokes)
    .filter(
      (stroke) =>
        stroke.status === "committed" &&
        stroke.annotation?.bounds &&
        stroke.annotation.type !== "connector" &&
        stroke.annotation.type !== "arrow",
    )
    .map((stroke) => ({
      id: stroke.id,
      label: stroke.annotation.label ?? null,
      nodeType:
        stroke.annotation.nodeType ?? stroke.annotation.type,
      x:
        stroke.annotation.bounds.x +
        stroke.annotation.bounds.width / 2,
      y:
        stroke.annotation.bounds.y +
        stroke.annotation.bounds.height / 2,
    }))
    .sort(
      (left, right) =>
        left.y - right.y ||
        left.x - right.x ||
        String(left.id).localeCompare(String(right.id)),
    );
  const ordinalsByType = new Map();
  return nodes.map((node) => {
    const ordinal = (ordinalsByType.get(node.nodeType) ?? 0) + 1;
    ordinalsByType.set(node.nodeType, ordinal);
    return { ...node, ordinal };
  });
}

function semanticEdges(state) {
  const nodes = new Map(
    semanticNodes(state).map((node) => [node.id, node]),
  );
  const edges = Object.values(state.strokes)
    .filter(
      (stroke) =>
        stroke.status === "committed" &&
        (stroke.annotation?.type === "connector" ||
          stroke.annotation?.type === "arrow"),
    )
    .map((stroke) => ({
      id: stroke.id,
      label: stroke.annotation.label ?? null,
      from: endpointSummary(
        nodes.get(stroke.annotation.snappedStartStrokeId),
      ),
      to: endpointSummary(
        nodes.get(stroke.annotation.snappedEndStrokeId),
      ),
      geometryAttached: connectorGeometryMatchesBindings(
        state,
        stroke.annotation,
      ),
    }))
    .sort((left, right) => String(left.id).localeCompare(String(right.id)));
  const occurrenceByEndpoints = new Map();
  return edges.map((edge) => {
    const key = `${edge.from?.id ?? ""}\u0000${edge.to?.id ?? ""}`;
    const occurrence = (occurrenceByEndpoints.get(key) ?? 0) + 1;
    occurrenceByEndpoints.set(key, occurrence);
    return { ...edge, occurrence };
  });
}

function validateEntityConstraints(
  constraints,
  entities,
  description,
  required,
  failures,
) {
  if (!Array.isArray(constraints)) return;
  for (const constraint of constraints) {
    const count = entities.filter((entity) =>
      partialSemanticMatch(entity, constraint),
    ).length;
    const expectedCount =
      Number.isInteger(constraint.count) && constraint.count >= 0
        ? constraint.count
        : 1;
    if (required ? count < expectedCount : count > 0) {
      failures.push(
        `${description} ${JSON.stringify(constraint)} ${
          required
            ? `matched ${count}; expected at least ${expectedCount}`
            : `matched ${count}; expected none`
        }`,
      );
    }
  }
}

function compareOptionalDelta(expected, actual, description, failures) {
  if (expected !== undefined && expected !== actual) {
    failures.push(`expected ${description} ${expected}, received ${actual}`);
  }
}

function normalizedEqual(actual, expected) {
  if (typeof actual === "string" || typeof expected === "string") {
    return normalizeText(actual) === normalizeText(expected);
  }
  return actual === expected;
}

function partialSemanticMatch(actual, expected) {
  if (
    typeof expected !== "object" ||
    expected === null ||
    Array.isArray(expected)
  ) {
    return normalizedEqual(actual, expected);
  }
  if (typeof actual !== "object" || actual === null) return false;
  const positionTolerance =
    typeof expected.positionTolerance === "number" &&
    Number.isFinite(expected.positionTolerance)
      ? expected.positionTolerance
      : 0;
  return Object.entries(expected)
    .filter(
      ([key]) =>
        key !== "count" && key !== "positionTolerance",
    )
    .every(([key, value]) => {
      if (
        (key === "x" || key === "y") &&
        typeof value === "number" &&
        typeof actual[key] === "number"
      ) {
        return Math.abs(actual[key] - value) <= positionTolerance;
      }
      return partialSemanticMatch(actual[key], value);
    });
}

function normalizeText(value) {
  return String(value ?? "").normalize("NFKC").trim().toLowerCase();
}

function findSummaryId(reference, objects, objectIds) {
  const exactKey = summaryKey(reference);
  const exactIndex = objects.findIndex(
    (object) => summaryKey(object) === exactKey,
  );
  if (exactIndex >= 0) return objectIds[exactIndex];
  const candidates = objects
    .map((object, index) => ({ object, id: objectIds[index] }))
    .filter(
      ({ object }) =>
        normalizeText(object.label) === normalizeText(reference.label) &&
        normalizeText(object.nodeType) === normalizeText(reference.nodeType),
    );
  if (Number.isInteger(reference.ordinal) && reference.ordinal > 0) {
    return candidates.find(
      ({ object }) => object.ordinal === reference.ordinal,
    )?.id;
  }
  return candidates.length === 1 ? candidates[0].id : null;
}

function summaryKey(summary) {
  return [
    normalizeText(summary.label),
    normalizeText(summary.nodeType),
    Number.isInteger(summary.ordinal) ? summary.ordinal : "",
  ].join("\u0000");
}

function deterministicCommandContext(scope) {
  let event = 0;
  let object = 0;
  return {
    boardSessionId: BOARD_ID,
    actorParticipantId: PARTICIPANT_ID,
    userId: USER_ID,
    createdAt: FIXED_TIME,
    eventIdFactory: () => `${scope}-event-${++event}`,
    objectIdFactory: () => `${scope}-object-${++object}`,
  };
}

function pointValue(value, fallback) {
  return {
    x: finiteNumber(value?.x) ?? fallback.x,
    y: finiteNumber(value?.y) ?? fallback.y,
  };
}

function sizeValue(value, fallback) {
  return {
    width: finitePositive(value?.width) ?? fallback.width,
    height: finitePositive(value?.height) ?? fallback.height,
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

function endpointSummary(node) {
  return node
    ? {
        id: node.id,
        label: node.label,
        nodeType: node.nodeType,
        ordinal: node.ordinal,
      }
    : null;
}
