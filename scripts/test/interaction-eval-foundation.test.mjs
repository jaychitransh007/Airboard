import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

import {
  applyDiagramCommand,
  applyDiagramUndo,
  createInitialBoardState,
} from "../../packages/core/dist/index.js";
import {
  canonicalizeBoardDelta,
  canonicalizeBoardEvents,
  canonicalizeBoardState,
  checkExactOnce,
  checkForbiddenMutations,
  compareBoardStates,
  createCanonicalizationContext,
  evaluateInteractionCase,
} from "../lib/interaction-eval-harness.mjs";
import {
  INTERACTION_EVAL_CORPUS_SCHEMA_VERSION,
  runInteractionCorpus,
  validateInteractionCorpus,
} from "../lib/interaction-eval-corpus.mjs";
import {
  emitHtmlReport,
  emitJsonReport,
  emitJunitReport,
  emitMarkdownReport,
} from "../lib/interaction-eval-reporters.mjs";
import {
  executeInteractionEvalCase,
} from "../lib/interaction-eval-production-executor.mjs";

const CREATED_AT = "2026-07-30T00:00:00.000Z";

function context(createdAt = CREATED_AT) {
  let eventNumber = 0;
  return {
    boardSessionId: "physical-board-7d91",
    actorParticipantId: "physical-participant-a2",
    userId: "physical-user-c3",
    createdAt,
    eventIdFactory: () => `physical-event-${++eventNumber}`,
  };
}

function createNode(state, id, label, center) {
  return applyDiagramCommand(
    state,
    {
      type: "node.create",
      nodeId: id,
      nodeType: "service",
      label,
      center,
      source: "voice",
    },
    context(),
  );
}

test("versioned case and result schemas expose stable contract names", async () => {
  const caseSchema = JSON.parse(
    await readFile(
      new URL(
        "../../evals/schema/interaction-eval-case.v1.schema.json",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  const resultSchema = JSON.parse(
    await readFile(
      new URL(
        "../../evals/schema/interaction-eval-result.v1.schema.json",
        import.meta.url,
      ),
      "utf8",
    ),
  );

  assert.equal(caseSchema.title, "InteractionEvalCase");
  assert.equal(
    caseSchema.properties.schemaVersion.const,
    "interaction-eval-case.v1",
  );
  assert.equal(resultSchema.title, "InteractionEvalResult");
  assert.equal(
    resultSchema.properties.schemaVersion.const,
    "interaction-eval-result.v1",
  );
});

test("canonical BoardState uses logical IDs/timestamps and sorted nodes/edges", () => {
  let state = createInitialBoardState("physical-board-7d91");
  const zeta = createNode(
    state,
    "generated-uuid-z",
    "Zeta",
    { x: 500, y: 200 },
  );
  state = zeta.state;
  const alpha = createNode(
    state,
    "generated-uuid-a",
    "Alpha",
    { x: 200, y: 200 },
  );
  state = alpha.state;
  const connected = applyDiagramCommand(
    state,
    {
      type: "nodes.connect",
      connectorId: "generated-edge-uuid",
      fromId: "generated-uuid-a",
      toId: "generated-uuid-z",
      label: "calls",
      source: "voice",
    },
    context("2026-07-30T00:00:01.000Z"),
  );

  const canonicalContext = createCanonicalizationContext();
  const canonical = canonicalizeBoardState(connected.state, {
    context: canonicalContext,
  });
  assert.equal(canonical.boardId, "board:1");
  assert.deepEqual(
    canonical.nodes.map(({ id }) => id),
    ["node:alpha", "node:zeta"],
  );
  assert.deepEqual(
    canonical.edges.map(({ id }) => id),
    ["edge:node:alpha->node:zeta:calls"],
  );
  assert.match(canonical.nodes[0].createdAt, /^@time:\d+$/);
  assert.equal(
    canonical.edges[0].annotation.snappedStartStrokeId,
    "node:alpha",
  );

  const canonicalEvents = canonicalizeBoardEvents(connected.events, {
    context: canonicalContext,
  });
  assert.deepEqual(
    canonicalEvents.map(({ type }) => type),
    ["stroke.started", "stroke.committed"],
  );
  assert.equal(
    canonicalEvents[1].strokeId,
    "edge:node:alpha->node:zeta:calls",
  );
  assert.match(canonicalEvents[0].id, /^event:\d+$/);
});

test("geometry comparison tolerates small drift but reports larger drift", () => {
  const initial = createInitialBoardState("board");
  const created = createNode(
    initial,
    "node:checkout",
    "Checkout",
    { x: 200, y: 200 },
  );
  const withinTolerance = structuredClone(created.state);
  withinTolerance.strokes["node:checkout"].annotation.bounds.x += 0.4;
  const outsideTolerance = structuredClone(created.state);
  outsideTolerance.strokes["node:checkout"].annotation.bounds.x += 0.6;

  assert.equal(
    compareBoardStates(withinTolerance, created.state, {
      geometryTolerance: 0.5,
    }).pass,
    true,
  );
  const comparison = compareBoardStates(outsideTolerance, created.state, {
    geometryTolerance: 0.5,
  });
  assert.equal(comparison.pass, false);
  assert.ok(
    comparison.differences.some(({ path }) => path.endsWith("/bounds/x")),
  );
});

test("canonical BoardState delta reports semantic additions and BoardEvent order", () => {
  const initial = createInitialBoardState("physical-board");
  const created = applyDiagramCommand(
    initial,
    {
      type: "node.create",
      nodeId: "physical-created-node",
      nodeType: "service",
      label: "Checkout API",
      center: { x: 240, y: 180 },
      source: "voice",
    },
    context(),
  );
  const delta = canonicalizeBoardDelta(
    initial,
    created.state,
    created.events,
  );

  assert.equal(delta.nodes.added.length, 1);
  assert.equal(delta.nodes.added[0].id, "node:checkout-api");
  assert.deepEqual(
    delta.events.map(({ type }) => type),
    ["stroke.started", "stroke.committed"],
  );
  assert.equal(delta.events[1].strokeId, "node:checkout-api");
});

test("case evaluator checks board/non-board state, exact-once, forbidden mutations, and undo", () => {
  const base = createNode(
    createInitialBoardState("board:primary"),
    "node:checkout",
    "Checkout",
    { x: 200, y: 200 },
  ).state;
  const renamed = applyDiagramCommand(
    base,
    {
      type: "object.rename",
      objectId: "node:checkout",
      label: "Payments",
    },
    context("2026-07-30T00:00:01.000Z"),
  );
  const undone = applyDiagramUndo(
    renamed.state,
    renamed,
    context("2026-07-30T00:00:02.000Z"),
  );
  const nonBoardState = {
    selection: ["node:checkout"],
    meeting: { muted: false },
  };
  const evalCase = {
    schemaVersion: "interaction-eval-case.v1",
    id: "rename",
    title: "Rename",
    capabilities: [
      "action:rename",
      "contract:exact-once",
      "contract:forbidden-mutations",
      "contract:undo-round-trip",
    ],
    interaction: { channel: "keyboard", input: "Payments" },
    expected: {
      outcome: "applied",
      comparison: { board: "partial", nonBoard: "exact" },
      finalBoardState: {
        nodes: [
          {
            id: "node:checkout",
            annotation: { label: "Payments" },
          },
        ],
      },
      finalNonBoardState: nonBoardState,
      forbiddenMutations: [
        { scope: "nonBoard", path: "meeting" },
      ],
      exactOnce: [
        {
          id: "rename-once",
          match: {
            type: "stroke.label_updated",
            strokeId: "node:checkout",
            label: "Payments",
          },
        },
      ],
      undoRoundTrip: {
        board: true,
        nonBoard: true,
        requireUndoEvents: true,
      },
    },
  };

  const result = evaluateInteractionCase(evalCase, {
    outcome: "applied",
    initialBoardState: base,
    finalBoardState: renamed.state,
    undoBoardState: undone.state,
    initialNonBoardState: nonBoardState,
    finalNonBoardState: structuredClone(nonBoardState),
    undoNonBoardState: structuredClone(nonBoardState),
    events: renamed.events,
    undoEvents: undone.events,
    durationMs: 4.25,
  });

  assert.equal(result.status, "passed");
  assert.ok(result.checks.some(({ id }) => id === "rename-once"));
  assert.ok(
    result.checks.some(({ id }) => id === "undo-board-round-trip"),
  );
  assert.equal(result.observed.boardDelta.nodes.updated.length, 1);
  assert.equal(result.evidenceProvenance.class, "unspecified");
  assert.equal(result.evidenceProvenance.releaseEligible, false);
});

test("production interaction executor observes routing and never copies the expected oracle", async () => {
  const observation = await executeInteractionEvalCase({
    id: "ambient-with-self-fulfilling-oracle",
    surface: "replay",
    initial: {
      boardState: {
        boardId: "board:primary",
        nodes: [],
        edges: [],
      },
    },
    interaction: {
      channel: "voice",
      input: {
        transcript: "please add a service here",
      },
      commands: [
        {
          type: "node.create",
          nodeId: "node:must-not-be-used",
          nodeType: "service",
          label: "Must not be used",
          center: { x: 200, y: 200 },
        },
      ],
    },
    expected: {
      outcome: "applied",
      route: { channel: "voice", activation: "wake" },
    },
  });

  assert.equal(observation.outcome, "no-op");
  assert.deepEqual(observation.processingPath, ["voice", "route_rejected"]);
  assert.equal(observation.events.length, 0);
  assert.equal(observation.groundedCommands.length, 0);
  assert.equal(observation.evidenceProvenance.class, "production-route");
  assert.equal(observation.evidenceProvenance.releaseEligible, true);
  assert.equal(observation.evidenceProvenance.routeObservation, "production");
  assert.equal(observation.evidenceProvenance.outcomeObservation, "production");
});

test("pre-grounded direct commands are labeled harness-only", async () => {
  const observation = await executeInteractionEvalCase({
    id: "fixture-command",
    surface: "replay",
    initial: {
      boardState: {
        boardId: "board:primary",
        nodes: [],
        edges: [],
      },
    },
    interaction: {
      channel: "catalog",
      input: { catalogId: "flow", toolId: "service" },
      commands: [
        {
          type: "node.create",
          nodeId: "node:fixture",
          nodeType: "service",
          label: "Fixture",
          center: { x: 200, y: 200 },
        },
      ],
    },
    expected: { outcome: "applied" },
  });

  assert.equal(observation.outcome, "applied");
  assert.equal(observation.events.length, 2);
  assert.equal(observation.evidenceProvenance.class, "harness-fixture");
  assert.equal(observation.evidenceProvenance.releaseEligible, false);
  assert.equal(
    observation.evidenceProvenance.routeObservation,
    "fixture_inferred",
  );
});

test("exact-once and forbidden mutation checks expose actionable failures", () => {
  const event = {
    id: "event:rename",
    boardSessionId: "board:primary",
    actorParticipantId: "participant:owner",
    createdAt: CREATED_AT,
    type: "stroke.label_updated",
    strokeId: "node:checkout",
    label: "Payments",
  };
  const exactOnce = checkExactOnce(
    { events: [event, { ...event, id: "event:rename-retry" }] },
    [
      {
        id: "rename-once",
        match: {
          type: "stroke.label_updated",
          strokeId: "node:checkout",
        },
      },
    ],
  );
  assert.equal(exactOnce.pass, false);
  assert.equal(exactOnce.checks[0].actualCount, 2);

  const forbidden = checkForbiddenMutations(
    {
      initialNonBoardState: {
        meeting: { muted: false },
        selection: [],
      },
      finalNonBoardState: {
        meeting: { muted: true },
        selection: [],
      },
    },
    [{ scope: "nonBoard", path: "meeting/**" }],
  );
  assert.equal(forbidden.pass, false);
  assert.deepEqual(forbidden.violations[0].changedPaths, [
    "/nonBoardState/meeting/muted",
  ]);
});

test("representative v1 corpus passes shape and declared capability coverage", async () => {
  const corpus = JSON.parse(
    await readFile(
      new URL("../../evals/interactions/v1.json", import.meta.url),
      "utf8",
    ),
  );
  const validation = validateInteractionCorpus(corpus);
  assert.equal(corpus.schemaVersion, INTERACTION_EVAL_CORPUS_SCHEMA_VERSION);
  assert.equal(validation.valid, true);
  assert.equal(
    validation.coverage.coveredRequiredCapabilityCount,
    validation.coverage.requiredCapabilityCount,
  );

  const incomplete = structuredClone(corpus);
  incomplete.cases = incomplete.cases.filter(
    ({ capabilities }) => !capabilities.includes("action:create"),
  );
  const invalid = validateInteractionCorpus(incomplete);
  assert.equal(invalid.valid, false);
  assert.ok(
    invalid.errors.some(
      ({ code, message }) =>
        code === "coverage.capability" &&
        message.includes("action:create"),
    ),
  );
});

test("corpus runner converts executor observations and errors to result records", async () => {
  const corpus = {
    schemaVersion: "interaction-eval-corpus.v1",
    caseSchemaVersion: "interaction-eval-case.v1",
    capabilityRegistryVersion: "1.2",
    coverage: {
      requiredCapabilities: ["action:create"],
    },
    cases: [
      {
        schemaVersion: "interaction-eval-case.v1",
        id: "passes",
        title: "Passes",
        corpusVersion: "test-v1",
        modality: "remote",
        surface: "replay",
        riskLevel: "low",
        datasetAssetHash: "none",
        capabilities: ["action:create"],
        interaction: { channel: "replay", input: {} },
        expected: { outcome: "applied" },
      },
      {
        schemaVersion: "interaction-eval-case.v1",
        id: "errors",
        title: "Errors",
        corpusVersion: "test-v1",
        modality: "remote",
        surface: "replay",
        riskLevel: "low",
        datasetAssetHash: "none",
        capabilities: ["action:create"],
        interaction: { channel: "replay", input: {} },
        expected: { outcome: "applied" },
      },
    ],
  };
  const report = await runInteractionCorpus(corpus, async (evalCase) => {
    if (evalCase.id === "errors") throw new Error("executor exploded");
    return { outcome: "applied", durationMs: 1 };
  });

  assert.equal(report.summary.passed, 1);
  assert.equal(report.summary.errors, 1);
  assert.equal(report.results[1].error.message, "executor exploded");
  assert.equal(report.results[1].evidenceProvenance.class, "executor-error");
});

test("JSON, JUnit, and Markdown emitters summarize the same results", () => {
  const results = [
    {
      schemaVersion: "interaction-eval-result.v1",
      caseId: "passes",
      title: "A & B",
      status: "passed",
      durationMs: 10,
      capabilities: ["action:create"],
      checks: [
        { id: "outcome", status: "passed", message: "matched" },
      ],
    },
    {
      schemaVersion: "interaction-eval-result.v1",
      caseId: "fails",
      title: "Failure <case>",
      status: "failed",
      durationMs: 20,
      capabilities: ["action:move"],
      checks: [
        {
          id: "geometry",
          status: "failed",
          message: "x differs",
          differences: [
            {
              path: "/nodes/0/bounds/x",
              expected: 10,
              actual: 14,
              message: "outside tolerance",
            },
          ],
        },
      ],
    },
  ];
  const options = { generatedAt: "2026-07-30T12:00:00.000Z" };
  const json = JSON.parse(emitJsonReport(results, options));
  const junit = emitJunitReport(results, options);
  const markdown = emitMarkdownReport(results, options);
  const html = emitHtmlReport(results, options);

  assert.equal(json.summary.total, 2);
  assert.equal(json.summary.failed, 1);
  assert.match(junit, /tests="2" failures="1"/);
  assert.match(junit, /A &amp; B/);
  assert.match(junit, /Failure &lt;case&gt;/);
  assert.match(markdown, /Passed \*\*1\/2\*\* \(50\.0%\)/);
  assert.match(markdown, /## Failures/);
  assert.match(markdown, /outside tolerance/);
  assert.match(markdown, /unspecified · diagnostic only/);
  assert.match(html, /1\/2 passed/);
  assert.match(html, /Failure &lt;case&gt;/);
  assert.match(html, /unspecified · diagnostic only/);
});
