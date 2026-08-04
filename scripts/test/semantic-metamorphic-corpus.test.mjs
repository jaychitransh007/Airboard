import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { execFile } from "node:child_process";
import { access, readFile } from "node:fs/promises";
import { promisify } from "node:util";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import {
  SEMANTIC_METAMORPHIC_MAX_TRANSCRIPT_CHARACTERS,
  SEMANTIC_METAMORPHIC_MIN_SCENARIOS,
  SEMANTIC_SOURCE_MIN_CASES,
  analyzeSemanticSourceCoverage,
  expandSemanticMetamorphicCorpus,
  validateProductionSemanticContract,
  validateSemanticMetamorphicCorpus,
  validateSemanticSourceCorpus,
} from "../lib/semantic-metamorphic-corpus.mjs";
import {
  buildSemanticRunnerArguments,
  delegateSemanticMetamorphicLive,
  parseSemanticMetamorphicArguments,
  withMaterializedSemanticCorpus,
} from "../eval-semantic-metamorphic.mjs";

const execFileAsync = promisify(execFile);
const SOURCE_URL = new URL(
  "../../evals/voice-intent/v1.json",
  import.meta.url,
);

async function loadSourceCorpus() {
  return JSON.parse(await readFile(SOURCE_URL, "utf8"));
}

test("production plan schema and capability registry remain aligned", () => {
  const contract = validateProductionSemanticContract();

  assert.equal(contract.valid, true);
  assert.deepEqual(contract.statuses, [
    "clarification",
    "resolved",
    "unsupported",
  ]);
  assert.ok(contract.actionTypes.includes("create"));
  assert.ok(contract.actionTypes.includes("reverse_connection"));
  assert.ok(contract.nodeTypes.includes("database"));
});

test("metamorphic expansion is deterministic and exceeds 600 stable scenarios", async () => {
  const source = await loadSourceCorpus();
  const first = expandSemanticMetamorphicCorpus(source);
  const second = expandSemanticMetamorphicCorpus(source);
  const validation = validateSemanticMetamorphicCorpus(first, {
    sourceCorpus: source,
  });

  assert.deepEqual(first, second);
  assert.equal(source.semanticPromptVersion, "2.8");
  assert.equal(first.metamorphic.semanticPromptVersion, "2.8");
  assert.ok(first.cases.length >= SEMANTIC_METAMORPHIC_MIN_SCENARIOS);
  const nonPendingCases = source.cases.filter(
    ({ pendingClarification }) => pendingClarification === undefined,
  ).length;
  assert.equal(
    first.cases.length,
    source.cases.length * 21 + nonPendingCases * 16,
  );
  assert.equal(new Set(first.cases.map(({ id }) => id)).size, first.cases.length);
  assert.equal(validation.valid, true);
  assert.ok(
    validation.summary.distinctRequestCount >=
      SEMANTIC_METAMORPHIC_MIN_SCENARIOS,
  );
  assert.ok(
    validation.summary.maxTranscriptCharacters <=
      SEMANTIC_METAMORPHIC_MAX_TRANSCRIPT_CHARACTERS,
  );
  for (const invariant of [
    "casing",
    "courtesy",
    "disfluency",
    "board-order",
    "irrelevant-object",
    "opaque-id",
  ]) {
    assert.ok(validation.summary.invariantCounts[invariant] > 0);
  }

  const sourceById = new Map(
    source.cases.map((sourceCase) => [sourceCase.id, sourceCase]),
  );
  for (const scenario of first.cases) {
    assert.deepEqual(
      scenario.expected,
      sourceById.get(scenario.metamorphic.sourceCaseId).expected,
    );
  }
});

test("source corpus covers long narratives and high-risk semantic boundaries", async () => {
  const source = await loadSourceCorpus();
  const sourceById = new Map(
    source.cases.map((sourceCase) => [sourceCase.id, sourceCase]),
  );
  const requiredCases = [
    "airboard-brand-narrative-flow",
    "airboard-authentication-round-trip-flow",
    "existing-board-fan-in-dense-data-dataset",
    "existing-board-fan-in-one-edge-existing",
    "existing-board-fan-in-already-satisfied",
    "lengthy-checkout-narrative-475",
    "acoustic-repair-api-queue",
    "clarify-dense-duplicate-cache-delete",
    "clarify-parallel-connector-delete",
    "delete-second-parallel-connector",
    "explicit-unique-destructive-delete",
    "prompt-injection-is-data",
    "unsupported-export-workflow",
  ];
  for (const id of requiredCases) {
    assert.ok(sourceById.has(id), `missing semantic boundary case ${id}`);
    assert.ok(
      sourceById.get(id).expected.finalState,
      `${id} must define a grounded final-state oracle`,
    );
  }
  assert.equal(
    source.cases.every(({ expected }) => expected.finalState !== undefined),
    true,
    "every semantic seed should declare its expected board delta",
  );

  const denseFanIn = sourceById.get(
    "existing-board-fan-in-dense-data-dataset",
  );
  assert.equal(denseFanIn.context.objects.length >= 8, true);
  assert.equal(denseFanIn.context.selectionCount, 0);
  assert.deepEqual(denseFanIn.expected.actionTypeCounts, { connect: 2 });

  const alreadySatisfied = sourceById.get(
    "existing-board-fan-in-already-satisfied",
  );
  assert.equal(alreadySatisfied.expected.status, "already_satisfied");
  assert.deepEqual(alreadySatisfied.expected.actionTypeCounts, {});
  assert.equal(alreadySatisfied.expected.finalState.edgeCountDelta, 0);

  const lengthy = sourceById.get("lengthy-checkout-narrative-475");
  assert.ok(lengthy.transcript.length >= 450);
  assert.ok(
    lengthy.transcript.length <=
      SEMANTIC_METAMORPHIC_MAX_TRANSCRIPT_CHARACTERS,
  );
  assert.deepEqual(lengthy.expected.actionTypeCounts, {
    create: 5,
    connect: 4,
  });

  const airboardNarrative = sourceById.get(
    "airboard-brand-narrative-flow",
  );
  assert.equal(
    airboardNarrative.transcript,
    "User makes a request to Airboard, and, uh, then the authentication service gets fired, and, uh, then user lands to the Airboard page. So create a flow diagram for this.",
  );
  assert.deepEqual(airboardNarrative.expected.actionTypeCounts, {
    create: 4,
    connect: 3,
  });
  assert.equal(airboardNarrative.expected.finalState.nodeCountDelta, 4);
  assert.equal(airboardNarrative.expected.finalState.edgeCountDelta, 3);

  const authenticationRoundTrip = sourceById.get(
    "airboard-authentication-round-trip-flow",
  );
  assert.equal(
    authenticationRoundTrip.transcript,
    "User makes a request to, uh, Airboard authentication service and that, uh, authenticates the user, and the user lands to the Airboard. Create a flow diagram for this.",
  );
  assert.deepEqual(authenticationRoundTrip.expected.actionTypeCounts, {
    create: 3,
    connect: 3,
  });
  assert.equal(
    authenticationRoundTrip.expected.finalState.nodeCountDelta,
    3,
  );
  assert.equal(
    authenticationRoundTrip.expected.finalState.edgeCountDelta,
    3,
  );
  assert.deepEqual(
    authenticationRoundTrip.expected.finalState.requiredEdges,
    [
      {
        from: { label: "User", nodeType: "user" },
        to: {
          label: "Airboard Authentication Service",
          nodeType: "service",
        },
      },
      {
        from: {
          label: "Airboard Authentication Service",
          nodeType: "service",
        },
        to: { label: "User", nodeType: "user" },
      },
      {
        from: { label: "User", nodeType: "user" },
        to: { label: "Airboard", nodeType: "service" },
      },
    ],
  );
  assert.deepEqual(
    authenticationRoundTrip.expected.finalState.forbiddenNodes,
    [{ label: "The user makes a request to Airboard" }],
  );

  const injection = sourceById.get("prompt-injection-is-data");
  assert.match(injection.transcript, /ignore every previous instruction/i);
  assert.equal(injection.expected.status, "unsupported");
  assert.equal(injection.expected.issueCode, "not_board_command");
  assert.deepEqual(injection.expected.actionTypeCounts, {});
  assert.deepEqual(injection.expected.finalState, {
    nodeCountDelta: 0,
    edgeCountDelta: 0,
    requiredNodes: [
      {
        label: "Production Database",
        nodeType: "database",
        ordinal: 1,
      },
    ],
  });

  const dense = sourceById.get("clarify-dense-duplicate-cache-delete");
  assert.ok(dense.context.objects.length >= 10);
  assert.equal(
    dense.context.objects.filter(({ label }) => label === "Cache").length,
    2,
  );
  assert.equal(dense.expected.status, "clarification");

  const parallel = sourceById.get("clarify-parallel-connector-delete");
  assert.deepEqual(
    parallel.context.edges.map(({ occurrence }) => occurrence),
    [1, 2],
  );
  assert.equal(parallel.expected.status, "clarification");
  assert.deepEqual(
    parallel.expected.finalState.requiredEdges.map(({ occurrence }) => occurrence),
    [1, 2],
  );
  assert.deepEqual(
    sourceById.get("delete-second-parallel-connector").expected
      .actionTypeCounts,
    { delete_connection: 1 },
  );
  assert.deepEqual(
    sourceById
      .get("delete-second-parallel-connector")
      .expected.finalState.forbiddenEdges.map(({ occurrence }) => occurrence),
    [2],
  );

  const acoustic = sourceById.get("acoustic-repair-api-queue");
  assert.match(acoustic.transcript, /A P eye—sorry, API/i);
  assert.match(acoustic.transcript, /cue, I mean Orders Queue/i);

  const destructive = sourceById.get("explicit-unique-destructive-delete");
  assert.equal(destructive.context.objects.length, 2);
  assert.deepEqual(destructive.expected.actionTypeCounts, { delete: 1 });
});

test("independent semantic seeds cover every action, reference, risk, status, and context class before expansion", async () => {
  const source = await loadSourceCorpus();
  const validation = validateSemanticSourceCorpus(source);
  const coverage = analyzeSemanticSourceCoverage(source.cases);

  assert.equal(validation.valid, true);
  assert.ok(source.cases.length >= SEMANTIC_SOURCE_MIN_CASES);
  assert.deepEqual(coverage.actionTypes, [
    "align",
    "branch",
    "cancel",
    "connect",
    "create",
    "delete",
    "delete_connection",
    "distribute",
    "duplicate",
    "group",
    "layout",
    "move",
    "rename",
    "reverse_connection",
    "select",
    "undo",
  ]);
  assert.deepEqual(coverage.referenceTypes, [
    "connection",
    "current_selection",
    "plan_handle",
    "pointer",
    "type_ordinal",
    "visible_label",
  ]);
  for (const required of [
    "dense_board",
    "parallel_edges",
    "selection",
    "stale_or_missing_context",
  ]) {
    assert.ok(coverage.contextClasses.includes(required));
  }

  const missingAction = structuredClone(source);
  missingAction.cases = missingAction.cases.filter(
    ({ expected }) => expected.actionTypeCounts?.distribute !== 1,
  );
  const missingValidation = validateSemanticSourceCorpus(missingAction);
  assert.equal(missingValidation.valid, false);
  assert.ok(
    missingValidation.errors.some(
      ({ code, message }) =>
        code === "source.action-coverage" &&
        message.includes("distribute"),
    ),
  );
});

test("each invariant mutates only its intended semantic dimension", async () => {
  const source = await loadSourceCorpus();
  const corpus = expandSemanticMetamorphicCorpus(source);
  const sourceCase = source.cases.find(
    ({ id }) => id === "create-condition-block",
  );
  const scenario = (invariant, variant) =>
    corpus.cases.find(
      ({ metamorphic }) =>
        metamorphic.sourceCaseId === sourceCase.id &&
        metamorphic.invariant === invariant &&
        metamorphic.variant === variant,
    );

  assert.equal(
    scenario("casing", "uppercase").transcript,
    sourceCase.transcript.toUpperCase(),
  );
  assert.match(
    scenario("courtesy", "could-you-please").transcript,
    /^Airo could you please /,
  );
  assert.match(
    scenario("disfluency", "repeated-filler").transcript,
    /^Airo um, um, /,
  );
  assert.deepEqual(
    scenario("board-order", "reverse").context.objects.map(({ label }) => label),
    [...sourceCase.context.objects].reverse().map(({ label }) => label),
  );

  const irrelevant = scenario("irrelevant-object", "document");
  assert.equal(
    irrelevant.context.objects.length,
    sourceCase.context.objects.length + 1,
  );
  assert.ok(
    irrelevant.context.objects.some(
      ({ label, nodeType }) =>
        label === "Fixture Release Notes" && nodeType === "document",
    ),
  );

  const opaque = scenario("opaque-id", "alpha");
  assert.equal(opaque.transcript, sourceCase.transcript);
  assert.match(opaque.context.boardId, /^metamorphic-fixture-alpha-/);
  assert.ok(
    opaque.context.objects.every(({ id }) =>
      id.startsWith("metamorphic-fixture-alpha-object-"),
    ),
  );

  const pendingSource = source.cases.find(
    ({ pendingClarification }) => pendingClarification !== undefined,
  );
  assert.equal(
    corpus.cases.some(
      ({ metamorphic }) =>
        metamorphic.sourceCaseId === pendingSource.id &&
        ["courtesy", "disfluency"].includes(metamorphic.invariant),
    ),
    false,
    "literal clarification answers must not acquire courtesy or fillers",
  );
});

test("metamorphic fixtures do not invent participant data", async () => {
  const source = await loadSourceCorpus();
  const corpus = expandSemanticMetamorphicCorpus(source);
  const forbiddenKeys = [];

  const visit = (value, path = "") => {
    if (Array.isArray(value)) {
      value.forEach((item, index) => visit(item, `${path}/${index}`));
      return;
    }
    if (!value || typeof value !== "object") return;
    for (const [key, child] of Object.entries(value)) {
      const childPath = `${path}/${key}`;
      if (/participant|speaker|demographic/iu.test(key)) {
        forbiddenKeys.push(childPath);
      }
      visit(child, childPath);
    }
  };
  visit(corpus);
  assert.deepEqual(forbiddenKeys, []);
});

test("validation rejects corpus drift, oversized transcripts, and insufficient coverage", async () => {
  const source = await loadSourceCorpus();
  const corpus = expandSemanticMetamorphicCorpus(source);
  const tampered = structuredClone(corpus);
  tampered.metamorphic.semanticPromptVersion = "stale";
  tampered.metamorphic.capabilityRegistryVersion = "stale";
  tampered.cases[0].expected.status = "invented";
  tampered.cases[1].transcript = "x".repeat(
    SEMANTIC_METAMORPHIC_MAX_TRANSCRIPT_CHARACTERS + 1,
  );
  tampered.cases[2].expected.actionTypeCounts = { teleport: 1 };
  tampered.cases[3].expected.status = "clarification";
  tampered.cases[3].expected.issueCode = "ambiguous_reference";
  tampered.cases[3].expected.actionTypeCounts = {};
  tampered.cases[3].expected.finalState.nodeCountDelta = 1;
  tampered.cases[4].expected.finalState.requiredEdges = [
    { from: { nodeType: "invented" }, to: { nodeType: "api" } },
  ];
  tampered.cases = tampered.cases.slice(0, 10);
  tampered.metamorphic.scenarioCount = tampered.cases.length;
  const validation = validateSemanticMetamorphicCorpus(tampered, {
    sourceCorpus: source,
  });
  const codes = new Set(validation.errors.map(({ code }) => code));

  assert.equal(validation.valid, false);
  assert.ok(codes.has("corpus.prompt-version"));
  assert.ok(codes.has("corpus.capability-version"));
  assert.ok(codes.has("corpus.minimum-scenarios"));
  assert.ok(codes.has("case.expected-status"));
  assert.ok(codes.has("case.expected-actions"));
  assert.ok(codes.has("case.transcript"));
  assert.ok(codes.has("case.expected-safe-noop"));
  assert.ok(codes.has("case.expected-edge-constraint"));
  assert.ok(codes.has("scenario.expectation-invariant"));

  const staleSource = structuredClone(source);
  staleSource.semanticPromptVersion = "stale";
  const staleSourceValidation =
    validateSemanticSourceCorpus(staleSource);
  assert.equal(staleSourceValidation.valid, false);
  assert.ok(
    staleSourceValidation.errors.some(
      ({ code }) => code === "source.prompt-version",
    ),
  );
});

test("CLI parsing keeps validation offline and forwards explicit live options", () => {
  assert.deepEqual(parseSemanticMetamorphicArguments([]), {
    attempts: 1,
    caseIds: [],
    help: false,
    live: false,
  });
  assert.throws(
    () =>
      parseSemanticMetamorphicArguments([
        "--validate-only",
        "--attempts",
        "2",
      ]),
    /--attempts requires --live/,
  );
  assert.throws(
    () =>
      parseSemanticMetamorphicArguments(["--validate-only", "--live"]),
    /mutually exclusive/,
  );

  const live = parseSemanticMetamorphicArguments([
    "--live",
    "--attempts",
    "3",
    "--api-url",
    "http://127.0.0.1:4000",
    "--case",
    "seed--meta-casing-uppercase",
  ]);
  assert.equal(live.live, true);
  assert.equal(live.attempts, 3);
  assert.deepEqual(live.caseIds, ["seed--meta-casing-uppercase"]);
  assert.deepEqual(
    buildSemanticRunnerArguments({
      fixturePath: "/tmp/corpus.json",
      attempts: live.attempts,
      apiUrl: live.apiUrl,
      caseIds: live.caseIds,
    }),
    [
      "--fixture",
      "/tmp/corpus.json",
      "--attempts",
      "3",
      "--api-url",
      "http://127.0.0.1:4000",
      "--case",
      "seed--meta-casing-uppercase",
    ],
  );
});

test("temporary materialization is readable during delegation and removed afterward", async () => {
  const tinyCorpus = {
    schemaVersion: "1.0",
    cases: [{ id: "fixture" }],
  };
  let materializedPath;
  const callbackResult = await withMaterializedSemanticCorpus(
    tinyCorpus,
    async (fixturePath) => {
      materializedPath = fixturePath;
      const parsed = JSON.parse(await readFile(fixturePath, "utf8"));
      assert.deepEqual(parsed, tinyCorpus);
      return "done";
    },
  );

  assert.equal(callbackResult, "done");
  await assert.rejects(access(materializedPath), { code: "ENOENT" });
});

test("live delegation invokes the existing semantic runner with the temp fixture", async () => {
  const tinyCorpus = {
    schemaVersion: "1.0",
    cases: [{ id: "fixture" }],
  };
  let invocation;
  let materializedPath;
  const spawnImpl = (command, args, options) => {
    invocation = { command, args, options };
    const fixtureIndex = args.indexOf("--fixture");
    materializedPath = args[fixtureIndex + 1];
    const child = new EventEmitter();
    queueMicrotask(() => child.emit("exit", 0, null));
    return child;
  };

  const result = await delegateSemanticMetamorphicLive({
    corpus: tinyCorpus,
    attempts: 4,
    runnerPath: "/repo/scripts/eval-voice-intent.mjs",
    repositoryRoot: "/repo",
    apiUrl: "http://127.0.0.1:4000",
    caseIds: ["fixture"],
    replayCommand:
      "'node' 'scripts/eval-semantic-metamorphic.mjs' '--live' '--case' 'fixture'",
    spawnImpl,
    environment: { AIRBOARD_EVAL_MODEL: "fixture-model" },
  });

  assert.equal(result.exitCode, 0);
  assert.equal(invocation.command, process.execPath);
  assert.equal(invocation.args[0], "/repo/scripts/eval-voice-intent.mjs");
  assert.deepEqual(invocation.args.slice(1), [
    "--fixture",
    materializedPath,
    "--attempts",
    "4",
    "--api-url",
    "http://127.0.0.1:4000",
    "--case",
    "fixture",
  ]);
  assert.equal(invocation.options.cwd, "/repo");
  assert.equal(
    invocation.options.env.AIRBOARD_EVAL_REPLAY_COMMAND,
    "'node' 'scripts/eval-semantic-metamorphic.mjs' '--live' '--case' 'fixture'",
  );
  await assert.rejects(access(materializedPath), { code: "ENOENT" });
});

test("validate-only CLI generates and validates without calling the live runner", async () => {
  const scriptPath = fileURLToPath(
    new URL("../eval-semantic-metamorphic.mjs", import.meta.url),
  );
  const repositoryRoot = fileURLToPath(new URL("../../", import.meta.url));
  const { stdout } = await execFileAsync(
    process.execPath,
    [scriptPath, "--validate-only"],
    {
      cwd: repositoryRoot,
      env: { ...process.env, NODE_NO_WARNINGS: "1" },
    },
  );

  const scenarioCount = Number(
    stdout.match(/Scenarios:\s+(\d+) \/ \d+ distinct inputs \(minimum 600\)/)?.[1],
  );
  assert.ok(scenarioCount >= SEMANTIC_METAMORPHIC_MIN_SCENARIOS);
  assert.match(stdout, /casing=\d+/);
  assert.match(stdout, /opaque-id=\d+/);
  assert.match(stdout, /Result: VALID \(offline validation only\)/);
  assert.doesNotMatch(stdout, /Live delegation:/);
});
