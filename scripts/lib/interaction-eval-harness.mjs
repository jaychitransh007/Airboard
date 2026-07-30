export const INTERACTION_EVAL_CASE_SCHEMA_VERSION = "interaction-eval-case.v1";
export const INTERACTION_EVAL_RESULT_SCHEMA_VERSION = "interaction-eval-result.v1";

export const DEFAULT_GEOMETRY_TOLERANCE = 0.5;

const LOGICAL_ID_PREFIXES = new Set([
  "board",
  "cursor",
  "edge",
  "erase",
  "event",
  "group",
  "node",
  "object",
  "participant",
  "stroke",
  "user",
]);

const BOARD_COLLECTION_KEYS = new Set([
  "nodes",
  "edges",
  "strokes",
  "activeNodes",
  "activeEdges",
  "activeStrokes",
]);

const RAW_BOARD_KEYS = new Set([
  "boardId",
  "strokes",
  "activeStrokes",
  "eraseActions",
  "participants",
  "cursors",
  "lastSequence",
  "clearedAt",
]);

const ID_ARRAY_KINDS = new Map([
  ["affectedStrokeIds", "object"],
  ["groupMemberStrokeIds", "node"],
  ["objectIds", "object"],
  ["participantIds", "participant"],
  ["selected", "object"],
  ["selectedIds", "object"],
  ["selectedObjectIds", "object"],
  ["selection", "object"],
  ["strokeIds", "object"],
  ["userIds", "user"],
]);

const ID_FIELD_KINDS = new Map([
  ["actorParticipantId", "participant"],
  ["boardId", "board"],
  ["boardSessionId", "board"],
  ["connectorId", "edge"],
  ["cursorId", "cursor"],
  ["eraseActionId", "erase"],
  ["fromId", "node"],
  ["groupId", "group"],
  ["nodeId", "node"],
  ["objectId", "object"],
  ["ownerUserId", "user"],
  ["participantId", "participant"],
  ["snappedEndStrokeId", "object"],
  ["snappedStartStrokeId", "object"],
  ["strokeId", "object"],
  ["toId", "node"],
  ["userId", "user"],
]);

const TIMESTAMP_FIELDS = new Set([
  "t",
  "timestamp",
  "timestampMs",
]);

const GEOMETRY_FIELDS = new Set([
  "x",
  "y",
  "width",
  "height",
]);

const POSITION_CONTAINERS = new Set([
  "bounds",
  "center",
  "delta",
  "end",
  "origin",
  "point",
  "points",
  "position",
  "size",
  "start",
]);

/**
 * A shared context keeps physical IDs and clock values stable across initial
 * state, emitted events, final state, and undo state.
 */
export function createCanonicalizationContext(options = {}) {
  const normalizedOptions = normalizeCanonicalizationOptions(options);
  const explicitIds = normalizeLogicalIdMap(normalizedOptions.logicalIds);
  const ids = new Map();
  const logicalOwners = new Map();
  const counters = new Map();
  const timestamps = new Map();

  const context = {
    __interactionEvalCanonicalizationContext: true,
    options: normalizedOptions,
    logicalId(value, kind = "object", preferred) {
      if (value === undefined || value === null || value === "") return value;
      const raw = String(value);
      if (ids.has(raw)) return ids.get(raw);

      const explicit = explicitIds.get(raw);
      if (explicit) {
        ids.set(raw, explicit);
        logicalOwners.set(explicit, raw);
        return explicit;
      }
      if (
        normalizedOptions.preserveLogicalIds &&
        looksLikeLogicalId(raw)
      ) {
        ids.set(raw, raw);
        logicalOwners.set(raw, raw);
        return raw;
      }

      const normalizedKind = normalizeIdKind(kind);
      const preferredBase = preferred
        ? normalizePreferredLogicalId(preferred, normalizedKind)
        : null;
      let logical = preferredBase;
      if (logical && logicalOwners.has(logical) && logicalOwners.get(logical) !== raw) {
        let suffix = 2;
        while (logicalOwners.has(`${logical}#${suffix}`)) suffix += 1;
        logical = `${logical}#${suffix}`;
      }
      if (!logical) {
        const next = (counters.get(normalizedKind) ?? 0) + 1;
        counters.set(normalizedKind, next);
        logical = `${normalizedKind}:${next}`;
      }

      ids.set(raw, logical);
      logicalOwners.set(logical, raw);
      return logical;
    },
    logicalTimestamp(value) {
      if (normalizedOptions.timestampMode === "preserve") return value;
      if (normalizedOptions.timestampMode === "omit") return undefined;
      if (typeof value === "string" && /^@time:\d+$/.test(value)) return value;
      const key = `${typeof value}:${String(value)}`;
      if (!timestamps.has(key)) timestamps.set(key, `@time:${timestamps.size + 1}`);
      return timestamps.get(key);
    },
    snapshot() {
      return {
        ids: Object.fromEntries(ids),
        timestamps: Object.fromEntries(timestamps),
      };
    },
  };

  return context;
}

/**
 * Convert BoardState into a deterministic semantic projection. Committed and
 * active diagram objects are separated into sorted node/edge collections.
 */
export function canonicalizeBoardState(boardState, options = {}) {
  if (boardState === undefined || boardState === null) return boardState;
  if (!isRecord(boardState)) {
    throw new TypeError("BoardState must be an object");
  }

  const context = contextFrom(options);
  if (!looksLikeRawBoardState(boardState)) {
    return canonicalizeProjectedBoardState(boardState, context);
  }

  seedBoardStateIdentities(boardState, context);
  const result = {};
  if (!isIgnoredField("boardId", "/boardId", context.options)) {
    result.boardId = context.logicalId(boardState.boardId, "board", "board:1");
  }

  const committed = partitionStrokes(boardState.strokes, context.options.includeDeleted);
  const active = partitionStrokes(boardState.activeStrokes, context.options.includeDeleted);
  result.nodes = committed.nodes
    .map((stroke) => canonicalizeStroke(stroke, context, "node"))
    .sort(compareEntityIds);
  result.edges = committed.edges
    .map((stroke) => canonicalizeStroke(stroke, context, "edge"))
    .sort(compareEntityIds);
  result.strokes = committed.strokes.map((stroke) =>
    canonicalizeStroke(stroke, context, "stroke"),
  ).sort(compareEntityIds);
  result.activeNodes = active.nodes
    .map((stroke) => canonicalizeStroke(stroke, context, "node"))
    .sort(compareEntityIds);
  result.activeEdges = active.edges
    .map((stroke) => canonicalizeStroke(stroke, context, "edge"))
    .sort(compareEntityIds);
  result.activeStrokes = active.strokes.map((stroke) =>
    canonicalizeStroke(stroke, context, "stroke"),
  ).sort(compareEntityIds);

  result.eraseActions = canonicalizeEntityRecord(
    boardState.eraseActions,
    context,
    "erase",
  );
  result.participants = canonicalizeEntityRecord(
    boardState.participants,
    context,
    "participant",
  );
  result.cursors = canonicalizeEntityRecord(boardState.cursors, context, "cursor");

  if (
    boardState.lastSequence !== undefined &&
    !isIgnoredField("lastSequence", "/lastSequence", context.options)
  ) {
    result.lastSequence = boardState.lastSequence;
  }
  if (
    boardState.clearedAt !== undefined &&
    context.options.timestampMode !== "omit" &&
    !isIgnoredField("clearedAt", "/clearedAt", context.options)
  ) {
    result.clearedAt = context.logicalTimestamp(boardState.clearedAt);
  }

  for (const key of Object.keys(boardState).sort()) {
    if (RAW_BOARD_KEYS.has(key) || isIgnoredField(key, `/${escapePointer(key)}`, context.options)) {
      continue;
    }
    result[key] = canonicalizeValue(boardState[key], context, {
      key,
      path: `/${escapePointer(key)}`,
    });
  }
  return omitUndefined(result);
}

/**
 * Canonicalize a BoardEvent stream while preserving application order.
 */
export function canonicalizeBoardEvents(events, options = {}) {
  if (!Array.isArray(events)) {
    throw new TypeError("BoardEvent delta must be an array");
  }
  const context = contextFrom(options);
  seedEventIdentities(events, context);
  return events.map((event) => canonicalizeBoardEvent(event, { context }));
}

export function canonicalizeBoardEvent(event, options = {}) {
  if (!isRecord(event)) throw new TypeError("BoardEvent must be an object");
  const context = contextFrom(options);
  seedEventIdentities([event], context);
  const result = {};

  for (const key of Object.keys(event).sort()) {
    const path = `/${escapePointer(key)}`;
    if (isIgnoredField(key, path, context.options)) continue;
    if (key === "id") {
      result.id = context.logicalId(event.id, "event");
    } else if (key === "createdAt") {
      if (context.options.timestampMode !== "omit") {
        result.createdAt = context.logicalTimestamp(event.createdAt);
      }
    } else if (key === "stroke" && isRecord(event.stroke)) {
      result.stroke = canonicalizeStroke(
        event.stroke,
        context,
        isConnector(event.stroke) ? "edge" : isSemanticObject(event.stroke) ? "node" : "stroke",
      );
    } else if (key === "eraseAction" && isRecord(event.eraseAction)) {
      result.eraseAction = canonicalizeValue(event.eraseAction, context, {
        entityKind: "erase",
        key,
        path,
      });
    } else {
      result[key] = canonicalizeValue(event[key], context, { key, path });
    }
  }
  return omitUndefined(result);
}

export const canonicalizeBoardEventDelta = canonicalizeBoardEvents;

/**
 * Return collection-aware BoardState changes plus the canonical event delta.
 */
export function canonicalizeBoardDelta(
  beforeBoardState,
  afterBoardState,
  events = [],
  options = {},
) {
  const context = contextFrom(options);
  const before = canonicalizeBoardState(beforeBoardState, { context });
  const after = canonicalizeBoardState(afterBoardState, { context });
  const delta = {};

  for (const collection of BOARD_COLLECTION_KEYS) {
    delta[collection] = diffEntityCollection(
      before?.[collection] ?? [],
      after?.[collection] ?? [],
      context.options,
    );
  }

  const beforeState = omitKeys(before, BOARD_COLLECTION_KEYS);
  const afterState = omitKeys(after, BOARD_COLLECTION_KEYS);
  delta.stateChanges = collectChangedPaths(beforeState, afterState);
  delta.events = canonicalizeBoardEvents(events, { context });
  return delta;
}

export const canonicalizeBoardStateDelta = canonicalizeBoardDelta;

/**
 * Canonicalize non-board state (selection, modal, meeting, telemetry, etc.)
 * with the same logical ID/timestamp context used for BoardState.
 */
export function canonicalizeNonBoardState(value, options = {}) {
  const context = contextFrom(options);
  return canonicalizeValue(value, context, { path: "" });
}

/**
 * Structural comparator with partial projections and field-aware geometry
 * tolerances. It returns differences instead of throwing so reports stay rich.
 */
export function compareCanonicalValues(actual, expected, options = {}) {
  const normalized = {
    mode: options.mode === "partial" ? "partial" : "exact",
    geometryTolerance:
      options.geometryTolerance ?? DEFAULT_GEOMETRY_TOLERANCE,
    ignoreFields: normalizeIgnoreFields(options.ignoreFields),
  };
  const differences = [];
  compareValueRecursive(actual, expected, "", normalized, differences);
  return {
    pass: differences.length === 0,
    differences,
  };
}

export function compareBoardStates(actualBoardState, expectedBoardState, options = {}) {
  const canonicalOptions = {
    ...options,
    context: undefined,
  };
  const actual = canonicalizeBoardState(actualBoardState, canonicalOptions);
  const expected = canonicalizeBoardState(expectedBoardState, canonicalOptions);
  const comparison = compareCanonicalValues(actual, expected, options);
  return { ...comparison, actual, expected };
}

export function compareNonBoardStates(actualState, expectedState, options = {}) {
  const actual = canonicalizeNonBoardState(actualState, options);
  const expected = canonicalizeNonBoardState(expectedState, options);
  const comparison = compareCanonicalValues(actual, expected, options);
  return { ...comparison, actual, expected };
}

/**
 * Detect changes under forbidden JSON Pointer or dot-path patterns. `*`
 * matches one path segment and `**` matches any descendant depth.
 */
export function checkForbiddenMutations(observation, rules = [], options = {}) {
  const normalizedRules = rules.map(normalizeForbiddenRule);
  const context = createCanonicalizationContext(options);
  const before = {
    boardState:
      observation.initialBoardState === undefined
        ? undefined
        : canonicalizeBoardState(observation.initialBoardState, { context }),
    nonBoardState:
      observation.initialNonBoardState === undefined
        ? undefined
        : canonicalizeNonBoardState(observation.initialNonBoardState, { context }),
  };
  const after = {
    boardState:
      observation.finalBoardState === undefined
        ? undefined
        : canonicalizeBoardState(observation.finalBoardState, { context }),
    nonBoardState:
      observation.finalNonBoardState === undefined
        ? undefined
        : canonicalizeNonBoardState(observation.finalNonBoardState, { context }),
  };
  const changedPaths = collectChangedPaths(before, after);
  const violations = [];

  for (const rule of normalizedRules) {
    const matchingPaths = changedPaths.filter((path) =>
      pointerPatternMatches(rule.pointer, path),
    );
    if (matchingPaths.length) {
      violations.push({
        id: rule.id,
        path: rule.pointer,
        description: rule.description,
        changedPaths: matchingPaths,
      });
    }
  }

  return {
    pass: violations.length === 0,
    violations,
    changedPaths,
  };
}

export const verifyForbiddenMutations = checkForbiddenMutations;

/**
 * Count matching events/side effects/commands and require exactly one by
 * default. Match objects are partial structural selectors.
 */
export function checkExactOnce(observation, rules = [], options = {}) {
  const checks = [];
  const context = contextFrom(options);
  if (observation.initialBoardState !== undefined) {
    canonicalizeBoardState(observation.initialBoardState, { context });
  }
  if (observation.finalBoardState !== undefined) {
    canonicalizeBoardState(observation.finalBoardState, { context });
  }
  for (const [index, ruleValue] of rules.entries()) {
    const rule = isRecord(ruleValue) ? ruleValue : {};
    const source = rule.source ?? "events";
    const expectedCount = Number.isInteger(rule.count) ? rule.count : 1;
    const rawEntries = getByPath(observation, source);
    if (!Array.isArray(rawEntries)) {
      checks.push({
        id: rule.id ?? `exact-once-${index + 1}`,
        pass: false,
        source,
        expectedCount,
        actualCount: 0,
        message: `Observation source ${JSON.stringify(source)} is not an array`,
      });
      continue;
    }

    let entries;
    let match;
    if (source === "events" || source.endsWith(".events")) {
      entries = canonicalizeBoardEvents(rawEntries, { context });
      match = canonicalizeValue(rule.match ?? {}, context, { path: "" });
    } else {
      entries = canonicalizeNonBoardState(rawEntries, { context });
      match = canonicalizeNonBoardState(rule.match ?? {}, { context });
    }
    const matches = entries.filter(
      (entry) =>
        compareCanonicalValues(entry, match, {
          ...options,
          mode: "partial",
        }).pass,
    );
    const pass = matches.length === expectedCount;
    checks.push({
      id: rule.id ?? `exact-once-${index + 1}`,
      pass,
      source,
      expectedCount,
      actualCount: matches.length,
      message: pass
        ? `Matched exactly ${expectedCount} occurrence${expectedCount === 1 ? "" : "s"}`
        : `Expected ${expectedCount} matching occurrence${expectedCount === 1 ? "" : "s"}, observed ${matches.length}`,
      match,
    });
  }
  return {
    pass: checks.every((check) => check.pass),
    checks,
  };
}

export const verifyExactOnce = checkExactOnce;

/**
 * Verify that compensating actions restore semantic board and non-board state.
 * Volatile timestamps, reducer sequence counters, and deleted tombstones are
 * ignored by default.
 */
export function checkUndoRoundTrip(observation, expectation = true, options = {}) {
  const config =
    expectation === true
      ? {}
      : expectation === false || expectation === undefined
        ? { board: false, nonBoard: false }
        : expectation;
  const compareBoard = config.board !== false;
  const compareNonBoard =
    config.nonBoard === true ||
    (config.nonBoard !== false &&
      observation.initialNonBoardState !== undefined);
  const canonicalOptions = {
    ...options,
    timestampMode: "omit",
    includeDeleted: config.includeDeleted ?? false,
    ignoreFields: [
      "lastSequence",
      ...asArray(options.ignoreFields),
      ...asArray(config.ignoreFields),
    ],
    mode: "exact",
  };
  const checks = [];

  if (compareBoard) {
    if (observation.undoBoardState === undefined) {
      checks.push({
        id: "undo-board-round-trip",
        pass: false,
        message: "Undo BoardState was not observed",
      });
    } else {
      const comparison = compareBoardStates(
        observation.undoBoardState,
        observation.initialBoardState,
        canonicalOptions,
      );
      checks.push({
        id: "undo-board-round-trip",
        pass: comparison.pass,
        message: comparison.pass
          ? "Undo restored the semantic BoardState"
          : "Undo did not restore the semantic BoardState",
        differences: comparison.differences,
      });
    }
  }

  if (compareNonBoard) {
    if (observation.undoNonBoardState === undefined) {
      checks.push({
        id: "undo-non-board-round-trip",
        pass: false,
        message: "Undo non-board state was not observed",
      });
    } else {
      const comparison = compareNonBoardStates(
        observation.undoNonBoardState,
        observation.initialNonBoardState,
        canonicalOptions,
      );
      checks.push({
        id: "undo-non-board-round-trip",
        pass: comparison.pass,
        message: comparison.pass
          ? "Undo restored non-board state"
          : "Undo did not restore non-board state",
        differences: comparison.differences,
      });
    }
  }

  if (config.requireUndoEvents) {
    const pass =
      Array.isArray(observation.undoEvents) && observation.undoEvents.length > 0;
    checks.push({
      id: "undo-events-emitted",
      pass,
      message: pass
        ? `Undo emitted ${observation.undoEvents.length} event(s)`
        : "Undo emitted no events",
    });
  }
  return { pass: checks.every((check) => check.pass), checks };
}

export const verifyUndoRoundTrip = checkUndoRoundTrip;

/**
 * Evaluate one observation against a versioned InteractionEvalCase.
 */
export function evaluateInteractionCase(evalCase, observation, options = {}) {
  if (!isRecord(evalCase) || evalCase.schemaVersion !== INTERACTION_EVAL_CASE_SCHEMA_VERSION) {
    throw new TypeError(
      `Expected ${INTERACTION_EVAL_CASE_SCHEMA_VERSION} InteractionEvalCase`,
    );
  }
  if (!isRecord(observation)) throw new TypeError("Observation must be an object");

  const expected = evalCase.expected ?? {};
  const comparisonOptions = {
    geometryTolerance:
      expected.comparison?.geometryTolerance ??
      options.geometryTolerance ??
      DEFAULT_GEOMETRY_TOLERANCE,
    timestampMode:
      expected.comparison?.timestampMode ?? options.timestampMode ?? "logical",
    includeDeleted:
      expected.comparison?.includeDeleted ?? options.includeDeleted ?? true,
    ignoreFields: [
      ...asArray(options.ignoreFields),
      ...asArray(expected.comparison?.ignoreFields),
    ],
  };
  const initialBoardState =
    observation.initialBoardState ?? evalCase.initial?.boardState;
  const initialNonBoardState =
    observation.initialNonBoardState ?? evalCase.initial?.nonBoardState;
  const completeObservation = {
    ...observation,
    initialBoardState,
    initialNonBoardState,
  };
  const checks = [];

  const actualOutcome = observation.outcome ?? "applied";
  checks.push(
    makeCheck(
      "outcome",
      actualOutcome === expected.outcome,
      actualOutcome === expected.outcome
        ? `Observed expected ${expected.outcome} outcome`
        : `Expected outcome ${expected.outcome}, observed ${actualOutcome}`,
      actualOutcome === expected.outcome
        ? undefined
        : [{ path: "/outcome", expected: expected.outcome, actual: actualOutcome, message: "Outcome differs" }],
    ),
  );

  if (Object.prototype.hasOwnProperty.call(expected, "route")) {
    const comparison = compareCanonicalValues(
      canonicalizeNonBoardState(observation.route),
      canonicalizeNonBoardState(expected.route),
      {
        ...comparisonOptions,
        mode: isRecord(expected.route) ? "partial" : "exact",
      },
    );
    checks.push(
      makeCheck(
        "route",
        comparison.pass,
        comparison.pass
          ? "Input used the expected route"
          : "Input routing differed",
        comparison.differences,
      ),
    );
  }

  if (expected.processingPath !== undefined) {
    const comparison = compareCanonicalValues(
      observation.processingPath,
      expected.processingPath,
      { ...comparisonOptions, mode: "exact" },
    );
    checks.push(
      makeCheck(
        "processing-path",
        comparison.pass,
        comparison.pass
          ? "Processing path matched"
          : "Processing path differed",
        comparison.differences,
      ),
    );
  }

  if (expected.semanticPlan !== undefined) {
    const comparison = compareCanonicalValues(
      canonicalizeNonBoardState(observation.semanticPlan),
      canonicalizeNonBoardState(expected.semanticPlan),
      { ...comparisonOptions, mode: "partial" },
    );
    checks.push(
      makeCheck(
        "semantic-plan",
        comparison.pass,
        comparison.pass
          ? "Semantic plan matched"
          : "Semantic plan differed",
        comparison.differences,
      ),
    );
  }

  if (expected.allowedSemanticAlternatives?.length) {
    const actualPlan = canonicalizeNonBoardState(observation.semanticPlan);
    const alternatives = expected.allowedSemanticAlternatives.map((alternative) =>
      compareCanonicalValues(
        actualPlan,
        canonicalizeNonBoardState(alternative),
        { ...comparisonOptions, mode: "partial" },
      ),
    );
    const pass = alternatives.some((alternative) => alternative.pass);
    checks.push(
      makeCheck(
        "semantic-alternative",
        pass,
        pass
          ? "Semantic plan matched an allowed alternative"
          : "Semantic plan matched no allowed alternative",
        pass
          ? undefined
          : alternatives.flatMap((alternative) => alternative.differences),
      ),
    );
  }

  const groundedCommands =
    observation.groundedCommands ?? observation.actions ?? [];
  if (expected.requiredActions?.length) {
    const required = checkExactOnce(
      { ...completeObservation, groundedCommands },
      expected.requiredActions.map((rule, index) =>
        normalizeActionRule(rule, index, 1, "required-action"),
      ),
      comparisonOptions,
    );
    for (const actionCheck of required.checks) {
      checks.push(
        makeCheck(
          actionCheck.id,
          actionCheck.pass,
          actionCheck.message,
          actionCheck.pass
            ? undefined
            : [{
                path: "/groundedCommands",
                expected: actionCheck.expectedCount,
                actual: actionCheck.actualCount,
                message: "Required grounded-action count differs",
              }],
          actionCheck,
        ),
      );
    }
  }
  if (expected.forbiddenActions?.length) {
    const forbidden = checkExactOnce(
      { ...completeObservation, groundedCommands },
      expected.forbiddenActions.map((rule, index) =>
        normalizeActionRule(rule, index, 0, "forbidden-action"),
      ),
      comparisonOptions,
    );
    for (const actionCheck of forbidden.checks) {
      checks.push(
        makeCheck(
          actionCheck.id,
          actionCheck.pass,
          actionCheck.pass
            ? "Forbidden grounded action was absent"
            : "A forbidden grounded action was observed",
          actionCheck.pass
            ? undefined
            : [{
                path: "/groundedCommands",
                expected: actionCheck.expectedCount,
                actual: actionCheck.actualCount,
                message: "Forbidden grounded-action count differs",
              }],
          actionCheck,
        ),
      );
    }
  }

  if (expected.feedbackCategory !== undefined) {
    checks.push(
      makeCheck(
        "feedback-category",
        observation.feedbackCategory === expected.feedbackCategory,
        observation.feedbackCategory === expected.feedbackCategory
          ? "Feedback category matched"
          : `Expected feedback ${expected.feedbackCategory}, observed ${observation.feedbackCategory ?? "none"}`,
      ),
    );
  }

  if (expected.stageOutcomes !== undefined) {
    const comparison = compareCanonicalValues(
      observation.stageOutcomes,
      expected.stageOutcomes,
      { ...comparisonOptions, mode: "partial" },
    );
    checks.push(
      makeCheck(
        "stage-outcomes",
        comparison.pass,
        comparison.pass
          ? "Stage outcomes matched"
          : "Stage outcomes differed",
        comparison.differences,
      ),
    );
  }

  if (expected.finalBoardState !== undefined) {
    const comparison = compareBoardStates(
      observation.finalBoardState,
      expected.finalBoardState,
      {
        ...comparisonOptions,
        mode: expected.comparison?.board ?? "partial",
      },
    );
    checks.push(
      makeCheck(
        "final-board-state",
        comparison.pass,
        comparison.pass
          ? "Final BoardState matched"
          : `Final BoardState had ${comparison.differences.length} difference(s)`,
        comparison.differences,
      ),
    );
  }

  if (expected.finalStateConstraints !== undefined) {
    const constraints = expected.finalStateConstraints;
    if (
      Object.prototype.hasOwnProperty.call(constraints, "boardState") ||
      Object.prototype.hasOwnProperty.call(constraints, "nonBoardState")
    ) {
      if (constraints.boardState !== undefined) {
        const comparison = compareBoardStates(
          observation.finalBoardState,
          constraints.boardState,
          { ...comparisonOptions, mode: "partial" },
        );
        checks.push(
          makeCheck(
            "final-board-constraints",
            comparison.pass,
            comparison.pass
              ? "Final board constraints matched"
              : "Final board constraints differed",
            comparison.differences,
          ),
        );
      }
      if (constraints.nonBoardState !== undefined) {
        const comparison = compareNonBoardStates(
          observation.finalNonBoardState,
          constraints.nonBoardState,
          { ...comparisonOptions, mode: "partial" },
        );
        checks.push(
          makeCheck(
            "final-non-board-constraints",
            comparison.pass,
            comparison.pass
              ? "Final non-board constraints matched"
              : "Final non-board constraints differed",
            comparison.differences,
          ),
        );
      }
    } else {
      const comparison = compareBoardStates(
        observation.finalBoardState,
        constraints,
        { ...comparisonOptions, mode: "partial" },
      );
      checks.push(
        makeCheck(
          "final-board-constraints",
          comparison.pass,
          comparison.pass
            ? "Final board constraints matched"
            : "Final board constraints differed",
          comparison.differences,
        ),
      );
    }
  }

  if (Object.prototype.hasOwnProperty.call(expected, "finalNonBoardState")) {
    const comparison = compareNonBoardStates(
      observation.finalNonBoardState,
      expected.finalNonBoardState,
      {
        ...comparisonOptions,
        mode: expected.comparison?.nonBoard ?? "exact",
      },
    );
    checks.push(
      makeCheck(
        "final-non-board-state",
        comparison.pass,
        comparison.pass
          ? "Final non-board state matched"
          : `Final non-board state had ${comparison.differences.length} difference(s)`,
        comparison.differences,
      ),
    );
  }

  let observedDelta;
  if (
    expected.boardDelta !== undefined ||
    expected.eventDelta !== undefined ||
    options.includeObserved !== false
  ) {
    observedDelta =
      initialBoardState !== undefined && observation.finalBoardState !== undefined
        ? canonicalizeBoardDelta(
            initialBoardState,
            observation.finalBoardState,
            observation.events ?? [],
            comparisonOptions,
          )
        : undefined;
  }
  if (expected.boardDelta !== undefined) {
    const comparison = compareCanonicalValues(
      observedDelta,
      expected.boardDelta,
      {
        ...comparisonOptions,
        mode: expected.comparison?.delta ?? "partial",
      },
    );
    checks.push(
      makeCheck(
        "board-delta",
        comparison.pass,
        comparison.pass
          ? "BoardState delta matched"
          : `BoardState delta had ${comparison.differences.length} difference(s)`,
        comparison.differences,
      ),
    );
  }
  if (expected.eventDelta !== undefined) {
    const actualEvents = canonicalizeBoardEvents(
      observation.events ?? [],
      comparisonOptions,
    );
    const comparison = compareCanonicalValues(actualEvents, expected.eventDelta, {
      ...comparisonOptions,
      mode: expected.comparison?.delta ?? "partial",
    });
    checks.push(
      makeCheck(
        "event-delta",
        comparison.pass,
        comparison.pass
          ? "BoardEvent delta matched"
          : `BoardEvent delta had ${comparison.differences.length} difference(s)`,
        comparison.differences,
      ),
    );
  }

  if (expected.forbiddenMutations?.length) {
    const forbidden = checkForbiddenMutations(
      completeObservation,
      expected.forbiddenMutations,
      comparisonOptions,
    );
    checks.push(
      makeCheck(
        "forbidden-mutations",
        forbidden.pass,
        forbidden.pass
          ? "No forbidden state changed"
          : `${forbidden.violations.length} forbidden mutation rule(s) matched`,
        forbidden.violations.flatMap((violation) =>
          violation.changedPaths.map((path) => ({
            path,
            message: violation.description ?? `Forbidden by ${violation.path}`,
          })),
        ),
      ),
    );
  }

  if (expected.exactOnce?.length) {
    const exactOnce = checkExactOnce(
      completeObservation,
      expected.exactOnce,
      comparisonOptions,
    );
    for (const exactCheck of exactOnce.checks) {
      checks.push(
        makeCheck(
          exactCheck.id,
          exactCheck.pass,
          exactCheck.message,
          exactCheck.pass
            ? undefined
            : [{
                path: `/${exactCheck.source}`,
                expected: exactCheck.expectedCount,
                actual: exactCheck.actualCount,
                message: "Occurrence count differs",
              }],
          exactCheck,
        ),
      );
    }
  }

  if (expected.undoRoundTrip) {
    const undo = checkUndoRoundTrip(
      completeObservation,
      expected.undoRoundTrip,
      comparisonOptions,
    );
    for (const undoCheck of undo.checks) {
      checks.push(
        makeCheck(
          undoCheck.id,
          undoCheck.pass,
          undoCheck.message,
          undoCheck.differences,
        ),
      );
    }
  }

  const durationMs = finiteNonNegative(
    observation.durationMs ?? options.durationMs ?? 0,
  );
  if (expected.latencyBudget?.totalMs !== undefined) {
    const pass = durationMs <= expected.latencyBudget.totalMs;
    checks.push(
      makeCheck(
        "latency-total",
        pass,
        pass
          ? `Total latency ${durationMs}ms stayed within budget`
          : `Total latency ${durationMs}ms exceeded ${expected.latencyBudget.totalMs}ms`,
      ),
    );
  }
  for (const [stage, budgetMs] of Object.entries(
    expected.latencyBudget?.stages ?? {},
  )) {
    const actualMs = stageTimingMs(observation.stageTimings?.[stage]);
    const pass = actualMs !== null && actualMs <= budgetMs;
    checks.push(
      makeCheck(
        `latency-stage:${stage}`,
        pass,
        pass
          ? `${stage} latency ${actualMs}ms stayed within budget`
          : actualMs === null
            ? `${stage} latency was not observed`
            : `${stage} latency ${actualMs}ms exceeded ${budgetMs}ms`,
      ),
    );
  }
  const status = checks.every((check) => check.status !== "failed")
    ? "passed"
    : "failed";
  const result = {
    schemaVersion: INTERACTION_EVAL_RESULT_SCHEMA_VERSION,
    caseId: evalCase.id,
    title: evalCase.title,
    status,
    durationMs,
    capabilities: [...(evalCase.capabilities ?? [])],
    checks,
    evidenceProvenance: canonicalizeNonBoardState(
      isRecord(observation.evidenceProvenance)
        ? observation.evidenceProvenance
        : {
            class: "unspecified",
            releaseEligible: false,
            timedInput: false,
            timedInputCount: 0,
            routeObservation: "unobserved",
            outcomeObservation: "unobserved",
            components: [],
            reason:
              "The executor did not report evidence provenance; this result cannot be used for release claims.",
          },
      comparisonOptions,
    ),
    failureTaxonomy: [
      ...new Set(
        checks
          .filter((check) => check.status === "failed")
          .map((check) => failureTaxonomyForCheck(check.id)),
      ),
    ],
  };
  if (options.includeObserved !== false) {
    const observed = { outcome: actualOutcome };
    if (observation.finalBoardState !== undefined) {
      observed.finalBoardState = canonicalizeBoardState(
        observation.finalBoardState,
        comparisonOptions,
      );
    }
    if (observation.finalNonBoardState !== undefined) {
      observed.finalNonBoardState = canonicalizeNonBoardState(
        observation.finalNonBoardState,
        comparisonOptions,
      );
    }
    if (observedDelta !== undefined) observed.boardDelta = observedDelta;
    if (observation.events !== undefined) {
      observed.events = canonicalizeBoardEvents(
        observation.events,
        comparisonOptions,
      );
    }
    if (observation.route !== undefined) {
      observed.route = canonicalizeNonBoardState(
        observation.route,
        comparisonOptions,
      );
    }
    if (observation.processingPath !== undefined) {
      observed.processingPath = canonicalizeNonBoardState(
        observation.processingPath,
        comparisonOptions,
      );
    }
    if (observation.semanticPlan !== undefined) {
      observed.semanticPlan = canonicalizeNonBoardState(
        observation.semanticPlan,
        comparisonOptions,
      );
    }
    if (groundedCommands !== undefined) {
      observed.groundedCommands = canonicalizeNonBoardState(
        groundedCommands,
        comparisonOptions,
      );
    }
    if (observation.stageOutcomes !== undefined) {
      observed.stageOutcomes = canonicalizeNonBoardState(
        observation.stageOutcomes,
        comparisonOptions,
      );
    }
    result.observed = observed;
  }
  if (observation.stageOutcomes !== undefined) {
    result.stageOutcomes = canonicalizeNonBoardState(
      observation.stageOutcomes,
      comparisonOptions,
    );
  }
  if (isRecord(observation.stageTimings)) {
    result.stageTimings = Object.fromEntries(
      Object.entries(observation.stageTimings)
        .map(([stage, value]) => [stage, stageTimingMs(value)])
        .filter(([, value]) => value !== null),
    );
  }
  if (isRecord(observation.semanticPlan)) {
    result.semanticPlan = canonicalizeNonBoardState(
      observation.semanticPlan,
      comparisonOptions,
    );
  }
  if (Array.isArray(groundedCommands)) {
    result.groundedCommands = canonicalizeNonBoardState(
      groundedCommands,
      comparisonOptions,
    );
  }
  if (Array.isArray(observation.events)) {
    result.eventDelta = canonicalizeBoardEvents(
      observation.events,
      comparisonOptions,
    );
  }
  if (isRecord(observation.finalBoardState)) {
    result.finalBoardState = canonicalizeBoardState(
      observation.finalBoardState,
      comparisonOptions,
    );
  }
  if (expected.undoRoundTrip) {
    result.undoRoundTrip = Object.fromEntries(
      checks
        .filter((check) => check.id.startsWith("undo-"))
        .map((check) => [check.id, check.status]),
    );
  }
  for (const field of ["versions", "usage", "cost", "device"]) {
    if (isRecord(observation[field])) {
      result[field] = canonicalizeNonBoardState(
        observation[field],
        comparisonOptions,
      );
    }
  }
  if (typeof observation.surface === "string") {
    result.surface = observation.surface;
  }
  if (isRecord(observation.metrics)) {
    result.metrics = Object.fromEntries(
      Object.entries(observation.metrics).filter(
        ([, value]) => typeof value === "number" && Number.isFinite(value),
      ),
    );
  }
  return result;
}

function normalizeActionRule(rule, index, defaultCount, prefix) {
  const wrapped = isRecord(rule) && isRecord(rule.match);
  return {
    id:
      (wrapped && typeof rule.id === "string" && rule.id) ||
      `${prefix}-${index + 1}`,
    source: "groundedCommands",
    match: wrapped ? rule.match : rule,
    count:
      wrapped && Number.isInteger(rule.count)
        ? rule.count
        : defaultCount,
  };
}

function stageTimingMs(value) {
  if (typeof value === "number" && Number.isFinite(value) && value >= 0) {
    return value;
  }
  if (
    isRecord(value) &&
    typeof value.durationMs === "number" &&
    Number.isFinite(value.durationMs) &&
    value.durationMs >= 0
  ) {
    return value.durationMs;
  }
  return null;
}

function failureTaxonomyForCheck(checkId) {
  if (checkId === "route" || checkId === "processing-path") return "routing";
  if (checkId.startsWith("latency-")) return "latency";
  if (checkId.startsWith("undo-")) return "undo";
  if (checkId.includes("action")) return "grounding_or_action";
  if (checkId.includes("board")) return "final_state";
  if (checkId.includes("exact") || checkId.includes("once")) return "exact_once";
  if (checkId === "stage-outcomes") return "pipeline_stage";
  if (checkId.startsWith("semantic")) return "semantic_interpretation";
  if (checkId === "feedback-category") return "feedback";
  if (checkId === "forbidden-mutations") return "safety_mutation";
  return "contract";
}

function canonicalizeProjectedBoardState(boardState, context) {
  seedProjectedBoardIdentities(boardState, context);
  const result = {};
  for (const key of Object.keys(boardState).sort()) {
    const path = `/${escapePointer(key)}`;
    if (isIgnoredField(key, path, context.options)) continue;
    if (BOARD_COLLECTION_KEYS.has(key) && Array.isArray(boardState[key])) {
      result[key] = boardState[key]
        .map((item) =>
          canonicalizeValue(item, context, {
            entityKind:
              key.toLowerCase().includes("edge")
                ? "edge"
                : key.toLowerCase().includes("node")
                  ? "node"
                  : "stroke",
            path,
          }),
        )
        .sort(compareEntityIds);
    } else {
      result[key] = canonicalizeValue(boardState[key], context, { key, path });
    }
  }
  return omitUndefined(result);
}

function seedProjectedBoardIdentities(boardState, context) {
  context.logicalId(boardState.boardId, "board", "board:1");
  const seedCollection = (key, kind, preferred) => {
    for (const entity of [...(Array.isArray(boardState[key]) ? boardState[key] : [])]
      .filter(isRecord)
      .sort(compareSemanticEntities)) {
      context.logicalId(entity.id, kind, preferred?.(entity));
    }
  };
  seedCollection("nodes", "node", (node) => preferredNodeId(node, "node"));
  seedCollection("activeNodes", "node", (node) => preferredNodeId(node, "node"));
  seedCollection("strokes", "stroke");
  seedCollection("activeStrokes", "stroke");
  seedCollection("edges", "edge", (edge) => preferredEdgeId(edge, context));
  seedCollection("activeEdges", "edge", (edge) => preferredEdgeId(edge, context));
}

function seedBoardStateIdentities(boardState, context) {
  context.logicalId(boardState.boardId, "board", "board:1");
  const strokes = [
    ...Object.values(isRecord(boardState.strokes) ? boardState.strokes : {}),
    ...Object.values(
      isRecord(boardState.activeStrokes) ? boardState.activeStrokes : {},
    ),
  ].filter(isRecord);
  seedStrokeIdentities(strokes, context);
  seedRecordIdentities(boardState.eraseActions, context, "erase");
  seedRecordIdentities(boardState.participants, context, "participant");
  seedRecordIdentities(boardState.cursors, context, "cursor");
}

function seedEventIdentities(events, context) {
  const strokes = [];
  for (const event of events) {
    if (!isRecord(event)) continue;
    context.logicalId(event.boardSessionId, "board", "board:1");
    context.logicalId(event.actorParticipantId, "participant");
    context.logicalId(event.id, "event");
    if (isRecord(event.stroke)) strokes.push(event.stroke);
  }
  seedStrokeIdentities(strokes, context);
  for (const event of events) {
    if (!isRecord(event)) continue;
    if (isRecord(event.eraseAction)) {
      context.logicalId(event.eraseAction.id, "erase");
    }
  }
}

function seedStrokeIdentities(strokes, context) {
  const nodes = strokes
    .filter((stroke) => isSemanticObject(stroke) && !isConnector(stroke))
    .sort(compareSemanticEntities);
  const plain = strokes
    .filter((stroke) => !isSemanticObject(stroke))
    .sort(compareSemanticEntities);
  for (const stroke of nodes) {
    const kind = stroke.annotation?.groupMemberStrokeIds ? "group" : "node";
    context.logicalId(stroke.id, kind, preferredNodeId(stroke, kind));
  }
  for (const stroke of plain) context.logicalId(stroke.id, "stroke");

  const edges = strokes.filter(isConnector).sort((left, right) => {
    const leftKey = preferredEdgeId(left, context);
    const rightKey = preferredEdgeId(right, context);
    return leftKey.localeCompare(rightKey) || compareSemanticEntities(left, right);
  });
  for (const stroke of edges) {
    context.logicalId(stroke.id, "edge", preferredEdgeId(stroke, context));
  }
}

function seedRecordIdentities(record, context, kind) {
  if (!isRecord(record)) return;
  Object.values(record)
    .filter(isRecord)
    .sort(compareSemanticEntities)
    .forEach((entity) => context.logicalId(entity.id ?? entity[`${kind}Id`], kind));
}

function partitionStrokes(record, includeDeleted) {
  const strokes = Object.values(isRecord(record) ? record : {})
    .filter(isRecord)
    .filter((stroke) => includeDeleted || stroke.status !== "deleted");
  return {
    nodes: strokes
      .filter((stroke) => isSemanticObject(stroke) && !isConnector(stroke))
      .sort(compareByLogicalShape),
    edges: strokes.filter(isConnector).sort(compareByLogicalShape),
    strokes: strokes.filter((stroke) => !isSemanticObject(stroke)).sort(compareByLogicalShape),
  };
}

function canonicalizeStroke(stroke, context, kind) {
  return canonicalizeValue(stroke, context, {
    entityKind: kind,
    path: "",
  });
}

function canonicalizeEntityRecord(record, context, kind) {
  return Object.values(isRecord(record) ? record : {})
    .filter(isRecord)
    .map((entity) =>
      canonicalizeValue(entity, context, { entityKind: kind, path: "" }),
    )
    .sort(compareEntityIds);
}

function canonicalizeValue(value, context, meta = {}) {
  if (value === null || value === undefined) return value;
  if (Array.isArray(value)) {
    const arrayKind = ID_ARRAY_KINDS.get(meta.key);
    const result = value.map((item, index) => {
      const path = `${meta.path ?? ""}/${index}`;
      return arrayKind && typeof item === "string"
        ? context.logicalId(item, arrayKind)
        : canonicalizeValue(item, context, { path });
    });
    return arrayKind ? result.sort(compareScalars) : result;
  }
  if (!isRecord(value)) {
    if (isTimestampField(meta.key)) return context.logicalTimestamp(value);
    const idKind = ID_FIELD_KINDS.get(meta.key);
    return idKind && typeof value === "string"
      ? context.logicalId(value, idKind)
      : value;
  }

  const result = {};
  for (const key of Object.keys(value).sort()) {
    const path = `${meta.path ?? ""}/${escapePointer(key)}`;
    if (isIgnoredField(key, path, context.options)) continue;
    if (key === "id" && typeof value[key] === "string") {
      result.id = context.logicalId(value[key], meta.entityKind ?? inferEntityKind(value));
      continue;
    }
    if (isTimestampField(key)) {
      if (context.options.timestampMode !== "omit") {
        result[key] = context.logicalTimestamp(value[key]);
      }
      continue;
    }
    const idKind = ID_FIELD_KINDS.get(key);
    if (idKind && typeof value[key] === "string") {
      result[key] = context.logicalId(value[key], idKind);
      continue;
    }
    const arrayKind = ID_ARRAY_KINDS.get(key);
    if (arrayKind && Array.isArray(value[key])) {
      result[key] = value[key]
        .map((id) => context.logicalId(id, arrayKind))
        .sort(compareScalars);
      continue;
    }
    result[key] = canonicalizeValue(value[key], context, { key, path });
  }
  return omitUndefined(result);
}

function compareValueRecursive(actual, expected, path, options, differences) {
  const field = lastPointerSegment(path);
  if (isIgnoredField(field, path, { ignoreFields: options.ignoreFields })) return;

  if (typeof actual === "number" && typeof expected === "number") {
    const tolerance = geometryToleranceFor(path, options.geometryTolerance);
    const equal = tolerance === null
      ? Object.is(actual, expected)
      : Math.abs(actual - expected) <= tolerance;
    if (!equal) {
      differences.push(
        difference(path, expected, actual, tolerance === null
          ? "Numbers differ"
          : `Geometry differs by ${Math.abs(actual - expected)} (tolerance ${tolerance})`),
      );
    }
    return;
  }
  if (
    actual === null ||
    expected === null ||
    typeof actual !== "object" ||
    typeof expected !== "object"
  ) {
    if (!Object.is(actual, expected)) {
      differences.push(difference(path, expected, actual, "Values differ"));
    }
    return;
  }
  if (Array.isArray(expected)) {
    if (!Array.isArray(actual)) {
      differences.push(difference(path, expected, actual, "Expected an array"));
      return;
    }
    if (options.mode === "exact" && actual.length !== expected.length) {
      differences.push(
        difference(
          path,
          expected.length,
          actual.length,
          "Array lengths differ",
        ),
      );
    }
    for (let index = 0; index < expected.length; index += 1) {
      const expectedItem = expected[index];
      let actualItem = actual[index];
      let actualIndex = index;
      if (
        options.mode === "partial" &&
        isRecord(expectedItem) &&
        typeof expectedItem.id === "string"
      ) {
        actualIndex = actual.findIndex(
          (candidate) => isRecord(candidate) && candidate.id === expectedItem.id,
        );
        actualItem = actualIndex === -1 ? undefined : actual[actualIndex];
      }
      compareValueRecursive(
        actualItem,
        expectedItem,
        `${path}/${actualIndex === -1 ? index : actualIndex}`,
        options,
        differences,
      );
    }
    return;
  }
  if (Array.isArray(actual)) {
    differences.push(difference(path, expected, actual, "Expected an object"));
    return;
  }

  for (const key of Object.keys(expected)) {
    const childPath = `${path}/${escapePointer(key)}`;
    compareValueRecursive(actual[key], expected[key], childPath, options, differences);
  }
  if (options.mode === "exact") {
    for (const key of Object.keys(actual)) {
      if (!(key in expected)) {
        const childPath = `${path}/${escapePointer(key)}`;
        if (!isIgnoredField(key, childPath, { ignoreFields: options.ignoreFields })) {
          differences.push(
            difference(childPath, undefined, actual[key], "Unexpected field"),
          );
        }
      }
    }
  }
}

function diffEntityCollection(before, after, options) {
  const beforeById = new Map(before.map((entity) => [entity.id, entity]));
  const afterById = new Map(after.map((entity) => [entity.id, entity]));
  const added = [];
  const removed = [];
  const updated = [];
  for (const [id, entity] of afterById) {
    if (!beforeById.has(id)) {
      added.push(entity);
      continue;
    }
    const previous = beforeById.get(id);
    const comparison = compareCanonicalValues(entity, previous, {
      ...options,
      mode: "exact",
    });
    if (!comparison.pass) {
      updated.push({
        id,
        before: previous,
        after: entity,
        changedPaths: comparison.differences.map(({ path }) => path),
      });
    }
  }
  for (const [id, entity] of beforeById) {
    if (!afterById.has(id)) removed.push(entity);
  }
  return { added, removed, updated };
}

function collectChangedPaths(before, after, path = "") {
  if (Object.is(before, after)) return [];
  if (
    before === null ||
    after === null ||
    typeof before !== "object" ||
    typeof after !== "object"
  ) {
    return [path || "/"];
  }
  if (Array.isArray(before) || Array.isArray(after)) {
    if (!Array.isArray(before) || !Array.isArray(after)) return [path || "/"];
    const paths = [];
    const length = Math.max(before.length, after.length);
    for (let index = 0; index < length; index += 1) {
      const childPath = `${path}/${index}`;
      if (index >= before.length || index >= after.length) {
        paths.push(childPath);
        paths.push(...collectLeafPaths(index < before.length ? before[index] : after[index], childPath));
      } else {
        paths.push(...collectChangedPaths(before[index], after[index], childPath));
      }
    }
    return uniqueSorted(paths);
  }
  const paths = [];
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  for (const key of [...keys].sort()) {
    const childPath = `${path}/${escapePointer(key)}`;
    if (!(key in before) || !(key in after)) {
      paths.push(childPath);
      paths.push(...collectLeafPaths(key in before ? before[key] : after[key], childPath));
    } else {
      paths.push(...collectChangedPaths(before[key], after[key], childPath));
    }
  }
  return uniqueSorted(paths);
}

function collectLeafPaths(value, path) {
  if (value === null || typeof value !== "object") return [];
  if (Array.isArray(value)) {
    return value.flatMap((item, index) => {
      const child = `${path}/${index}`;
      return [child, ...collectLeafPaths(item, child)];
    });
  }
  return Object.keys(value).flatMap((key) => {
    const child = `${path}/${escapePointer(key)}`;
    return [child, ...collectLeafPaths(value[key], child)];
  });
}

function normalizeForbiddenRule(ruleValue, index) {
  const rule =
    typeof ruleValue === "string" ? { path: ruleValue } : ruleValue ?? {};
  const scopePrefix =
    rule.scope === "board"
      ? "/boardState"
      : rule.scope === "nonBoard"
        ? "/nonBoardState"
        : "";
  const normalizedPath = normalizePointer(rule.path ?? "/");
  const alreadyScoped =
    normalizedPath === "/boardState" ||
    normalizedPath.startsWith("/boardState/") ||
    normalizedPath === "/nonBoardState" ||
    normalizedPath.startsWith("/nonBoardState/");
  return {
    id: rule.id ?? `forbidden-mutation-${(index ?? 0) + 1}`,
    pointer:
      scopePrefix && !alreadyScoped
        ? `${scopePrefix}${normalizedPath === "/" ? "" : normalizedPath}`
        : normalizedPath,
    description: rule.description,
  };
}

function pointerPatternMatches(pattern, pointer) {
  const expected = pointerSegments(pattern);
  const actual = pointerSegments(pointer);

  function visit(patternIndex, actualIndex) {
    if (patternIndex === expected.length) return true;
    const segment = expected[patternIndex];
    if (segment === "**") {
      if (patternIndex === expected.length - 1) return true;
      for (let index = actualIndex; index <= actual.length; index += 1) {
        if (visit(patternIndex + 1, index)) return true;
      }
      return false;
    }
    if (actualIndex >= actual.length) return false;
    if (segment !== "*" && segment !== actual[actualIndex]) return false;
    return visit(patternIndex + 1, actualIndex + 1);
  }

  return visit(0, 0);
}

function geometryToleranceFor(path, toleranceOption) {
  const segments = pointerSegments(path);
  const field = segments.at(-1);
  if (!GEOMETRY_FIELDS.has(field)) return null;
  if (!segments.some((segment) => POSITION_CONTAINERS.has(segment))) return null;
  if (typeof toleranceOption === "number") return toleranceOption;
  const tolerance = isRecord(toleranceOption) ? toleranceOption : {};
  if (field === "width" || field === "height") {
    return tolerance.size ?? tolerance.default ?? DEFAULT_GEOMETRY_TOLERANCE;
  }
  if (segments.includes("points") || segments.includes("point")) {
    return tolerance.point ?? tolerance.position ?? tolerance.default ?? DEFAULT_GEOMETRY_TOLERANCE;
  }
  return tolerance.position ?? tolerance.default ?? DEFAULT_GEOMETRY_TOLERANCE;
}

function normalizeCanonicalizationOptions(options) {
  return {
    geometryTolerance:
      options.geometryTolerance ?? DEFAULT_GEOMETRY_TOLERANCE,
    timestampMode: ["logical", "preserve", "omit"].includes(options.timestampMode)
      ? options.timestampMode
      : "logical",
    includeDeleted: options.includeDeleted !== false,
    ignoreFields: normalizeIgnoreFields(options.ignoreFields),
    logicalIds: options.logicalIds,
    preserveLogicalIds: options.preserveLogicalIds !== false,
  };
}

function contextFrom(options) {
  if (options?.__interactionEvalCanonicalizationContext) return options;
  if (options?.context?.__interactionEvalCanonicalizationContext) {
    return options.context;
  }
  return createCanonicalizationContext(options);
}

function normalizeLogicalIdMap(value) {
  if (value instanceof Map) return new Map(value);
  if (isRecord(value)) return new Map(Object.entries(value));
  return new Map();
}

function normalizeIgnoreFields(values) {
  return new Set(
    values instanceof Set
      ? values
      : Array.isArray(values)
        ? values
        : values
          ? [values]
          : [],
  );
}

function isIgnoredField(key, pointer, options) {
  const ignored = options.ignoreFields ?? new Set();
  return (
    ignored.has(key) ||
    ignored.has(pointer) ||
    [...ignored].some(
      (pattern) =>
        typeof pattern === "string" &&
        (pattern.includes("*") || pattern.startsWith("/")) &&
        pointerPatternMatches(normalizePointer(pattern), pointer),
    )
  );
}

function preferredNodeId(stroke, kind) {
  const label = slug(stroke.annotation?.label);
  const nodeType = slug(stroke.annotation?.nodeType);
  return `${kind}:${label || nodeType || "object"}`;
}

function preferredEdgeId(stroke, context) {
  const from = context.logicalId(
    stroke.annotation?.snappedStartStrokeId,
    "node",
  );
  const to = context.logicalId(
    stroke.annotation?.snappedEndStrokeId,
    "node",
  );
  const label = slug(stroke.annotation?.label);
  return `edge:${from ?? "unbound"}->${to ?? "unbound"}${label ? `:${label}` : ""}`;
}

function normalizePreferredLogicalId(value, kind) {
  const string = String(value);
  return string.includes(":") ? string : `${kind}:${slug(string) || "object"}`;
}

function normalizeIdKind(kind) {
  const normalized = slug(kind).replaceAll("-", "_");
  return LOGICAL_ID_PREFIXES.has(normalized) ? normalized : "object";
}

function looksLikeLogicalId(value) {
  const separator = value.indexOf(":");
  return separator > 0 && LOGICAL_ID_PREFIXES.has(value.slice(0, separator));
}

function inferEntityKind(value) {
  if (isConnector(value)) return "edge";
  if (isSemanticObject(value)) {
    return value.annotation?.groupMemberStrokeIds ? "group" : "node";
  }
  if ("displayName" in value && ("role" in value || "connectedAt" in value)) {
    return "participant";
  }
  if ("eraserPath" in value) return "erase";
  if ("mode" in value && "updatedAt" in value) return "cursor";
  if ("type" in value && "boardSessionId" in value && "createdAt" in value) {
    return "event";
  }
  return "object";
}

function isSemanticObject(stroke) {
  return isRecord(stroke?.annotation);
}

function isConnector(stroke) {
  return stroke?.annotation?.type === "connector";
}

function looksLikeRawBoardState(value) {
  return isRecord(value.strokes) && isRecord(value.activeStrokes);
}

function compareSemanticEntities(left, right) {
  return semanticSortKey(left).localeCompare(semanticSortKey(right));
}

function compareByLogicalShape(left, right) {
  return compareSemanticEntities(left, right);
}

function semanticSortKey(value) {
  return stableStringify(stripVolatileIdentity(value));
}

function stripVolatileIdentity(value, key) {
  if (Array.isArray(value)) {
    if (ID_ARRAY_KINDS.has(key)) return [];
    return value.map((item) => stripVolatileIdentity(item));
  }
  if (!isRecord(value)) return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .filter(
        (childKey) =>
          childKey !== "id" &&
          !ID_FIELD_KINDS.has(childKey) &&
          !isTimestampField(childKey),
      )
      .map((childKey) => [
        childKey,
        stripVolatileIdentity(value[childKey], childKey),
      ]),
  );
}

function compareEntityIds(left, right) {
  return String(left?.id ?? "").localeCompare(String(right?.id ?? ""));
}

function compareScalars(left, right) {
  return String(left).localeCompare(String(right));
}

function isTimestampField(key) {
  return (
    typeof key === "string" &&
    (TIMESTAMP_FIELDS.has(key) || key.endsWith("At"))
  );
}

function getByPath(value, path) {
  if (!path) return value;
  const segments = path.startsWith("/")
    ? pointerSegments(path)
    : path.split(".").filter(Boolean);
  return segments.reduce(
    (current, segment) =>
      current === undefined || current === null ? undefined : current[segment],
    value,
  );
}

function normalizePointer(path) {
  if (!path || path === "/") return "/";
  if (path.startsWith("/")) return path.replace(/\/+$/, "") || "/";
  const normalized = path.replace(/\[([^\]]+)\]/g, ".$1");
  const segments = normalized
    .split(normalized.includes("/") ? "/" : ".")
    .filter(Boolean);
  return `/${segments.map(escapePointer).join("/")}`;
}

function pointerSegments(pointer) {
  if (!pointer || pointer === "/") return [];
  return pointer
    .replace(/^\/+/, "")
    .split("/")
    .filter((segment) => segment.length > 0)
    .map(unescapePointer);
}

function lastPointerSegment(pointer) {
  return pointerSegments(pointer).at(-1) ?? "";
}

function escapePointer(value) {
  return String(value).replaceAll("~", "~0").replaceAll("/", "~1");
}

function unescapePointer(value) {
  return String(value).replaceAll("~1", "/").replaceAll("~0", "~");
}

function difference(path, expected, actual, message) {
  const result = { path: path || "/", message };
  if (expected !== undefined) result.expected = expected;
  if (actual !== undefined) result.actual = actual;
  return result;
}

function makeCheck(id, pass, message, differences, details) {
  const check = {
    id,
    status: pass ? "passed" : "failed",
    message,
  };
  if (differences?.length) check.differences = differences;
  if (details !== undefined) check.details = details;
  return check;
}

function slug(value) {
  return String(value ?? "")
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 64);
}

function stableStringify(value) {
  return JSON.stringify(value);
}

function omitUndefined(value) {
  return Object.fromEntries(
    Object.entries(value).filter(([, child]) => child !== undefined),
  );
}

function omitKeys(value, keys) {
  if (!isRecord(value)) return value;
  return Object.fromEntries(
    Object.entries(value).filter(([key]) => !keys.has(key)),
  );
}

function uniqueSorted(values) {
  return [...new Set(values)].sort();
}

function finiteNonNegative(value) {
  return Number.isFinite(value) && value >= 0 ? value : 0;
}

function asArray(value) {
  if (value === undefined || value === null) return [];
  if (Array.isArray(value)) return value;
  if (value instanceof Set) return [...value];
  return [value];
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
