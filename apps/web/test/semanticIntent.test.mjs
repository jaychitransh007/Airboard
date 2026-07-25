import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { registerHooks } from "node:module";
import test from "node:test";
import { fileURLToPath } from "node:url";

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
  fetchSemanticIntentConfig,
  resolveSemanticIntent,
  semanticIntentIssueMessage,
  SemanticIntentClientError,
  shouldUseSemanticIntentFallback,
} = await import("../src/features/board/semanticIntent.ts");
const { parseIntentCanvasCommand } = await import(
  "../src/features/board/intentCanvasParser.ts"
);

const CONTEXT = {
  selectionCount: 1,
  selected: [
    {
      label: "User One",
      nodeType: "user",
      ordinal: 1,
      selected: true,
      position: { x: 120, y: 140 },
      size: { width: 128, height: 88 },
    },
  ],
  objects: [
    {
      label: "User One",
      nodeType: "user",
      ordinal: 1,
      selected: true,
      position: { x: 120, y: 140 },
      size: { width: 128, height: 88 },
    },
    {
      label: "Decision",
      nodeType: "decision",
      ordinal: 1,
      selected: false,
      position: { x: 320, y: 140 },
      size: { width: 120, height: 88 },
    },
    {
      label: "User Two",
      nodeType: "user",
      ordinal: 2,
      selected: false,
      position: { x: 520, y: 140 },
      size: { width: 128, height: 88 },
    },
  ],
  edges: [
    {
      from: { label: "Decision", nodeType: "decision", ordinal: 1 },
      to: { label: "User One", nodeType: "user", ordinal: 1 },
      label: "yes",
    },
  ],
  projectGlossary: [{ term: "Eligibility Gate", nodeType: "decision" }],
  pointerAvailable: true,
};

const METADATA = {
  responseId: "resp_123",
  responseModel: "gpt-5.6-terra",
  providerRequestId: "req_123",
  clientRequestId: "airboard:voice-turn-123:client",
  providerProcessingMs: 321,
  totalLatencyMs: 418,
  usage: { inputTokens: 240, outputTokens: 80, totalTokens: 320 },
};

const CREATE_DECISION_PLAN = {
  version: "1.1",
  status: "resolved",
  issueCode: "none",
  clarificationQuestion: null,
  missingSlots: [],
  actions: [
    {
      type: "create",
      nodeType: "decision",
      label: null,
      handle: "decision_1",
      placement: { kind: "pointer" },
    },
  ],
};

function jsonResponse(payload, { ok = true, status = 200 } = {}) {
  return {
    ok,
    status,
    async json() {
      return payload;
    },
  };
}

test("fetches and sanitizes public semantic intent configuration", async () => {
  const requests = [];
  const config = await fetchSemanticIntentConfig("http://localhost:4000/base", async (...args) => {
    requests.push(args);
    return jsonResponse({
      available: true,
      provider: "openai",
      defaultModel: "gpt-5.6-terra",
      allowedModels: ["gpt-5.6-terra", 42, null, "gpt-5.6-luna"],
      apiKey: "must-not-reach-the-browser",
    });
  });

  assert.equal(String(requests[0][0]), "http://localhost:4000/intent/config");
  assert.deepEqual(config, {
    available: true,
    provider: "openai",
    defaultModel: "gpt-5.6-terra",
    allowedModels: ["gpt-5.6-terra", "gpt-5.6-luna"],
  });
});

test("routes parser failures but not safe deterministic commands to semantic planning", () => {
  const external = { activationPolicy: "externally_activated" };
  assert.equal(shouldUseSemanticIntentFallback(parseIntentCanvasCommand("add a q", external)), true);
  assert.equal(
    shouldUseSemanticIntentFallback(
      parseIntentCanvasCommand("connect decision to user one and user two as yes and no", external),
    ),
    true,
  );
  assert.equal(shouldUseSemanticIntentFallback(parseIntentCanvasCommand("add a queue", external)), false);
  assert.equal(shouldUseSemanticIntentFallback(parseIntentCanvasCommand("", external)), false);
});

test("posts voice turn, rich board context, and clarification continuity", async () => {
  let body;
  const result = await resolveSemanticIntent(
    {
      apiBaseUrl: "http://localhost:4000/base",
      voiceTurnId: "voice-turn-123",
      transcript: "no",
      parserIssue: "unknown_command",
      context: CONTEXT,
      pendingClarification: {
        previousTranscript: "connect the decision with yes and",
        question: "What should the second branch label be?",
        missingSlots: ["branch_label"],
      },
      model: "gpt-5.6-terra",
      timeoutMs: 100,
    },
    async (_url, init) => {
      body = JSON.parse(init.body);
      return jsonResponse({
        plan: CREATE_DECISION_PLAN,
        provider: "openai",
        model: "gpt-5.6-terra",
        metadata: METADATA,
      });
    },
  );

  assert.equal(body.voiceTurnId, "voice-turn-123");
  assert.deepEqual(body.context, CONTEXT);
  assert.equal(body.pendingClarification.missingSlots[0], "branch_label");
  assert.deepEqual(result.plan, CREATE_DECISION_PLAN);
  assert.deepEqual(result.metadata, METADATA);
});

test("accepts typed branch and named rename plans", async () => {
  const plan = {
    version: "1.1",
    status: "resolved",
    issueCode: "none",
    clarificationQuestion: null,
    missingSlots: [],
    actions: [
      {
        type: "rename",
        target: { kind: "visible_label", label: "Circle", occurrence: null },
        label: "User",
      },
      {
        type: "branch",
        from: { kind: "type_ordinal", nodeType: "decision", ordinal: 1 },
        branches: [
          { to: { kind: "type_ordinal", nodeType: "user", ordinal: 1 }, label: "yes" },
          { to: { kind: "type_ordinal", nodeType: "user", ordinal: 2 }, label: "no" },
        ],
      },
    ],
  };
  const result = await resolveSemanticIntent(
    {
      apiBaseUrl: "http://localhost:4000",
      voiceTurnId: "voice-turn-branch",
      transcript: "rename circle and branch decision",
      parserIssue: "compound_command",
      context: CONTEXT,
    },
    async () =>
      jsonResponse({ plan, provider: "openai", model: "gpt-5.6-terra", metadata: METADATA }),
  );
  assert.deepEqual(result.plan.actions, plan.actions);
});

test("accepts structured clarification plans", async () => {
  const plan = {
    version: "1.1",
    status: "clarification",
    issueCode: "incomplete_request",
    clarificationQuestion: "What label should the second decision branch use?",
    missingSlots: ["branch_label"],
    actions: [],
  };
  const result = await resolveSemanticIntent(
    {
      apiBaseUrl: "http://localhost:4000",
      voiceTurnId: "voice-turn-clarify",
      transcript: "connect decision with yes and",
      parserIssue: "unsupported_branching",
      context: CONTEXT,
    },
    async () =>
      jsonResponse({ plan, provider: "openai", model: "gpt-5.6-terra", metadata: METADATA }),
  );
  assert.equal(result.plan.clarificationQuestion, plan.clarificationQuestion);
  assert.deepEqual(result.plan.missingSlots, ["branch_label"]);
});

test("rejects malformed plans and provider metadata", async () => {
  const malformed = [
    { plan: { ...CREATE_DECISION_PLAN, actions: [] }, provider: "openai", model: "gpt-5.6-terra", metadata: METADATA },
    { plan: { ...CREATE_DECISION_PLAN, extra: true }, provider: "openai", model: "gpt-5.6-terra", metadata: METADATA },
    { plan: CREATE_DECISION_PLAN, provider: "openai", model: "gpt-5.6-terra", metadata: { ...METADATA, totalLatencyMs: -1 } },
    { plan: CREATE_DECISION_PLAN, provider: "openai", model: "gpt-5.6-terra", metadata: { ...METADATA, secret: "no" } },
  ];
  for (const payload of malformed) {
    await assert.rejects(
      resolveSemanticIntent(
        {
          apiBaseUrl: "http://localhost:4000",
          voiceTurnId: "voice-turn-invalid",
          transcript: "unclear",
          parserIssue: "unknown_command",
          context: CONTEXT,
        },
        async () => jsonResponse(payload),
      ),
      (error) =>
        error instanceof SemanticIntentClientError &&
        error.code === "INVALID_SEMANTIC_INTENT_RESPONSE",
    );
  }
});

test("surfaces provider-specific errors and request IDs", async () => {
  const cases = [
    ["SEMANTIC_INTENT_PROVIDER_AUTH_FAILED", "API key was rejected"],
    ["SEMANTIC_INTENT_QUOTA_EXHAUSTED", "quota is exhausted"],
    ["SEMANTIC_INTENT_RATE_LIMITED", "rate-limited"],
    ["SEMANTIC_INTENT_MODEL_UNAVAILABLE", "model is unavailable"],
  ];
  for (const [code, phrase] of cases) {
    await assert.rejects(
      resolveSemanticIntent(
        {
          apiBaseUrl: "http://localhost:4000",
          voiceTurnId: "voice-turn-error",
          transcript: "add a condition",
          parserIssue: "unknown_command",
          context: CONTEXT,
        },
        async () =>
          jsonResponse(
            { error: code, message: "provider detail", providerRequestId: "req_failure" },
            { ok: false, status: 503 },
          ),
      ),
      (error) => {
        assert.ok(error instanceof SemanticIntentClientError);
        assert.equal(error.code, code);
        assert.match(error.message, new RegExp(phrase, "i"));
        assert.equal(error.providerRequestId, "req_failure");
        return true;
      },
    );
  }
});

test("maps semantic issue codes to actionable messages", () => {
  assert.equal(semanticIntentIssueMessage("none"), "Airo understood the command.");
  assert.match(semanticIntentIssueMessage("ambiguous_reference"), /more than one/i);
  assert.match(semanticIntentIssueMessage("missing_selection"), /select/i);
  assert.match(semanticIntentIssueMessage("incomplete_request"), /one more detail/i);
  assert.match(semanticIntentIssueMessage("unsupported_operation"), /not supported/i);
});

test("uses a 6000ms default timeout", async () => {
  const originalSetTimeout = globalThis.setTimeout;
  const originalClearTimeout = globalThis.clearTimeout;
  const handle = { kind: "semantic-timeout" };
  let delay;
  let cleared;
  globalThis.setTimeout = (_callback, value) => {
    delay = value;
    return handle;
  };
  globalThis.clearTimeout = (value) => {
    cleared = value;
  };
  try {
    await resolveSemanticIntent(
      {
        apiBaseUrl: "http://localhost:4000",
        voiceTurnId: "voice-turn-timeout-default",
        transcript: "add a decision",
        parserIssue: "unknown_command",
        context: CONTEXT,
      },
      async () =>
        jsonResponse({
          plan: CREATE_DECISION_PLAN,
          provider: "openai",
          model: "gpt-5.6-terra",
          metadata: METADATA,
        }),
    );
  } finally {
    globalThis.setTimeout = originalSetTimeout;
    globalThis.clearTimeout = originalClearTimeout;
  }
  assert.equal(delay, 6_000);
  assert.equal(cleared, handle);
});

test("aborts a slow request with a precise timeout error", async () => {
  await assert.rejects(
    resolveSemanticIntent(
      {
        apiBaseUrl: "http://localhost:4000",
        voiceTurnId: "voice-turn-timeout",
        transcript: "add a database",
        parserIssue: "unknown_command",
        context: CONTEXT,
        timeoutMs: 5,
      },
      async (_url, init) =>
        new Promise((_resolve, reject) => {
          init.signal.addEventListener(
            "abort",
            () => reject(new DOMException("Aborted", "AbortError")),
            { once: true },
          );
        }),
    ),
    (error) =>
      error instanceof SemanticIntentClientError && error.code === "SEMANTIC_INTENT_TIMEOUT",
  );
});
