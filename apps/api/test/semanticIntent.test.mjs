import assert from "node:assert/strict";
import { existsSync } from "node:fs";
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
  assert.equal(config.defaultModel, "gpt-5.6-terra");
  assert.equal(config.reasoningEffort, "none");
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
  assert.match(payload.instructions, /low-risk, reversible details/i);
  assert.match(payload.instructions, /return clarification instead of guessing/i);
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
  assert.equal(AIRBOARD_SEMANTIC_INTENT_PROMPT_VERSION, "2.8");
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
