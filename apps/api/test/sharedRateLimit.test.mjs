import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { registerHooks } from "node:module";
import test from "node:test";
import { fileURLToPath } from "node:url";
import Fastify from "fastify";

// The API's sources import each other without extensions.
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith(".") && context.parentURL) {
      const candidate = new URL(`${specifier}.ts`, context.parentURL);
      if (existsSync(fileURLToPath(candidate))) {
        return nextResolve(candidate.href, context);
      }
    }
    return nextResolve(specifier, context);
  },
});

const { registerBoardShareRoutes } = await import("../src/boardShareRoutes.ts");
const { createSharedRateLimiter, hashRateLimitKey } = await import("../src/sharedRateLimit.ts");

/** One table shared by every "instance", like consume_rate_limit's fixed window. */
function sharedTable() {
  const hits = new Map();
  const calls = [];
  return {
    calls,
    client: {
      async rpc(name, params) {
        calls.push({ name, ...params });
        const key = `${params.p_bucket}:${params.p_key_hash}`;
        const count = hits.get(key) ?? 0;
        if (count >= params.p_max) return { data: false, error: null };
        hits.set(key, count + 1);
        return { data: true, error: null };
      },
    },
  };
}

test("instances sharing the count allow max requests in all, not max each", async () => {
  const table = sharedTable();
  const instances = [1, 2, 3].map(() =>
    createSharedRateLimiter({ bucket: "intent", windowMs: 60_000, max: 3, client: table.client }));
  const results = [];
  for (const instance of instances) {
    for (let i = 0; i < 3; i += 1) results.push(await instance.allow("profile:a"));
  }
  assert.equal(results.filter(Boolean).length, 3);
  // Another caller has its own budget.
  assert.equal(await instances[2].allow("profile:b"), true);
});

test("the shared count sees a hash of the caller, never the address or id", async () => {
  const table = sharedTable();
  const limiter = createSharedRateLimiter({ bucket: "board_read", windowMs: 60_000, max: 5, client: table.client });
  await limiter.allow("ip:203.0.113.7");
  assert.deepEqual(table.calls, [{
    name: "consume_rate_limit",
    p_bucket: "board_read",
    p_key_hash: hashRateLimitKey("ip:203.0.113.7"),
    p_window_seconds: 60,
    p_max: 5,
  }]);
  assert.match(table.calls[0].p_key_hash, /^[0-9a-f]{64}$/);
  assert.ok(!JSON.stringify(table.calls).includes("203.0.113.7"));
});

test("the local window refuses a flood without asking the database", async () => {
  const table = sharedTable();
  const limiter = createSharedRateLimiter({ bucket: "intent", windowMs: 60_000, max: 2, client: table.client });
  assert.equal(await limiter.allow("profile:a"), true);
  assert.equal(await limiter.allow("profile:a"), true);
  assert.equal(await limiter.allow("profile:a"), false);
  assert.equal(table.calls.length, 2);
});

test("a failed count lets the request through and is reported", async () => {
  const errors = [];
  const failing = (result) => createSharedRateLimiter({
    bucket: "intent",
    windowMs: 60_000,
    max: 2,
    client: { rpc: result },
    onError: (error) => errors.push(error),
  });
  assert.equal(await failing(async () => ({ data: null, error: { message: "database unavailable" } })).allow("profile:a"), true);
  assert.equal(await failing(async () => { throw new Error("connection reset"); }).allow("profile:a"), true);
  assert.deepEqual(errors.map((error) => error.message), ["database unavailable", "connection reset"]);
});

test("without a database only the local window applies", async () => {
  const limiter = createSharedRateLimiter({ bucket: "intent", windowMs: 60_000, max: 2, client: null });
  assert.deepEqual([await limiter.allow("k"), await limiter.allow("k"), await limiter.allow("k")], [true, true, false]);
});

test("a route refuses with 429 when the shared count is full", async (t) => {
  const server = Fastify();
  t.after(() => server.close());
  registerBoardShareRoutes(server, { appUrl: "http://localhost:3000", trustedProxyHops: 0 }, {
    client: { rpc: async () => ({ data: false, error: null }) },
  }, async () => undefined);
  const response = await server.inject({ method: "GET", url: `/shared-boards/${"A".repeat(43)}` });
  assert.equal(response.statusCode, 429);
  assert.deepEqual(response.json(), { error: "RATE_LIMITED" });
});
