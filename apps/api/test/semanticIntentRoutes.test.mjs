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

function fakeAuth({ entitledOrganizations = [] } = {}) {
  const calls = { authenticate: 0, entitlement: [] };
  return {
    calls,
    async authenticate(request) {
      calls.authenticate += 1;
      const header = request.headers.authorization;
      const match = typeof header === "string" ? /^Bearer user:(.+)$/.exec(header) : null;
      if (!match) return null;
      return {
        authUserId: match[1],
        profileId: `profile-${match[1]}`,
        organizationId: `org-${match[1]}`,
        role: "owner",
        email: null,
        displayName: match[1],
        tokenKind: "supabase",
      };
    },
    async activeEntitlement(organizationId) {
      calls.entitlement.push(organizationId);
      return entitledOrganizations.includes(organizationId)
        ? { status: "trialing" }
        : null;
    },
  };
}

function productionConfig(overrides = {}) {
  return {
    ...makeConfig(),
    localEntitlements: false,
    apiToken: "operator-secret",
    trustedProxyHops: 1,
    ...overrides,
  };
}

const fanInTranscript =
  "Planner gets additional context from Golden Dataset and Historical Dataset.";

test("intent resolution requires an active entitlement for signed-in callers", async (t) => {
  const server = Fastify();
  t.after(() => server.close());
  const auth = fakeAuth({ entitledOrganizations: ["org-paid"] });
  registerSemanticIntentRoutes(server, productionConfig(), undefined, auth);

  const anonymous = await server.inject({
    method: "POST",
    url: "/intent/resolve",
    headers: { origin },
    payload: requestBody(fanInTranscript),
  });
  assert.equal(anonymous.statusCode, 401);
  assert.equal(anonymous.json().error, "AUTH_REQUIRED");

  // A freshly provisioned magic-link account has no active entitlement.
  const unentitled = await server.inject({
    method: "POST",
    url: "/intent/resolve",
    headers: { origin, authorization: "Bearer user:fresh" },
    payload: requestBody(fanInTranscript),
  });
  assert.equal(unentitled.statusCode, 402);
  assert.deepEqual(unentitled.json(), { error: "ACTIVE_ENTITLEMENT_REQUIRED" });
  assert.deepEqual(auth.calls.entitlement, ["org-fresh"]);

  const entitled = await server.inject({
    method: "POST",
    url: "/intent/resolve",
    headers: { origin, authorization: "Bearer user:paid" },
    payload: requestBody(fanInTranscript),
  });
  assert.equal(entitled.statusCode, 200, entitled.body);

  // The operator token is trusted infrastructure and skips account checks.
  const callsBefore = auth.calls.authenticate;
  const operator = await server.inject({
    method: "POST",
    url: "/intent/resolve",
    headers: { origin, authorization: "Bearer operator-secret" },
    payload: requestBody(fanInTranscript),
  });
  assert.equal(operator.statusCode, 200, operator.body);
  assert.equal(auth.calls.authenticate, callsBefore);
});

test("local entitlements keep intent resolution open without an entitlement lookup", async (t) => {
  const server = Fastify();
  t.after(() => server.close());
  const auth = fakeAuth();
  registerSemanticIntentRoutes(server, productionConfig({ localEntitlements: true }), undefined, auth);
  const response = await server.inject({
    method: "POST",
    url: "/intent/resolve",
    headers: { origin, authorization: "Bearer user:local" },
    payload: requestBody(fanInTranscript),
  });
  assert.equal(response.statusCode, 200, response.body);
  assert.deepEqual(auth.calls.entitlement, []);
});

test("intent rate limits follow the profile, not a spoofable forwarded address", async (t) => {
  const server = Fastify();
  t.after(() => server.close());
  const auth = fakeAuth({ entitledOrganizations: ["org-a", "org-b"] });
  registerSemanticIntentRoutes(
    server,
    productionConfig({ rateLimits: { intentPerMinute: 1 } }),
    undefined,
    auth,
  );
  const send = (user, forwardedFor) =>
    server.inject({
      method: "POST",
      url: "/intent/resolve",
      headers: { origin, authorization: `Bearer user:${user}`, "x-forwarded-for": forwardedFor },
      payload: requestBody(fanInTranscript),
    });

  assert.equal((await send("a", "1.1.1.1, 9.9.9.9")).statusCode, 200);
  // Rotating the client-controlled first entry does not reset the budget.
  const rotated = await send("a", "2.2.2.2, 9.9.9.9");
  assert.equal(rotated.statusCode, 429);
  assert.equal(rotated.json().error, "RATE_LIMITED");
  // A different account behind the same address keeps its own budget.
  assert.equal((await send("b", "1.1.1.1, 9.9.9.9")).statusCode, 200);
});

test("a provider outage trips the breaker so later commands fail fast", async (t) => {
  const { createServer } = await import("node:http");
  let providerCalls = 0;
  const provider = createServer((_request, response) => {
    providerCalls += 1;
    response.writeHead(500, { "content-type": "application/json" });
    response.end(JSON.stringify({ error: { code: "server_error" } }));
  });
  await new Promise((resolve) => provider.listen(0, "127.0.0.1", resolve));
  t.after(() => provider.close());

  const server = Fastify();
  t.after(() => server.close());
  const config = makeConfig();
  registerSemanticIntentRoutes(server, {
    ...config,
    semanticIntent: {
      ...config.semanticIntent,
      provider: "openai",
      apiKey: "test-key",
      endpoint: `http://127.0.0.1:${provider.address().port}/v1/responses`,
    },
  });
  const send = () =>
    server.inject({
      method: "POST",
      url: "/intent/resolve",
      headers: { origin },
      payload: requestBody("make the planner talk to the dataset"),
    });

  for (let attempt = 0; attempt < 3; attempt += 1) {
    assert.equal((await send()).json().error, "SEMANTIC_INTENT_PROVIDER_UNAVAILABLE");
  }
  assert.equal(providerCalls, 3);

  const fastFail = await send();
  assert.equal(fastFail.statusCode, 503);
  assert.equal(fastFail.json().error, "SEMANTIC_INTENT_UNAVAILABLE");
  assert.ok(Number(fastFail.headers["retry-after"]) > 0);
  assert.equal(providerCalls, 3, "the provider is not called while the breaker is open");
});

test("a person's daily Airo allowance is checked before the model is called", async (t) => {
  const { createServer } = await import("node:http");
  let providerCalls = 0;
  const provider = createServer((_request, response) => {
    providerCalls += 1;
    response.writeHead(500, { "content-type": "application/json" });
    response.end(JSON.stringify({ error: { code: "server_error" } }));
  });
  await new Promise((resolve) => provider.listen(0, "127.0.0.1", resolve));
  t.after(() => provider.close());

  const charges = [];
  let remaining = 1;
  let failCount = false;
  const auth = {
    ...fakeAuth({ entitledOrganizations: ["org-a"] }),
    client: {
      async rpc(name, params) {
        charges.push({ name, ...params });
        if (failCount) return { data: null, error: { message: "database unavailable" } };
        if (remaining <= 0) return { data: null, error: null };
        remaining -= 1;
        return { data: 1, error: null };
      },
    },
  };
  const server = Fastify();
  t.after(() => server.close());
  const config = productionConfig();
  registerSemanticIntentRoutes(server, {
    ...config,
    dailyUsage: { airoCommands: 300, voiceSeconds: 600 },
    semanticIntent: {
      ...config.semanticIntent,
      provider: "openai",
      apiKey: "test-key",
      endpoint: `http://127.0.0.1:${provider.address().port}/v1/responses`,
    },
  }, undefined, auth);
  const send = (transcript) =>
    server.inject({
      method: "POST",
      url: "/intent/resolve",
      headers: { origin, authorization: "Bearer user:a" },
      payload: requestBody(transcript),
    });

  // Built-in answers cost nothing.
  assert.equal((await send(fanInTranscript)).statusCode, 200);
  assert.equal(charges.length, 0);

  // The first model call is charged and reaches the model.
  assert.equal((await send("make the planner talk to the dataset")).json().error, "SEMANTIC_INTENT_PROVIDER_UNAVAILABLE");
  assert.deepEqual(charges[0], {
    name: "consume_daily_usage",
    p_profile_id: "profile-a",
    p_metric: "airo_commands",
    p_amount: 1,
    p_limit: 300,
  });
  assert.equal(providerCalls, 1);

  // With the allowance used up, the model is not called.
  const exhausted = await send("make the planner talk to the dataset");
  assert.equal(exhausted.statusCode, 429);
  assert.equal(exhausted.json().error, "DAILY_AIRO_LIMIT");
  assert.equal(providerCalls, 1);

  // If the count itself fails, the command still goes through.
  failCount = true;
  assert.equal((await send("make the planner talk to the dataset")).json().error, "SEMANTIC_INTENT_PROVIDER_UNAVAILABLE");
  assert.equal(providerCalls, 2);
});
