import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { createServer } from "node:http";
import { registerHooks } from "node:module";
import test from "node:test";
import { fileURLToPath } from "node:url";

// Node strips TypeScript in these unit tests, while this hook resolves the
// extensionless/.js production imports to their TypeScript sources.
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith(".") && context.parentURL) {
      const candidates = [
        new URL(`${specifier}.ts`, context.parentURL),
        ...(specifier.endsWith(".js")
          ? [new URL(`${specifier.slice(0, -3)}.ts`, context.parentURL)]
          : []),
      ];
      for (const candidate of candidates) {
        if (existsSync(fileURLToPath(candidate))) {
          return nextResolve(candidate.href, context);
        }
      }
    }
    return nextResolve(specifier, context);
  },
});

const {
  AIRBOARD_SEMANTIC_PLAN_CONTRACT_VERSION,
  AIRBOARD_SEMANTIC_PLAN_TOOL_NAME,
} = await import("@airboard/core/semantic-plan");
const {
  AIRBOARD_SEMANTIC_INTENT_PROMPT_VERSION,
  OpenAiResponsesSemanticIntentProvider,
} = await import(
  "../src/semanticIntent/openaiResponses.ts"
);
const {
  mapSemanticIntentProviderError,
  SemanticIntentProviderError,
} = await import("../src/semanticIntent/providerError.ts");
const { loadSemanticIntentConfig } = await import("../src/config.ts");
const { parseSemanticIntentRequest } = await import("../src/semanticIntent/protocol.ts");
const { publicSemanticIntentConfig } = await import(
  "../src/semanticIntent/publicConfig.ts"
);

const runtimeConfig = {
  provider: "openai",
  defaultModel: "gpt-5.6-terra",
  allowedModels: ["gpt-5.6-terra", "gpt-5.6-luna"],
  endpoint: "https://api.openai.test/v1/responses",
  reasoningEffort: "none",
  serviceTier: "priority",
  timeoutMs: 5_000,
  maxConcurrentRequests: 8,
  maxTranscriptCharacters: 500,
  apiKey: "server-only-secret",
};

const boardContext = {
  selectionCount: 1,
  selected: [
    {
      label: "User",
      nodeType: "user",
      ordinal: 1,
      selected: true,
      position: { x: 100, y: 120 },
      size: { width: 180, height: 100 },
    },
  ],
  objects: [
    {
      label: "User",
      nodeType: "user",
      ordinal: 1,
      selected: true,
      position: { x: 100, y: 120 },
      size: { width: 180, height: 100 },
    },
    { label: "Payments API", nodeType: "api", ordinal: 1, selected: false },
  ],
  edges: [
    {
      from: { label: "User", nodeType: "user", ordinal: 1 },
      to: { label: "Payments API", nodeType: "api", ordinal: 1 },
      label: "requests",
    },
  ],
  projectGlossary: [{ term: "payments edge", nodeType: "api" }],
  pointerAvailable: true,
};

const resolvedPlan = {
  version: AIRBOARD_SEMANTIC_PLAN_CONTRACT_VERSION,
  status: "resolved",
  issueCode: "none",
  clarificationQuestion: null,
  missingSlots: [],
  actions: [
    {
      type: "create",
      nodeType: "decision",
      label: "Condition",
      handle: "condition",
      placement: { kind: "pointer" },
    },
  ],
};

test("loads bounded planner configuration without exposing credentials", () => {
  const config = loadSemanticIntentConfig({ OPENAI_API_KEY: "server-only-secret" });
  assert.equal(config.defaultModel, "gpt-5.6-luna");
  assert.deepEqual(config.allowedModels, ["gpt-5.6-luna"]);
  assert.equal(config.reasoningEffort, "none");
  assert.equal(config.serviceTier, "priority");
  assert.equal(loadSemanticIntentConfig({ AIRBOARD_INTENT_SERVICE_TIER: "default" }).serviceTier, "default");
  assert.throws(() => loadSemanticIntentConfig({ AIRBOARD_INTENT_SERVICE_TIER: "fastest" }), /AIRBOARD_INTENT_SERVICE_TIER/);
  assert.equal(config.timeoutMs, 5_000);
  assert.equal(config.apiKey, "server-only-secret");

  const publicConfig = publicSemanticIntentConfig(config);
  assert.equal(publicConfig.available, true);
  assert.equal(JSON.stringify(publicConfig).includes("server-only-secret"), false);
});

test("normalizes a correlated rich semantic request and pending clarification", () => {
  const parsed = parseSemanticIntentRequest(
    {
      voiceTurnId: "voice-turn-1234",
      transcript: "  Airo   connect the second branch  ",
      parserIssue: "unsupported_branching",
      context: boardContext,
      pendingClarification: {
        previousTranscript: "connect decision to user one and user two with yes and",
        question: "What should the second branch be labelled?",
        missingSlots: ["branch_label"],
      },
      model: " gpt-5.6-luna ",
    },
    runtimeConfig,
  );

  assert.equal(parsed.ok, true);
  assert.equal(parsed.value.voiceTurnId, "voice-turn-1234");
  assert.equal(parsed.value.transcript, "Airo connect the second branch");
  assert.equal(parsed.value.model, "gpt-5.6-luna");
  assert.deepEqual(parsed.value.context, boardContext);
  assert.deepEqual(parsed.value.pendingClarification.missingSlots, ["branch_label"]);

  const backwardCompatibleContext = parseSemanticIntentRequest(
    {
      voiceTurnId: "voice-turn-5678",
      transcript: "add a database",
      parserIssue: "unknown_command",
      context: { selectionCount: 0, selected: [], objects: [], pointerAvailable: false },
    },
    runtimeConfig,
  );
  assert.equal(backwardCompatibleContext.ok, true);
  assert.deepEqual(backwardCompatibleContext.value.context.edges, []);
  assert.deepEqual(backwardCompatibleContext.value.context.projectGlossary, []);

  const unsupportedCount = parseSemanticIntentRequest(
    {
      voiceTurnId: "voice-turn-count",
      transcript: "add 21 circles",
      parserIssue: "unsupported_count",
      context: { selectionCount: 0, selected: [], objects: [], pointerAvailable: false },
    },
    runtimeConfig,
  );
  assert.equal(unsupportedCount.ok, true);
  assert.equal(unsupportedCount.value.parserIssue, "unsupported_count");
});

test("rejects unsafe, uncorrelated, oversized, and disallowed semantic requests", () => {
  const base = {
    voiceTurnId: "voice-turn-1234",
    transcript: "add a circle",
    parserIssue: "unknown_command",
    context: boardContext,
  };
  const cases = [
    [{ ...base, voiceTurnId: "short" }, "INVALID_VOICE_TURN_ID"],
    [{ ...base, transcript: " " }, "INVALID_TRANSCRIPT"],
    [{ ...base, transcript: "x".repeat(501) }, "INVALID_TRANSCRIPT"],
    [{ ...base, transcript: "add\u0000circle" }, "INVALID_TRANSCRIPT"],
    [{ ...base, parserIssue: "activation_required" }, "SEMANTIC_FALLBACK_NOT_ALLOWED"],
    [{ ...base, model: "unapproved-model" }, "MODEL_NOT_ALLOWED"],
    [
      {
        ...base,
        context: { ...boardContext, edges: [{ from: { label: "User" }, to: {} }] },
      },
      "INVALID_CONTEXT",
    ],
    [
      {
        ...base,
        pendingClarification: {
          previousTranscript: "connect these",
          question: "which target?",
          missingSlots: Array.from({ length: 13 }, () => "target"),
        },
      },
      "INVALID_CLARIFICATION_CONTEXT",
    ],
  ];

  for (const [input, code] of cases) {
    const parsed = parseSemanticIntentRequest(input, runtimeConfig);
    assert.equal(parsed.ok, false, code);
    assert.equal(parsed.error.code, code);
  }
});

test("uses one required strict Responses function tool and captures provider metadata", async () => {
  let capturedUrl;
  let capturedInit;
  const fetchMock = async (url, init) => {
    capturedUrl = url;
    capturedInit = init;
    return response({
      status: "completed",
      id: "resp_123",
      model: "gpt-5.6-terra-2026-07-01",
      usage: { input_tokens: 101, output_tokens: 45, total_tokens: 146 },
      output: [
        {
          type: "function_call",
          name: AIRBOARD_SEMANTIC_PLAN_TOOL_NAME,
          call_id: "call_123",
          arguments: JSON.stringify(resolvedPlan),
        },
      ],
    }, {
      "x-request-id": "req_123",
      "openai-processing-ms": "87",
    });
  };

  const provider = new OpenAiResponsesSemanticIntentProvider(runtimeConfig, fetchMock);
  const signal = new AbortController().signal;
  const result = await provider.resolve(
    {
      voiceTurnId: "voice-turn-1234",
      transcript: "Airo now add a condition block",
      parserIssue: "unknown_command",
      context: boardContext,
      pendingClarification: {
        previousTranscript: "connect the decision to user one and user two with yes and",
        question: "What label should the second branch use?",
        missingSlots: ["branch_label"],
      },
    },
    "gpt-5.6-terra",
    signal,
  );

  assert.deepEqual(result.plan, resolvedPlan);
  assert.equal(result.metadata.responseId, "resp_123");
  assert.equal(result.metadata.responseModel, "gpt-5.6-terra-2026-07-01");
  assert.equal(result.metadata.providerRequestId, "req_123");
  assert.equal(result.metadata.providerProcessingMs, 87);
  assert.deepEqual(result.metadata.usage, {
    inputTokens: 101,
    outputTokens: 45,
    totalTokens: 146,
  });
  assert.ok(result.metadata.totalLatencyMs >= 0);
  assert.match(result.metadata.clientRequestId, /^airboard:voice-turn-1234:/u);

  assert.equal(capturedUrl, runtimeConfig.endpoint);
  assert.equal(capturedInit.method, "POST");
  assert.equal(capturedInit.headers.Authorization, `Bearer ${runtimeConfig.apiKey}`);
  assert.equal(capturedInit.headers["Content-Type"], "application/json");
  assert.equal(capturedInit.headers["X-Client-Request-Id"], result.metadata.clientRequestId);
  assert.equal(capturedInit.signal, signal);

  const payload = JSON.parse(capturedInit.body);
  assert.equal(payload.model, "gpt-5.6-terra");
  assert.equal(payload.store, false);
  assert.equal(payload.parallel_tool_calls, false);
  // Speed: the priority tier and a day-long shared cache of the fixed prefix.
  assert.equal(payload.service_tier, "priority");
  assert.equal(payload.prompt_cache_key, "airboard-semantic-intent");
  assert.equal(payload.prompt_cache_retention, "24h");
  assert.deepEqual(payload.tool_choice, {
    type: "function",
    name: AIRBOARD_SEMANTIC_PLAN_TOOL_NAME,
  });
  assert.equal(payload.tools.length, 1);
  assert.equal(payload.tools[0].type, "function");
  assert.equal(payload.tools[0].name, AIRBOARD_SEMANTIC_PLAN_TOOL_NAME);
  assert.equal(payload.tools[0].strict, true);
  assert.equal(payload.tools[0].parameters.additionalProperties, false);
  assert.equal("text" in payload, false);
  assert.match(payload.instructions, /condition block/i);
  assert.match(payload.instructions, /branch action/i);
  assert.match(payload.instructions, /reversible details, never a reason to ask/i);
  // Gap 6: a best guess, never "which one?" (undo is the safety net).
  assert.match(payload.instructions, /best guess over questions/i);
  assert.match(payload.instructions, /never ask which one/i);
  assert.match(payload.instructions, /create Cache, then connect User to Cache/i);
  assert.doesNotMatch(payload.instructions, /return clarification instead of guessing/i);
  // Gap 3: addressed narration is drawn, not treated as discussion.
  assert.match(payload.instructions, /When addressedBy is present/);
  assert.match(payload.instructions, /users sign in through the auth service/i);
  // Gap 10: the full catalogue and the new edit actions.
  assert.match(payload.instructions, /horizontal-cylinder/);
  assert.match(payload.instructions, /load balancer.*shape hexagon/i);
  assert.match(payload.instructions, /change_type/);
  assert.match(payload.instructions, /style_connection/);
  assert.match(payload.instructions, /direction radial/);
  assert.match(payload.instructions, /40 actions or fewer/);
  assert.equal(payload.max_output_tokens, 6_000);
  assert.match(payload.instructions, /issueCode unsupported_operation/i);
  assert.match(payload.instructions, /no missingSlots/i);
  assert.doesNotMatch(payload.instructions, /never ask a clarification question/i);
  assert.match(payload.instructions, /literal node or edge labels/i);
  assert.match(payload.instructions, /desired-state correction/i);
  assert.match(payload.instructions, /reverse_connection/i);
  assert.match(payload.instructions, /currently, user one is making the call to user two/i);
  assert.match(payload.instructions, /request is flowing from X to Y/i);
  assert.match(payload.instructions, /next edge starts at the receiver X/i);
  assert.match(payload.instructions, /every stated causal or temporal transition/i);
  assert.match(payload.instructions, /never turn a complete subject-predicate clause/i);
  assert.match(payload.instructions, /relationship-coverage check/i);
  assert.match(payload.instructions, /and that/i);
  assert.match(payload.instructions, /narrativeRelationshipCoverage/i);
  assert.match(payload.instructions, /service gets fired/i);
  assert.match(payload.instructions, /Authentication Service to Airboard Page/i);
  assert.match(payload.instructions, /Airboard Authentication Service to User/i);
  assert.match(payload.instructions, /relation-only request/i);
  assert.match(payload.instructions, /Recipient constructions reverse/i);
  assert.match(payload.instructions, /Golden Dataset to Planner/i);
  assert.match(payload.instructions, /create no Schema Data node/i);
  const modelInput = JSON.parse(payload.input);
  assert.equal(AIRBOARD_SEMANTIC_INTENT_PROMPT_VERSION, "2.14");
  assert.equal("addressedBy" in modelInput, false, "unaddressed speech says nothing about addressing");
  assert.equal(
    modelInput.semanticPlanContractVersion,
    AIRBOARD_SEMANTIC_PLAN_CONTRACT_VERSION,
  );
  assert.equal(
    modelInput.semanticPromptVersion,
    AIRBOARD_SEMANTIC_INTENT_PROMPT_VERSION,
  );
  assert.equal(modelInput.transcript, "Airo now add a condition block");
  assert.equal(modelInput.dialogueMode, "clarification_answer");
  assert.equal(modelInput.explicitMetaCommand, null);
  assert.deepEqual(modelInput.boardContext, boardContext);
  assert.equal(modelInput.pendingClarification.missingSlots[0], "branch_label");
  assert.equal(modelInput.clarificationAnswer.literalValue, "Airo now add a condition block");
  assert.match(modelInput.clarificationAnswer.instruction, /missing slots/i);
  assert.equal(capturedInit.body.includes(runtimeConfig.apiKey), false);
});

test("sends narrative coverage hints and rejects a schema-valid partial graph", async () => {
  let modelInput;
  const partialPlan = {
    version: AIRBOARD_SEMANTIC_PLAN_CONTRACT_VERSION,
    status: "resolved",
    issueCode: "none",
    clarificationQuestion: null,
    missingSlots: [],
    actions: [
      {
        type: "create",
        nodeType: "user",
        label: "User",
        handle: "user",
        placement: { kind: "auto" },
      },
      {
        type: "create",
        nodeType: "service",
        label: "Airboard Authentication Service",
        handle: "authentication-service",
        placement: { kind: "auto" },
      },
      {
        type: "create",
        nodeType: "custom",
        label: "Airboard",
        handle: "airboard",
        placement: { kind: "auto" },
      },
      {
        type: "connect",
        from: { kind: "plan_handle", handle: "user" },
        to: { kind: "plan_handle", handle: "authentication-service" },
        label: "request",
      },
    ],
  };
  const provider = new OpenAiResponsesSemanticIntentProvider(
    runtimeConfig,
    async (_url, init) => {
      modelInput = JSON.parse(JSON.parse(init.body).input);
      return response({
        status: "completed",
        output: [
          {
            type: "function_call",
            name: AIRBOARD_SEMANTIC_PLAN_TOOL_NAME,
            arguments: JSON.stringify(partialPlan),
          },
        ],
      });
    },
  );

  await assert.rejects(
    provider.resolve(
      {
        voiceTurnId: "voice-turn-narrative-coverage",
        transcript:
          "User makes a request to, uh, Airboard authentication service and that, uh, authenticates the user, and the user lands to the Airboard. Create a flow diagram for this.",
        parserIssue: "unknown_command",
        context: {
          selectionCount: 0,
          selected: [],
          objects: [],
          edges: [],
          projectGlossary: [],
          pointerAvailable: false,
        },
      },
      "gpt-5.6-terra",
    ),
    (error) => {
      assert.equal(error instanceof SemanticIntentProviderError, true);
      assert.equal(error.kind, "invalid_output");
      assert.match(error.message, /omitted explicit narrative relationships \(1\/3\)/iu);
      return true;
    },
  );
  assert.equal(
    modelInput.narrativeRelationshipCoverage.explicitRelationshipCount,
    3,
  );
  assert.deepEqual(
    modelInput.narrativeRelationshipCoverage.cues.map(({ kind }) => kind),
    ["request", "authenticate", "land"],
  );
});

test("rejects missing, malformed, multiple, and schema-invalid tool calls", async () => {
  const request = {
    voiceTurnId: "voice-turn-1234",
    transcript: "add database",
    parserIssue: "unknown_command",
    context: boardContext,
  };
  const invalidPayloads = [
    { status: "incomplete", output: [] },
    { status: "completed", output: [] },
    {
      status: "completed",
      output: [
        {
          type: "function_call",
          name: AIRBOARD_SEMANTIC_PLAN_TOOL_NAME,
          arguments: "not json",
        },
      ],
    },
    {
      status: "completed",
      output: [
        {
          type: "function_call",
          name: AIRBOARD_SEMANTIC_PLAN_TOOL_NAME,
          arguments: JSON.stringify({ ...resolvedPlan, actions: [] }),
        },
      ],
    },
    {
      status: "completed",
      output: [
        {
          type: "function_call",
          name: AIRBOARD_SEMANTIC_PLAN_TOOL_NAME,
          arguments: JSON.stringify(resolvedPlan),
        },
        {
          type: "function_call",
          name: AIRBOARD_SEMANTIC_PLAN_TOOL_NAME,
          arguments: JSON.stringify(resolvedPlan),
        },
      ],
    },
  ];

  for (const payload of invalidPayloads) {
    const provider = new OpenAiResponsesSemanticIntentProvider(
      runtimeConfig,
      async () => response(payload, { "x-request-id": "req_invalid" }),
    );
    await assert.rejects(
      () => provider.resolve(request, runtimeConfig.defaultModel),
      (error) =>
        error instanceof SemanticIntentProviderError &&
        error.kind === "invalid_output" &&
        error.providerRequestId === "req_invalid",
    );
  }
});

test("classifies safe provider failures into stable API errors", async () => {
  const request = {
    voiceTurnId: "voice-turn-1234",
    transcript: "add database",
    parserIssue: "unknown_command",
    context: boardContext,
  };
  const cases = [
    [429, "insufficient_quota", "quota_exhausted", 503, "SEMANTIC_INTENT_QUOTA_EXHAUSTED"],
    [429, "rate_limit_exceeded", "rate_limited", 429, "SEMANTIC_INTENT_RATE_LIMITED"],
    [401, "invalid_api_key", "authentication_failed", 503, "SEMANTIC_INTENT_PROVIDER_AUTH_FAILED"],
    [404, "model_not_found", "model_unavailable", 503, "SEMANTIC_INTENT_MODEL_UNAVAILABLE"],
    [400, "invalid_request_error", "invalid_request", 502, "SEMANTIC_INTENT_PROVIDER_REQUEST_REJECTED"],
    [500, "server_error", "provider_unavailable", 502, "SEMANTIC_INTENT_PROVIDER_UNAVAILABLE"],
  ];

  for (const [status, providerCode, kind, httpStatus, apiCode] of cases) {
    const provider = new OpenAiResponsesSemanticIntentProvider(
      runtimeConfig,
      async () =>
        response(
          { error: { code: providerCode, message: "must not be reflected" } },
          { "x-request-id": `req_${providerCode}`, "retry-after": "2" },
          status,
        ),
    );
    await assert.rejects(
      () => provider.resolve(request, runtimeConfig.defaultModel),
      (error) => {
        assert.equal(error.kind, kind);
        assert.equal(error.upstreamStatus, status);
        assert.equal(error.providerCode, providerCode);
        assert.equal(error.providerRequestId, `req_${providerCode}`);
        assert.equal(error.message.includes("must not be reflected"), false);
        const mapped = mapSemanticIntentProviderError(error);
        assert.equal(mapped.status, httpStatus);
        assert.equal(mapped.code, apiCode);
        return true;
      },
    );
  }
});

test("classifies aborts as timeouts and missing keys as provider authentication failures", async () => {
  const request = {
    voiceTurnId: "voice-turn-1234",
    transcript: "add database",
    parserIssue: "unknown_command",
    context: boardContext,
  };
  const controller = new AbortController();
  controller.abort();
  const aborted = new OpenAiResponsesSemanticIntentProvider(runtimeConfig, async () => {
    const error = new Error("aborted");
    error.name = "AbortError";
    throw error;
  });
  await assert.rejects(
    () => aborted.resolve(request, runtimeConfig.defaultModel, controller.signal),
    (error) => error.kind === "timeout",
  );

  const missingKey = new OpenAiResponsesSemanticIntentProvider(
    { ...runtimeConfig, apiKey: undefined },
    async () => {
      throw new Error("must not call");
    },
  );
  await assert.rejects(
    () => missingKey.resolve(request, runtimeConfig.defaultModel),
    (error) => error.kind === "authentication_failed",
  );
});

function response(payload, headers = {}, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

test("tells the planner how addressed speech reached Airo", async () => {
  let capturedInit;
  const fetchMock = async (_url, init) => {
    capturedInit = init;
    return response({
      status: "completed",
      output: [
        {
          type: "function_call",
          name: AIRBOARD_SEMANTIC_PLAN_TOOL_NAME,
          call_id: "call_1",
          arguments: JSON.stringify(resolvedPlan),
        },
      ],
    });
  };
  const provider = new OpenAiResponsesSemanticIntentProvider(runtimeConfig, fetchMock);
  await provider.resolve(
    {
      voiceTurnId: "voice-turn-addressed",
      transcript: "users sign in through the auth service, which checks the user database",
      parserIssue: "unknown_command",
      context: boardContext,
      addressedBy: "palm",
    },
    "gpt-5.6-terra",
  );
  const modelInput = JSON.parse(JSON.parse(capturedInit.body).input);
  assert.equal(modelInput.addressedBy, "palm");
});

test("accepts addressedBy, rejects unknown values, and allows two-minute transcripts", () => {
  const config = { allowedModels: ["gpt-5.6-terra"], defaultModel: "gpt-5.6-terra", maxTranscriptCharacters: 2_000 };
  const body = (extra) => ({
    voiceTurnId: "voice-turn-1234",
    transcript: "users sign in through the auth service",
    parserIssue: "unknown_command",
    context: boardContext,
    ...extra,
  });
  for (const addressedBy of ["wake", "palm", "hold", "typed", "follow_up"]) {
    const parsed = parseSemanticIntentRequest(body({ addressedBy }), config);
    assert.equal(parsed.ok, true);
    assert.equal(parsed.value.addressedBy, addressedBy);
  }
  assert.equal("addressedBy" in parseSemanticIntentRequest(body({}), config).value, false);
  const invalid = parseSemanticIntentRequest(body({ addressedBy: "shout" }), config);
  assert.equal(invalid.ok, false);
  assert.equal(invalid.error.code, "INVALID_ADDRESSED_BY");
  const long = parseSemanticIntentRequest(body({ transcript: "a".repeat(1_990) }), config);
  assert.equal(long.ok, true);
});

// --- Streamed planner answers (AIRBOARD_INTENT_STREAM) ---------------------

const streamConfig = { ...runtimeConfig, stream: true };
const streamRequest = {
  voiceTurnId: "voice-turn-stream",
  transcript: "add a condition block",
  parserIssue: "unknown_command",
  context: boardContext,
};

function planItem(plan, overrides = {}) {
  return {
    id: "fc_1",
    type: "function_call",
    status: "completed",
    name: AIRBOARD_SEMANTIC_PLAN_TOOL_NAME,
    call_id: "call_1",
    arguments: JSON.stringify(plan),
    ...overrides,
  };
}

const streamedUsage = {
  input_tokens: 11_450,
  input_tokens_details: { cached_tokens: 11_208 },
  output_tokens: 92,
  output_tokens_details: { reasoning_tokens: 0 },
  total_tokens: 11_542,
};

/** The event sequence a Responses stream sends for one forced tool call. */
function streamedEvents(plan, { item = planItem(plan), completed = true } = {}) {
  const args = item.arguments ?? "";
  const half = Math.floor(args.length / 2);
  const responseBase = { id: "resp_stream", model: "gpt-5.6-terra-2026-07-01" };
  return [
    ["response.created", { response: { ...responseBase, status: "in_progress", output: [] } }],
    ["response.in_progress", { response: { ...responseBase, status: "in_progress", output: [] } }],
    ["response.output_item.added", { output_index: 0, item: { ...item, arguments: "", status: "in_progress" } }],
    ["response.function_call_arguments.delta", { item_id: item.id, output_index: 0, delta: args.slice(0, half) }],
    ["response.function_call_arguments.delta", { item_id: item.id, output_index: 0, delta: args.slice(half) }],
    ["response.function_call_arguments.done", { item_id: item.id, output_index: 0, arguments: args }],
    ["response.output_item.done", { output_index: 0, item }],
    ...(completed
      ? [[
          "response.completed",
          {
            response: {
              ...responseBase,
              status: "completed",
              // The real final event echoes the whole request (~45 KB).
              instructions: "x".repeat(45_000),
              output: [item],
              usage: streamedUsage,
            },
          },
        ]]
      : []),
  ];
}

function sseText(events, lineEnd = "\n") {
  return events
    .map(([type, data]) => `event: ${type}${lineEnd}data: ${JSON.stringify({ type, ...data })}${lineEnd}${lineEnd}`)
    .join("");
}

/**
 * An SSE response whose body arrives in small pieces. `holdAt` stops delivery
 * just after that text until `release()` is called; `cut` ends the stream
 * with a transport error after the given text.
 */
function sseResponse(text, { chunkSize = 37, holdAt, cut, headers = {} } = {}) {
  const bytes = new TextEncoder().encode(text);
  const holdIndex =
    holdAt === undefined ? -1 : new TextEncoder().encode(text.slice(0, text.indexOf(holdAt) + holdAt.length)).length;
  let release;
  const released = new Promise((resolve) => {
    release = resolve;
  });
  let offset = 0;
  const body = new ReadableStream({
    async pull(controller) {
      if (offset === holdIndex) {
        await released;
      }
      if (offset >= bytes.length) {
        if (cut) controller.error(new TypeError("terminated"));
        else controller.close();
        return;
      }
      const end = holdIndex > offset ? Math.min(offset + chunkSize, holdIndex) : offset + chunkSize;
      controller.enqueue(bytes.slice(offset, Math.min(end, bytes.length)));
      offset = Math.min(end, bytes.length);
    },
  });
  const response = new Response(body, {
    status: 200,
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "x-request-id": "req_stream",
      "openai-processing-ms": "120",
      ...headers,
    },
  });
  return { response, release };
}

async function rejectsWith(promise, kind) {
  await assert.rejects(promise, (error) => {
    assert.ok(error instanceof SemanticIntentProviderError, String(error));
    assert.equal(error.kind, kind, error.message);
    assert.equal(error.providerRequestId, "req_stream");
    return true;
  });
}

test("loads the streaming switch: on by default, off restores the buffered request", () => {
  assert.equal(loadSemanticIntentConfig({}).stream, true);
  assert.equal(loadSemanticIntentConfig({ AIRBOARD_INTENT_STREAM: "off" }).stream, false);
  assert.equal(loadSemanticIntentConfig({ AIRBOARD_INTENT_STREAM: "ON" }).stream, true);
  assert.throws(() => loadSemanticIntentConfig({ AIRBOARD_INTENT_STREAM: "maybe" }), /AIRBOARD_INTENT_STREAM/);
});

test("a streamed plan resolves at the finished tool call, before the final event's body arrives", async () => {
  let capturedInit;
  const text = sseText(streamedEvents(resolvedPlan));
  const { response: streamed, release } = sseResponse(text, { holdAt: "event: response.completed\n" });
  const provider = new OpenAiResponsesSemanticIntentProvider(streamConfig, async (_url, init) => {
    capturedInit = init;
    return streamed;
  });

  // The body is held right after the final event's name; resolve must not wait for it.
  const result = await provider.resolve(streamRequest, "gpt-5.6-terra");
  assert.deepEqual(result.plan, resolvedPlan);
  assert.equal(result.metadata.responseId, "resp_stream");
  assert.equal(result.metadata.responseModel, "gpt-5.6-terra-2026-07-01");
  assert.equal(result.metadata.providerRequestId, "req_stream");
  assert.equal(result.metadata.providerProcessingMs, 120);
  assert.equal(result.metadata.usage, null, "usage is not on the wire until the final event is read");
  // The browser accepts exactly these metadata keys.
  assert.deepEqual(Object.keys(result.metadata).sort(), [
    "clientRequestId",
    "providerProcessingMs",
    "providerRequestId",
    "responseId",
    "responseModel",
    "totalLatencyMs",
    "usage",
  ]);
  assert.equal(result.diagnostics.streamed, true);
  assert.ok(result.diagnostics.headersMs >= 0);
  assert.ok(result.diagnostics.itemDoneMs >= result.diagnostics.headersMs);
  assert.equal(JSON.parse(capturedInit.body).stream, true);

  release();
  assert.deepEqual(await result.lateUsage, {
    inputTokens: 11_450,
    outputTokens: 92,
    totalTokens: 11_542,
    cachedInputTokens: 11_208,
    reasoningTokens: 0,
  });
});

test("a streamed final event that arrives in the same read still yields usage, with CRLF line ends", async () => {
  const text = sseText(streamedEvents(resolvedPlan), "\r\n");
  const provider = new OpenAiResponsesSemanticIntentProvider(
    streamConfig,
    async () => sseResponse(text, { chunkSize: 1_000_000 }).response,
  );
  const result = await provider.resolve(streamRequest, "gpt-5.6-terra");
  assert.deepEqual(result.plan, resolvedPlan);
  assert.deepEqual(result.metadata.usage, { inputTokens: 11_450, outputTokens: 92, totalTokens: 11_542 });
  assert.equal(result.diagnostics.usage.cachedInputTokens, 11_208);
  assert.equal(result.lateUsage, undefined);
});

test("streamed calls read each body to its end, so the next call reuses the keep-alive socket", async () => {
  const text = sseText(streamedEvents(resolvedPlan));
  const splitAt = text.indexOf("event: response.completed\n") + "event: response.completed\n".length;
  let sockets = 0;
  let mode = "whole";
  const server = createServer((_req, res) => {
    res.writeHead(200, { "content-type": "text/event-stream; charset=utf-8", "x-request-id": "req_stream" });
    // The message's terminating chunk follows the last event a moment later,
    // as it does from the provider.
    const finish = () => setTimeout(() => res.end(), 10);
    if (mode === "whole") {
      res.write(text);
      finish();
      return;
    }
    // Hold the final event's body so the plan resolves first and usage is read late.
    res.write(text.slice(0, splitAt));
    setTimeout(() => {
      res.write(text.slice(splitAt));
      finish();
    }, 30);
  });
  server.on("connection", () => {
    sockets += 1;
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  const provider = new OpenAiResponsesSemanticIntentProvider(streamConfig, (_url, init) =>
    fetch(`http://127.0.0.1:${port}/v1/responses`, init),
  );
  const settle = () => new Promise((resolve) => setTimeout(resolve, 50));
  try {
    for (const nextMode of ["whole", "whole", "late", "late", "whole"]) {
      mode = nextMode;
      const result = await provider.resolve(streamRequest, "gpt-5.6-terra");
      assert.deepEqual(result.plan, resolvedPlan);
      if (result.lateUsage) {
        assert.equal((await result.lateUsage).cachedInputTokens, 11_208);
      }
      await settle();
    }
    assert.equal(sockets, 1, "every call reused the first connection");
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
});

test("streamed clarification and not-a-board-command plans resolve unchanged", async () => {
  const clarification = {
    version: AIRBOARD_SEMANTIC_PLAN_CONTRACT_VERSION,
    status: "clarification",
    issueCode: "incomplete_request",
    clarificationQuestion: "What label should the second branch use?",
    missingSlots: ["branch_label"],
    actions: [],
  };
  const notBoardCommand = {
    version: AIRBOARD_SEMANTIC_PLAN_CONTRACT_VERSION,
    status: "unsupported",
    issueCode: "not_board_command",
    clarificationQuestion: null,
    missingSlots: [],
    actions: [],
  };
  for (const plan of [clarification, notBoardCommand]) {
    const provider = new OpenAiResponsesSemanticIntentProvider(
      streamConfig,
      async () => sseResponse(sseText(streamedEvents(plan))).response,
    );
    const result = await provider.resolve(streamRequest, "gpt-5.6-terra");
    assert.deepEqual(result.plan, plan);
    await result.lateUsage;
  }
});

test("streamed failures map to the same error kinds as buffered ones", async () => {
  const created = streamedEvents(resolvedPlan).slice(0, 2);
  const cases = [
    // A failed response without a code is an unusable answer.
    [[...created, ["response.failed", { response: { id: "resp_stream", status: "failed", error: null } }]], "invalid_output"],
    // A server error inside the stream counts as an outage, as a 500 would.
    [[...created, ["response.failed", { response: { status: "failed", error: { code: "server_error" } } }]], "provider_unavailable"],
    [[...created, ["error", { code: "rate_limit_exceeded", message: "must not be reflected" }]], "rate_limited"],
    // max_output_tokens reached.
    [
      [
        ...streamedEvents(resolvedPlan).slice(0, 4),
        ["response.incomplete", { response: { status: "incomplete", incomplete_details: { reason: "max_output_tokens" } } }],
      ],
      "invalid_output",
    ],
    // The tool call itself did not finish.
    [streamedEvents(resolvedPlan, { item: planItem(resolvedPlan, { status: "incomplete" }) }), "invalid_output"],
    // Malformed and schema-invalid arguments are still rejected.
    [streamedEvents(resolvedPlan, { item: planItem(resolvedPlan, { arguments: "not json" }) }), "invalid_output"],
    [streamedEvents(resolvedPlan, { item: planItem({ ...resolvedPlan, actions: [] }) }), "invalid_output"],
    // A clean end after response.created, and one right after the tool call.
    [created, "invalid_output"],
    [streamedEvents(resolvedPlan, { completed: false }), "invalid_output"],
    // A final event that never carried the tool call.
    [[...created, ["response.completed", { response: { status: "completed", output: [] } }]], "invalid_output"],
  ];
  for (const [events, kind] of cases) {
    const provider = new OpenAiResponsesSemanticIntentProvider(
      streamConfig,
      async () => sseResponse(sseText(events)).response,
    );
    await rejectsWith(provider.resolve(streamRequest, "gpt-5.6-terra"), kind);
  }
});

test("a second streamed tool call is rejected", async () => {
  const second = planItem(resolvedPlan, { id: "fc_2", call_id: "call_2" });
  const events = [
    ...streamedEvents(resolvedPlan, { completed: false }),
    ["response.output_item.added", { output_index: 1, item: { ...second, arguments: "", status: "in_progress" } }],
    ["response.output_item.done", { output_index: 1, item: second }],
    ["response.completed", { response: { status: "completed", output: [planItem(resolvedPlan), second] } }],
  ];
  const provider = new OpenAiResponsesSemanticIntentProvider(
    streamConfig,
    async () => sseResponse(sseText(events)).response,
  );
  await rejectsWith(provider.resolve(streamRequest, "gpt-5.6-terra"), "invalid_output");
});

test("a connection cut mid-stream is a provider outage, and an abort is a timeout", async () => {
  const created = sseText(streamedEvents(resolvedPlan).slice(0, 1));
  const cutProvider = new OpenAiResponsesSemanticIntentProvider(
    streamConfig,
    async () => sseResponse(created, { cut: true }).response,
  );
  await rejectsWith(cutProvider.resolve(streamRequest, "gpt-5.6-terra"), "provider_unavailable");

  const controller = new AbortController();
  const text = sseText(streamedEvents(resolvedPlan));
  const abortProvider = new OpenAiResponsesSemanticIntentProvider(streamConfig, async (_url, init) => {
    const { response: held } = sseResponse(text, { holdAt: "response.in_progress" });
    init.signal.addEventListener("abort", () => held.body.cancel().catch(() => undefined));
    setTimeout(() => controller.abort(), 10);
    return {
      ok: true,
      status: 200,
      headers: held.headers,
      // Mirrors fetch: an aborted signal errors the body reader.
      body: new ReadableStream({
        async start(streamController) {
          const reader = held.body.getReader();
          init.signal.addEventListener("abort", () => {
            const error = new Error("aborted");
            error.name = "AbortError";
            streamController.error(error);
          });
          for (;;) {
            const chunk = await reader.read().catch(() => ({ done: true }));
            if (chunk.done) return;
            streamController.enqueue(chunk.value);
          }
        },
      }),
    };
  });
  await assert.rejects(
    abortProvider.resolve(streamRequest, "gpt-5.6-terra", controller.signal),
    (error) => error.kind === "timeout",
  );
});

test("with streaming off the request is byte-identical to the buffered one, and a JSON answer still works when on", async () => {
  const bodies = {};
  const buffered = {
    status: "completed",
    id: "resp_buffered",
    usage: streamedUsage,
    output: [planItem(resolvedPlan)],
  };
  for (const [name, config] of [
    ["unset", runtimeConfig],
    ["off", { ...runtimeConfig, stream: false }],
    ["on", streamConfig],
  ]) {
    const provider = new OpenAiResponsesSemanticIntentProvider(config, async (_url, init) => {
      bodies[name] = init.body;
      // A proxy that ignores `stream` answers with JSON; the plan still parses.
      return response(buffered);
    });
    const result = await provider.resolve(streamRequest, "gpt-5.6-terra");
    assert.deepEqual(result.plan, resolvedPlan);
    assert.equal(result.diagnostics.streamed, false);
    assert.equal(result.diagnostics.itemDoneMs, null);
    // A2: the cache hit count is logged but never sent to the browser.
    assert.deepEqual(result.metadata.usage, { inputTokens: 11_450, outputTokens: 92, totalTokens: 11_542 });
    assert.deepEqual(result.diagnostics.usage, {
      inputTokens: 11_450,
      outputTokens: 92,
      totalTokens: 11_542,
      cachedInputTokens: 11_208,
      reasoningTokens: 0,
    });
  }
  assert.equal(bodies.off, bodies.unset);
  assert.equal(bodies.off.includes('"stream"'), false);
  const on = JSON.parse(bodies.on);
  assert.equal(on.stream, true);
  delete on.stream;
  assert.equal(JSON.stringify(on), bodies.off, "streaming only appends stream: true");
});
