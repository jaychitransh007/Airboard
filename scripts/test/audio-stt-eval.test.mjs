import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  createDeepgramReplayAdapter,
  createFakeTranscriptionAdapter,
  createLiveGatewayWebSocketAdapter,
  createMeetBridgeReplayAdapter,
} from "../lib/audio-stt-eval/adapters.mjs";
import {
  loadAudioAssetManifest,
} from "../lib/audio-stt-eval/assets.mjs";
import {
  scoreAudioSttEvents,
  scoreAudioSttEventsWithSemantic,
} from "../lib/audio-stt-eval/oracle.mjs";
import {
  createFakeSemanticAdapter,
  createLiveSemanticApiAdapter,
  createRecordedSemanticAdapter,
} from "../lib/audio-stt-eval/semantic-adapters.mjs";
import {
  runAudioSttScenarios,
} from "../lib/audio-stt-eval/runner.mjs";
import {
  aggregateMetrics,
  buildAudioSlices,
  evaluateAudioGates,
  selectRepresentativeScenarios,
} from "../eval-audio-stt.mjs";
import {
  parsePcm16Wav,
  Pcm16WavError,
  streamPcm16WavFrames,
} from "../lib/audio-stt-eval/wav.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

test("canary selection is stable and covers diverse live-audio facets first", () => {
  const scenarios = [
    {
      id: "z-core-ptt",
      adapter: "live-websocket",
      channel: "ptt",
      evaluationClass: "core",
      processingPath: "deterministic",
      surface: "standalone",
    },
    {
      id: "a-core-wake",
      adapter: "live-websocket",
      channel: "wake",
      evaluationClass: "core",
      processingPath: "deterministic",
      surface: "standalone",
    },
    {
      id: "m-meet-narrative",
      adapter: "meet-bridge-replay",
      channel: "scoped",
      evaluationClass: "narrative",
      processingPath: "semantic",
      surface: "meet-main-stage",
      accent: "indian-english",
    },
    {
      id: "b-safety",
      adapter: "live-websocket",
      channel: "wake",
      evaluationClass: "safety",
      processingPath: "no_route",
      surface: "standalone",
    },
  ];

  const first = selectRepresentativeScenarios(scenarios, 3);
  const second = selectRepresentativeScenarios(
    [...scenarios].reverse(),
    3,
  );
  assert.deepEqual(
    first.map(({ id }) => id),
    second.map(({ id }) => id),
  );
  assert.ok(first.some(({ adapter }) => adapter === "meet-bridge-replay"));
  assert.equal(new Set(first.map(({ evaluationClass }) => evaluationClass)).size, 3);
});

test("validates mono PCM16 WAV and streams production-cadence frames", () => {
  const content = syntheticWav({ sampleCount: 1_600 });
  const wav = parsePcm16Wav(content);
  assert.equal(wav.sampleRate, 16_000);
  assert.equal(wav.channels, 1);
  assert.equal(wav.bitsPerSample, 16);
  assert.equal(wav.sampleCount, 1_600);
  assert.equal(wav.durationSeconds, 0.1);

  const frames = [...streamPcm16WavFrames(wav)];
  assert.equal(frames.length, 2);
  assert.equal(frames[0].byteLength, 2_560);
  assert.equal(frames[1].byteLength, 2_560);
  assert.equal(new DataView(frames[0].buffer).getInt16(0, true), 1_000);
  assert.equal(new DataView(frames[1].buffer).getInt16(0, true), 1_000);
  assert.equal(new DataView(frames[1].buffer).getInt16(2_558, true), 0);
});

test("rejects WAV formats the production transcription protocol cannot accept", () => {
  const cases = [
    [syntheticWav({ channels: 2 }), "WAV_NOT_MONO"],
    [syntheticWav({ bitsPerSample: 8 }), "WAV_NOT_PCM16"],
    [syntheticWav({ audioFormat: 3 }), "WAV_NOT_LINEAR_PCM"],
    [syntheticWav({ sampleRate: 22_050 }), "WAV_UNSUPPORTED_SAMPLE_RATE"],
  ];
  for (const [content, code] of cases) {
    assert.throws(
      () => parsePcm16Wav(content),
      (error) => error instanceof Pcm16WavError && error.code === code,
    );
  }
});

test("fake and recorded-provider adapters share critical-token and routed-action scoring", async () => {
  const scenarios = [
    scenario({
      id: "fake",
      adapter: "fake",
      source: {
        events: [{ type: "final", transcript: "add an API here" }],
      },
      criticalTokens: ["api"],
      expectedActions: ["create_node"],
    }),
    scenario({
      id: "replay",
      adapter: "deepgram-replay",
      source: {
        messages: [
          {
            type: "TurnInfo",
            event: "EndOfTurn",
            turn_index: 4,
            transcript: "add a database here",
          },
          {
            type: "TurnInfo",
            event: "EndOfTurn",
            turn_index: 4,
            transcript: "add a database here",
          },
        ],
      },
      criticalTokens: ["database"],
      expectedActions: ["create_node"],
    }),
  ];
  const report = await runAudioSttScenarios({
    scenarios,
    adapters: [
      createFakeTranscriptionAdapter(),
      createDeepgramReplayAdapter(),
    ],
  });

  assert.equal(report.passed, true);
  assert.deepEqual(report.summary, {
    total: 2,
    passed: 2,
    failed: 0,
    skipped: 0,
  });
  assert.equal(report.results[1].assessment.finalCount, 1);
  assert.deepEqual(report.results[1].assessment.routedActions, ["create_node"]);
  assert.deepEqual(report.results[1].assessment.finalTranscriptCharacters, [19]);
  assert.equal(
    report.results[1].assessment.boardOutcome.effects.nodeCountDelta,
    1,
  );
  assert.equal(
    report.results[1].assessment.boardOutcome.undoChecks[0]
      .roundTripPassed,
    true,
  );
});

test("critical-token failures are independent from downstream action success", () => {
  const assessment = scoreAudioSttEvents(
    scenario({
      id: "critical-miss",
      adapter: "fake",
      source: {},
      criticalTokens: ["api"],
      expectedActions: ["create_node"],
    }),
    [{ type: "final", transcript: "add a service here" }],
  );
  assert.equal(assessment.passed, false);
  assert.equal(assessment.criticalTokens.recall, 0);
  assert.equal(assessment.actionScore.f1, 1);
  assert.match(assessment.failures[0], /critical-token recall/u);
});

test("routed-command hashing detects truncation without storing command text", () => {
  const transcript = "add an API here";
  const fixture = scenario({
    id: "routed-command-integrity",
    adapter: "fake",
    source: {},
    criticalTokens: ["api"],
    expectedActions: ["create_node"],
  });
  fixture.oracle.expectedRoutedCommandSha256 = createHash("sha256")
    .update(transcript)
    .digest("hex");

  const intact = scoreAudioSttEvents(fixture, [
    { type: "final", transcript },
  ]);
  assert.equal(intact.passed, true);

  const mismatched = scoreAudioSttEvents(
    {
      ...fixture,
      oracle: {
        ...fixture.oracle,
        expectedRoutedCommandSha256: "0".repeat(64),
      },
    },
    [{ type: "final", transcript }],
  );
  assert.equal(mismatched.passed, false);
  assert.ok(
    mismatched.failures.some((failure) =>
      failure.includes("expected complete turn"),
    ),
  );
});

test("fake and recorded semantic adapters share production grounding and Undo", async () => {
  const base = {
    adapter: "fake",
    privacyClass: "synthetic",
    evaluationClass: "narrative",
    channel: "ptt",
    processingPath: "semantic",
    context: {
      selectionCount: 0,
      selected: [],
      objects: [],
      edges: [],
      projectGlossary: [],
      pointerAvailable: false,
    },
    finalState: {
      nodeCountDelta: 1,
      edgeCountDelta: 0,
      requiredNodes: [{ label: "Gateway", nodeType: "api" }],
    },
    oracle: {
      criticalTokens: ["gateway"],
      expectedActions: ["create"],
      expectedSemanticStatus: "resolved",
      expectedFinalCount: 1,
      minimumCriticalTokenRecall: 1,
      minimumActionF1: 1,
      requireExactActions: true,
    },
  };
  const plan = {
    version: "1.1",
    status: "resolved",
    issueCode: "none",
    clarificationQuestion: null,
    missingSlots: [],
    actions: [
      {
        type: "create",
        nodeType: "api",
        label: "Gateway",
        handle: "gateway",
        placement: { kind: "auto" },
      },
    ],
  };
  for (const [semanticAdapter, source, adapter] of [
    ["fake", { fakeSemanticPlan: plan }, createFakeSemanticAdapter()],
    [
      "recorded-replay",
      { semanticPlan: plan },
      createRecordedSemanticAdapter(),
    ],
  ]) {
    const assessment = await scoreAudioSttEventsWithSemantic(
      {
        ...base,
        id: `semantic-${semanticAdapter}`,
        semanticAdapter,
        source,
      },
      [{ type: "final", transcript: "Sketch a Gateway for me" }],
      {},
      new Map([[adapter.id, adapter]]),
    );
    assert.equal(assessment.passed, true);
    assert.equal(assessment.processingPath, "semantic");
    assert.deepEqual(assessment.routedActions, ["create"]);
    assert.equal(assessment.boardOutcome.effects.nodeCountDelta, 1);
    assert.equal(
      assessment.boardOutcome.undoChecks[0].roundTripPassed,
      true,
    );
  }
});

test("live semantic adapter authenticates, retries one transient response, and parses production plan 1.1", async () => {
  let requests = 0;
  const adapter = createLiveSemanticApiAdapter({
    apiBaseUrl: "http://127.0.0.1:4000",
    origin: "http://localhost:3000",
    model: "candidate-model",
    apiToken: "eval-token",
    fetchImpl: async (_url, init) => {
      requests += 1;
      assert.equal(init.headers.Authorization, "Bearer eval-token");
      if (requests === 1) {
        return new Response(
          JSON.stringify({ error: "PROVIDER_UNAVAILABLE" }),
          {
            status: 503,
            headers: { "Content-Type": "application/json" },
          },
        );
      }
      return new Response(
        JSON.stringify({
          plan: {
            version: "1.1",
            status: "unsupported",
            issueCode: "not_board_command",
            clarificationQuestion: null,
            missingSlots: [],
            actions: [],
          },
          provider: "openai",
          model: "candidate-model",
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        },
      );
    },
  });
  const result = await adapter.resolve({
    interactionId: "audio-live-semantic",
    transcript: "schedule the meeting",
    parserIssue: "unknown_command",
    context: {
      selectionCount: 0,
      selected: [],
      objects: [],
      edges: [],
      projectGlossary: [],
      pointerAvailable: false,
    },
  });
  assert.equal(requests, 2);
  assert.equal(result.retryCount, 1);
  assert.equal(result.plan.status, "unsupported");
});

test("malformed semantic output is a blocking quality failure, not provider infrastructure", async () => {
  const malformedScenario = {
    ...scenario({
      id: "malformed-semantic",
      adapter: "fake",
      source: {
        events: [
          {
            type: "final",
            transcript: "please make the system resilient in the usual way",
          },
        ],
        semanticPlan: { version: "1.0", actions: [] },
      },
      criticalTokens: ["system"],
      expectedActions: [],
    }),
    processingPath: "semantic",
    semanticAdapter: "recorded-replay",
    context: {
      selectionCount: 0,
      selected: [],
      objects: [],
      edges: [],
      projectGlossary: [],
      pointerAvailable: false,
    },
    finalState: {
      nodeCountDelta: 0,
      edgeCountDelta: 0,
    },
    oracle: {
      criticalTokens: ["system"],
      expectedActions: [],
      expectedFinalCount: 1,
      expectedSemanticStatus: "resolved",
      maximumRoutedActions: 0,
    },
  };
  const report = await runAudioSttScenarios({
    scenarios: [malformedScenario],
    adapters: [createFakeTranscriptionAdapter()],
    semanticAdapters: [createRecordedSemanticAdapter()],
  });

  assert.equal(report.results[0].failureClass, "quality");
  assert.equal(
    report.results[0].failureStage,
    "semantic_output_validation",
  );
  assert.match(report.results[0].failures[0], /^quality error:/u);
});

test("only retryable live transport failures are provider infrastructure", async () => {
  let attempts = 0;
  const report = await runAudioSttScenarios({
    scenarios: [
      scenario({
        id: "transient-provider",
        adapter: "live-websocket",
        source: {},
        criticalTokens: ["api"],
        expectedActions: ["create_node"],
      }),
    ],
    adapters: [
      {
        id: "live-websocket",
        requiresAsset: false,
        liveProvider: true,
        retryTransientFailures: true,
        async run() {
          attempts += 1;
          throw new Error("socket closed by transcription provider");
        },
      },
    ],
  });

  assert.equal(attempts, 2);
  assert.equal(
    report.results[0].failureClass,
    "provider_infrastructure",
  );
  assert.equal(
    report.results[0].failureStage,
    "transcription_provider",
  );
});

test("live WebSocket adapter streams verified WAV frames through the same oracle", async () => {
  let socket;
  let requestedUrl;
  let requestedSocketOptions;
  const wav = parsePcm16Wav(syntheticWav({ sampleCount: 1_600 }));
  const liveScenario = scenario({
    id: "live",
    adapter: "live-websocket",
    assetId: "synthetic-wav",
    source: { url: "ws://localhost/transcription/ws" },
    criticalTokens: ["database"],
    expectedActions: ["create_node"],
  });
  const report = await runAudioSttScenarios({
    scenarios: [liveScenario],
    adapters: [
      createLiveGatewayWebSocketAdapter({
        createWebSocket: (url, options) => {
          requestedUrl = url;
          requestedSocketOptions = options;
          socket = new FakeGatewaySocket("add a database here");
          return socket;
        },
        accessToken: "synthetic-eval-token",
        apiToken: "synthetic-shared-token",
        frameDelayMs: 0,
        origin: "http://localhost:3000",
        timeoutMs: 1_000,
      }),
    ],
    assetCatalog: {
      async load() {
        return {
          id: "synthetic-wav",
          sha256: "0".repeat(64),
          privacyClass: "synthetic",
          wav,
        };
      },
    },
    requireAssets: true,
  });

  assert.equal(report.passed, true);
  assert.ok(socket);
  assert.equal(
    new URL(requestedUrl).searchParams.get("access_token"),
    "synthetic-eval-token",
  );
  assert.equal(
    new URL(requestedUrl).searchParams.get("token"),
    "synthetic-shared-token",
  );
  assert.deepEqual(requestedSocketOptions, {
    origin: "http://localhost:3000",
  });
  assert.equal(report.results[0].assessment.criticalTokens.recall, 1);
  assert.deepEqual(report.results[0].assessment.routedActions, ["create_node"]);
  assert.equal(
    report.results[0].assessment.boardOutcome.effects.nodeCountDelta,
    1,
  );
  assert.equal(
    Number.isFinite(report.results[0].assessment.endToActionMs),
    true,
  );
  const controls = socket.sent
    .filter((value) => typeof value === "string")
    .map((value) => JSON.parse(value));
  assert.equal(controls[0].type, "transcription.start");
  assert.equal(controls[0].sampleRate, 16_000);
  assert.equal(controls.at(-1).type, "transcription.stop");
  assert.deepEqual(
    socket.sent
      .filter((value) => value instanceof Uint8Array)
      .map((value) => value.byteLength),
    [2_560, 2_560],
  );
});

test("Meet replay traverses the production bridge protocol and realtime PCM path before STT", async () => {
  let socket;
  let requestedUrl;
  let requestedSocketOptions;
  const wav = parsePcm16Wav(syntheticWav({ sampleCount: 1_600 }));
  const meetScenario = {
    ...scenario({
      id: "meet-live",
      adapter: "meet-bridge-replay",
      assetId: "synthetic-meet-wav",
      source: { url: "ws://localhost/transcription/ws" },
      criticalTokens: ["database"],
      expectedActions: ["create_node"],
    }),
    surface: "meet-side-panel",
    transport: "meet-bridge",
  };
  const report = await runAudioSttScenarios({
    scenarios: [meetScenario],
    adapters: [
      createMeetBridgeReplayAdapter({
        createWebSocket: (url, options) => {
          requestedUrl = url;
          requestedSocketOptions = options;
          socket = new FakeGatewaySocket("add a database here");
          return socket;
        },
        accessToken: "synthetic-eval-token",
        apiToken: "synthetic-shared-token",
        frameDelayMs: 0,
        origin: "http://localhost:3000",
        timeoutMs: 1_000,
      }),
    ],
    assetCatalog: {
      async load() {
        return {
          id: "synthetic-meet-wav",
          sha256: "0".repeat(64),
          privacyClass: "synthetic",
          wav,
        };
      },
    },
    requireAssets: true,
  });

  assert.equal(report.passed, true);
  assert.equal(report.results[0].diagnostics.source, "meet-bridge-replay");
  assert.equal(report.results[0].diagnostics.transportVerified, true);
  assert.equal(report.results[0].diagnostics.bridgeProtocolVersion, 1);
  assert.equal(report.results[0].diagnostics.bridgeChunksSent, 2);
  assert.equal(report.results[0].diagnostics.bridgeSamplesSent, 1_600);
  assert.equal(report.results[0].diagnostics.bridgeStopObserved, true);
  assert.equal(
    new URL(requestedUrl).searchParams.get("access_token"),
    "synthetic-eval-token",
  );
  assert.equal(
    new URL(requestedUrl).searchParams.get("token"),
    "synthetic-shared-token",
  );
  assert.deepEqual(requestedSocketOptions, {
    origin: "http://localhost:3000",
  });
  const controls = socket.sent
    .filter((value) => typeof value === "string")
    .map((value) => JSON.parse(value));
  assert.equal(controls[0].type, "transcription.start");
  assert.equal(controls[0].sampleRate, 16_000);
  assert.equal(controls.at(-1).type, "transcription.stop");
  assert.deepEqual(
    socket.sent
      .filter((value) => value instanceof ArrayBuffer)
      .map((value) => value.byteLength),
    [2_560, 2_560],
  );
});

test("Meet-tagged scenarios fail closed when they try to use direct WAV transport", async () => {
  await assert.rejects(
    () =>
      runAudioSttScenarios({
        scenarios: [
          {
            ...scenario({
              id: "false-meet-claim",
              adapter: "live-websocket",
              assetId: "synthetic-meet-wav",
              source: { url: "ws://localhost/transcription/ws" },
              criticalTokens: ["database"],
              expectedActions: ["create_node"],
            }),
            surface: "meet-main-stage",
            transport: "direct",
          },
        ],
        adapters: [createLiveGatewayWebSocketAdapter()],
      }),
    /claims a Meet surface without the production Meet bridge replay transport/u,
  );
});

test("external asset loading enforces privacy policy, mount boundaries, and SHA-256", async () => {
  const temporaryRoot = await mkdtemp(join(tmpdir(), "airboard-stt-assets-"));
  try {
    const content = syntheticWav({ sampleCount: 320 });
    const hash = createHash("sha256").update(content).digest("hex");
    await writeFile(join(temporaryRoot, "consented.wav"), content);
    const manifestPath = join(temporaryRoot, "manifest.json");
    await writeFile(
      manifestPath,
      JSON.stringify(
        assetManifest([
          {
            id: "consented-1",
            storageKey: "consented.wav",
            sha256: hash,
            privacyClass: "restricted-consented",
            participantId: "participant-01",
            accent: "en-IN",
            microphone: "headset",
            distance: "normal",
            conditions: ["meeting-noise"],
            lengthClass: "short",
            surface: "meet-side-panel",
            purpose: "ambient_safety",
            durationSeconds: 3_600,
            consent: { status: "granted" },
            sttEvaluation: {
              channel: "ptt",
              transport: "meet-bridge",
              processingPath: "deterministic",
              oracle: {
                criticalTokens: ["database"],
                expectedActions: ["create_node"],
              },
            },
          },
        ]),
      ),
    );
    const catalog = await loadAudioAssetManifest(manifestPath, {
      mediaRoot: temporaryRoot,
      requireAssets: true,
    });
    assert.equal(catalog.declaredCount, 1);
    const externalScenario = catalog.listEvaluationScenarios()[0];
    assert.equal(externalScenario.assetId, "consented-1");
    assert.equal(externalScenario.participantId, "participant-01");
    assert.equal(externalScenario.microphone, "headset");
    assert.equal(externalScenario.distance, "normal");
    assert.deepEqual(externalScenario.conditions, ["meeting-noise"]);
    assert.equal(externalScenario.lengthClass, "short");
    assert.equal(externalScenario.surface, "meet-side-panel");
    assert.equal(externalScenario.transport, "meet-bridge");
    assert.equal(externalScenario.adapter, "meet-bridge-replay");
    assert.deepEqual(
      catalog.coverageForResults([
        { id: "asset:consented-1", assessment: {} },
      ]),
      {
        evaluatedAssetCount: 1,
        speakerCount: 1,
        indianEnglishSpeakerCount: 1,
        ambientObservedHours: 1,
      },
    );
    const loaded = await catalog.load("consented-1");
    assert.equal(loaded.sha256, hash);
    assert.equal(loaded.wav.sampleRate, 16_000);

    const badHashPath = join(temporaryRoot, "bad-hash.json");
    await writeFile(
      badHashPath,
      JSON.stringify(
        assetManifest([
          {
            id: "tampered",
            storageKey: "consented.wav",
            sha256: "0".repeat(64),
            privacyClass: "restricted-consented",
            consentStatus: "granted",
          },
        ]),
      ),
    );
    const badHashCatalog = await loadAudioAssetManifest(badHashPath, {
      mediaRoot: temporaryRoot,
      requireAssets: true,
    });
    await assert.rejects(
      () => badHashCatalog.load("tampered"),
      (error) => error.code === "ASSET_HASH_MISMATCH",
    );

    const traversalPath = join(temporaryRoot, "traversal.json");
    await writeFile(
      traversalPath,
      JSON.stringify(
        assetManifest([
          {
            id: "escape",
            storageKey: "../outside.wav",
            sha256: hash,
            privacyClass: "restricted-consented",
            consentStatus: "granted",
          },
        ]),
      ),
    );
    const traversalCatalog = await loadAudioAssetManifest(traversalPath, {
      mediaRoot: temporaryRoot,
      requireAssets: true,
    });
    await assert.rejects(
      () => traversalCatalog.load("escape"),
      (error) => error.code === "ASSET_PATH_ESCAPE",
    );

    const falseTransportPath = join(
      temporaryRoot,
      "false-meet-transport.json",
    );
    await writeFile(
      falseTransportPath,
      JSON.stringify(
        assetManifest([
          {
            id: "false-meet-transport",
            storageKey: "consented.wav",
            sha256: hash,
            privacyClass: "restricted-consented",
            consentStatus: "granted",
            surface: "meet-main-stage",
            sttEvaluation: {
              channel: "ptt",
              processingPath: "deterministic",
              transport: "direct",
              oracle: {
                criticalTokens: ["database"],
                expectedActions: ["create_node"],
              },
            },
          },
        ]),
      ),
    );
    await assert.rejects(
      () =>
        loadAudioAssetManifest(falseTransportPath, {
          mediaRoot: temporaryRoot,
          requireAssets: true,
        }),
      (error) =>
        error.code === "ASSET_EVALUATION_INVALID" &&
        /transport=meet-bridge/u.test(error.message),
    );
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});

test("audio slice gates use observed device conditions and the worst participant", () => {
  const pass = {
    actionScore: { exact: true },
    boardOutcome: { passed: true },
  };
  const fail = {
    actionScore: { exact: false },
    boardOutcome: { passed: false },
  };
  const scenarios = new Map([
    [
      "one",
      {
        accent: "en-IN",
        participantId: "participant-one",
        microphone: "headset",
        distance: "normal",
        conditions: ["meeting-noise"],
        lengthClass: "short",
        surface: "meet-side-panel",
      },
    ],
    [
      "two",
      {
        accent: "en-IN",
        participantId: "participant-one",
        microphone: "headset",
        distance: "far",
        conditions: ["overlap"],
        lengthClass: "near-500-character-limit",
        surface: "meet-main-stage",
      },
    ],
    [
      "three",
      {
        accent: "en-US",
        participantId: "participant-two",
        microphone: "laptop",
        distance: "near",
        conditions: ["quiet"],
        lengthClass: "1-3-words",
        surface: "standalone",
      },
    ],
  ]);
  const slices = buildAudioSlices(
    [
      { id: "one", assessment: pass },
      { id: "two", assessment: fail },
      { id: "three", assessment: pass },
    ],
    scenarios,
  );

  assert.equal(slices.indian_english.accuracy, 0.5);
  assert.equal(slices.microphone_headset.accuracy, 0.5);
  assert.equal(slices.condition_overlap.accuracy, 0);
  assert.deepEqual(slices.participant_minimum, {
    accuracy: 0.5,
    critical: true,
    count: 2,
  });
  const failures = evaluateAudioGates({
    criticalTokenRecall: 1,
    coreActionCorrectness: 1,
    downstreamActionCorrectness: 1,
    hardFalseActions: 0,
    safetyActionPrecision: 1,
    deterministicEndToActionP95Ms: 100,
    slices,
  });
  assert.ok(
    failures.some((failure) =>
      failure.includes("participant_minimum"),
    ),
  );
  assert.ok(
    failures.some((failure) =>
      failure.includes("condition_overlap"),
    ),
  );
});

test("audio latency aggregation separates deterministic and semantic turns", () => {
  const assessed = (processingPath, endToActionMs) => ({
    criticalTokens: { expected: 1, matched: 1 },
    actionScore: { exact: true, precision: 1 },
    boardOutcome: { passed: true, boardEventCount: 1 },
    routedActions: ["create_node"],
    processingPath,
    endToActionMs,
  });
  const report = {
    summary: { total: 3, failed: 0 },
    results: [
      {
        id: "deterministic-one",
        durationMs: 800,
        assessment: assessed("deterministic", 700),
      },
      {
        id: "semantic-one",
        durationMs: 2_200,
        assessment: assessed("semantic", 2_100),
      },
      {
        id: "safety-one",
        durationMs: 100,
        assessment: {
          ...assessed("no_route", null),
          routedActions: [],
          actionScore: { exact: true, precision: 1 },
          boardOutcome: {
            passed: true,
            boardEventCount: 0,
          },
        },
      },
    ],
  };
  const scenarios = [
    {
      id: "deterministic-one",
      evaluationClass: "core",
      oracle: { expectedActions: ["create_node"] },
    },
    {
      id: "semantic-one",
      evaluationClass: "narrative",
      oracle: { expectedActions: ["create_node"] },
    },
    {
      id: "safety-one",
      evaluationClass: "safety",
      oracle: { expectedActions: [] },
    },
  ];
  const aggregate = aggregateMetrics(report, scenarios);

  assert.equal(aggregate.deterministicEndToActionP95Ms, 700);
  assert.equal(aggregate.semanticEndToActionP95Ms, 2_100);
  assert.ok(
    evaluateAudioGates({
      ...aggregate,
      semanticEndToActionP95Ms: 2_600,
    }).some((failure) => failure.includes("semantic end-to-action")),
  );
});

test("CLI passes offline smoke scenarios and fails closed when assets are required", () => {
  const offline = spawnSync(
    process.execPath,
    ["scripts/eval-audio-stt.mjs"],
    { cwd: ROOT, encoding: "utf8" },
  );
  assert.equal(offline.status, 0, offline.stderr || offline.stdout);
  assert.match(offline.stdout, /audio\/STT evaluation: PASS/u);
  assert.match(offline.stdout, /10\/10 passed/u);

  const required = spawnSync(
    process.execPath,
    ["scripts/eval-audio-stt.mjs", "--require-assets"],
    { cwd: ROOT, encoding: "utf8" },
  );
  assert.equal(required.status, 2);
  assert.match(required.stderr, /manifest declares none/u);
});

function scenario({
  id,
  adapter,
  assetId,
  source,
  criticalTokens,
  expectedActions,
}) {
  return {
    id,
    adapter,
    ...(assetId ? { assetId } : {}),
    privacyClass: "synthetic",
    channel: "ptt",
    source,
    oracle: {
      criticalTokens,
      expectedActions,
      expectedFinalCount: 1,
      minimumCriticalTokenRecall: 1,
      minimumActionF1: 1,
      requireExactActions: true,
    },
  };
}

function assetManifest(assets) {
  return {
    schemaVersion: "1.0",
    storagePolicy: {
      rawMediaInGit: false,
      encryptedAtRest: true,
      restrictedAccess: true,
      ciArtifactUpload: false,
      customerContentAllowed: false,
    },
    assets,
  };
}

function syntheticWav({
  audioFormat = 1,
  bitsPerSample = 16,
  channels = 1,
  sampleCount = 1_280,
  sampleRate = 16_000,
} = {}) {
  const bytesPerSample = bitsPerSample / 8;
  const blockAlign = channels * bytesPerSample;
  const dataSize = sampleCount * blockAlign;
  const output = Buffer.alloc(44 + dataSize);
  output.write("RIFF", 0, "ascii");
  output.writeUInt32LE(output.byteLength - 8, 4);
  output.write("WAVE", 8, "ascii");
  output.write("fmt ", 12, "ascii");
  output.writeUInt32LE(16, 16);
  output.writeUInt16LE(audioFormat, 20);
  output.writeUInt16LE(channels, 22);
  output.writeUInt32LE(sampleRate, 24);
  output.writeUInt32LE(sampleRate * blockAlign, 28);
  output.writeUInt16LE(blockAlign, 32);
  output.writeUInt16LE(bitsPerSample, 34);
  output.write("data", 36, "ascii");
  output.writeUInt32LE(dataSize, 40);
  if (bitsPerSample === 16) {
    for (let offset = 44; offset < output.length; offset += 2) {
      output.writeInt16LE(1_000, offset);
    }
  } else {
    output.fill(128, 44);
  }
  return output;
}

class FakeGatewaySocket {
  binaryType = "blob";
  bufferedAmount = 0;
  readyState = 0;
  sent = [];
  listeners = new Map();

  constructor(finalTranscript) {
    this.finalTranscript = finalTranscript;
    queueMicrotask(() => {
      this.readyState = 1;
      this.emit("open", {});
    });
  }

  addEventListener(type, listener) {
    const listeners = this.listeners.get(type) ?? [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }

  send(value) {
    this.sent.push(value);
    if (typeof value !== "string") return;
    const message = JSON.parse(value);
    if (message.type === "transcription.start") {
      queueMicrotask(() =>
        this.serverMessage({
          type: "transcription.ready",
          provider: "deepgram",
          model: "flux-general-en",
          sampleRate: message.sampleRate,
        }),
      );
    } else if (message.type === "transcription.stop") {
      queueMicrotask(() => {
        this.serverMessage({
          type: "transcription.final",
          transcript: this.finalTranscript,
          confidence: 0.99,
        });
        this.serverMessage({
          type: "transcription.stopped",
          reason: "completed",
        });
      });
    }
  }

  close(code = 1000, reason = "") {
    if (this.readyState >= 2) return;
    this.readyState = 3;
    this.emit("close", { code, reason });
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
