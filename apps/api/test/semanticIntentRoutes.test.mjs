import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { registerHooks } from "node:module";
import test from "node:test";
import { fileURLToPath } from "node:url";
import Fastify from "fastify";

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

const { registerSemanticIntentRoutes } = await import(
  "../src/semanticIntent/routes.ts"
);

const origin = "https://airboard.test";
const closedContext = {
  selectionCount: 1,
  selected: [
    {
      label: "Planner",
      nodeType: "process",
      ordinal: 1,
      selected: true,
    },
  ],
  objects: [
    {
      label: "Golden Dataset",
      nodeType: "database",
      ordinal: 1,
      selected: false,
    },
    {
      label: "Historical Dataset",
      nodeType: "database",
      ordinal: 2,
      selected: false,
    },
    {
      label: "Planner",
      nodeType: "process",
      ordinal: 1,
      selected: true,
    },
  ],
  edges: [],
  projectGlossary: [
    { term: "Golden Dataset", nodeType: "database" },
    { term: "Historical Dataset", nodeType: "database" },
    { term: "Planner", nodeType: "process" },
  ],
  pointerAvailable: false,
};

function makeConfig() {
  return {
    allowedOrigins: [origin],
    localEntitlements: true,
    rateLimits: { intentPerMinute: 100 },
    semanticIntent: {
      provider: "disabled",
      defaultModel: "gpt-5.6-terra",
      allowedModels: ["gpt-5.6-terra"],
      endpoint: "https://provider.invalid/v1/responses",
      reasoningEffort: "none",
      timeoutMs: 5_000,
      maxConcurrentRequests: 8,
      maxTranscriptCharacters: 500,
    },
  };
}

function requestBody(transcript, context = closedContext) {
  return {
    voiceTurnId: `voice-turn-${crypto.randomUUID()}`,
    transcript,
    parserIssue: "unknown_command",
    context,
  };
}

test("the semantic endpoint resolves exact and observed fan-in turns without an LLM", async (t) => {
  const server = Fastify();
  t.after(() => server.close());
  registerSemanticIntentRoutes(server, makeConfig());

  const transcripts = [
    "Planner gets additional context from Golden Dataset and Historical Dataset.",
    "Planner receives the additional context from the historical data and golden dataset.",
    "So this will accept the additional content from the schema data and another additional context from the historical dataset.",
  ];
  for (const transcript of transcripts) {
    const response = await server.inject({
      method: "POST",
      url: "/intent/resolve",
      headers: { origin },
      payload: requestBody(transcript),
    });
    assert.equal(response.statusCode, 200, response.body);
    const result = response.json();
    assert.equal(result.provider, "airboard-deterministic");
    assert.equal(result.model, "existing-board-fan-in-v1");
    const expectedSources = transcript.includes(
      "historical data and golden dataset",
    )
      ? ["Historical Dataset", "Golden Dataset"]
      : ["Golden Dataset", "Historical Dataset"];
    assert.deepEqual(
      result.plan.actions.map((action) => ({
        type: action.type,
        from: action.from.label,
        to: action.to.label,
        label: action.label,
      })),
      expectedSources.map((from) => ({
        type: "connect",
        from,
        to: "Planner",
        label: "additional context",
      })),
    );
    assert.equal(
      result.plan.actions.some((action) => action.type === "create"),
      false,
    );
    assert.equal(result.metadata.usage, null);
  }
});

test("the semantic endpoint returns an explicit zero-cost no-change result", async (t) => {
  const server = Fastify();
  t.after(() => server.close());
  registerSemanticIntentRoutes(server, makeConfig());

  const satisfiedContext = {
    ...closedContext,
    selectionCount: 0,
    selected: [],
    objects: [
      ...closedContext.objects,
      {
        label: "Policy Store",
        nodeType: "database",
        ordinal: 3,
        selected: false,
      },
      {
        label: "Feature Service",
        nodeType: "service",
        ordinal: 1,
        selected: false,
      },
    ],
    edges: [
      {
        from: { label: "Historical Dataset", nodeType: "database", ordinal: 2 },
        to: { label: "Planner", nodeType: "process", ordinal: 1 },
        label: "additional context",
        occurrence: 1,
      },
      {
        from: { label: "Golden Dataset", nodeType: "database", ordinal: 1 },
        to: { label: "Planner", nodeType: "process", ordinal: 1 },
        label: "additional context",
        occurrence: 1,
      },
    ],
  };
  const response = await server.inject({
    method: "POST",
    url: "/intent/resolve",
    headers: { origin },
    payload: requestBody(
      "Planner receives the additional context from the historical data and golden dataset.",
      satisfiedContext,
    ),
  });
  assert.equal(response.statusCode, 200, response.body);
  const result = response.json();
  assert.deepEqual(
    {
      outcome: result.outcome,
      plan: result.plan,
      provider: result.provider,
      model: result.model,
      usage: result.metadata.usage,
    },
    {
      outcome: "already_satisfied",
      plan: null,
      provider: "airboard-deterministic",
      model: "existing-board-fan-in-v1",
      usage: null,
    },
  );
});

test("the deterministic endpoint rule fails closed when the repair is not unique", async (t) => {
  const server = Fastify();
  t.after(() => server.close());
  registerSemanticIntentRoutes(server, makeConfig());

  const ambiguousContext = {
    ...closedContext,
    selectionCount: 0,
    selected: [],
  };
  const ambiguous = await server.inject({
    method: "POST",
    url: "/intent/resolve",
    headers: { origin },
    payload: requestBody(
      "So this will accept the additional content from the schema data and another additional context from the historical dataset.",
      ambiguousContext,
    ),
  });
  assert.equal(ambiguous.statusCode, 503);
  assert.equal(ambiguous.json().error, "SEMANTIC_INTENT_UNAVAILABLE");

  const unrelated = await server.inject({
    method: "POST",
    url: "/intent/resolve",
    headers: { origin },
    payload: requestBody("Please tell me the weather."),
  });
  assert.equal(unrelated.statusCode, 503);
  assert.equal(unrelated.json().error, "SEMANTIC_INTENT_UNAVAILABLE");

  const malformed = await server.inject({
    method: "POST",
    url: "/intent/resolve",
    headers: { origin },
    payload: requestBody(" "),
  });
  assert.equal(malformed.statusCode, 400);
  assert.equal(malformed.json().error, "INVALID_TRANSCRIPT");
});
