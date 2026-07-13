import assert from "node:assert/strict";
import test from "node:test";

import { apiTokenAllowed, clientKey, createRateLimiter } from "../src/security.ts";

test("rate limiter enforces a sliding window per key", () => {
  const limiter = createRateLimiter({ windowMs: 60_000, max: 3 });
  const t0 = 1_000_000;
  assert.equal(limiter.allow("a", t0), true);
  assert.equal(limiter.allow("a", t0 + 1), true);
  assert.equal(limiter.allow("a", t0 + 2), true);
  assert.equal(limiter.allow("a", t0 + 3), false, "4th call in window denied");
  assert.equal(limiter.allow("b", t0 + 3), true, "other keys unaffected");
  // Window slides: the first hit expires.
  assert.equal(limiter.allow("a", t0 + 60_001, ), true);
});

test("no configured token means open access; configured token gates both transports", () => {
  assert.equal(apiTokenAllowed({ headers: {} }, undefined), true);
  assert.equal(apiTokenAllowed({ headers: {} }, "secret"), false);
  assert.equal(
    apiTokenAllowed({ headers: { authorization: "Bearer secret" } }, "secret"),
    true,
  );
  assert.equal(
    apiTokenAllowed({ headers: { authorization: "Bearer wrong" } }, "secret"),
    false,
  );
  // WebSocket upgrades cannot carry headers from browsers: query param form.
  assert.equal(apiTokenAllowed({ headers: {}, query: { token: "secret" } }, "secret"), true);
  assert.equal(apiTokenAllowed({ headers: {}, query: { token: "nope" } }, "secret"), false);
});

test("clientKey prefers the first forwarded address", () => {
  assert.equal(
    clientKey({ ip: "10.0.0.1", headers: { "x-forwarded-for": "1.2.3.4, 5.6.7.8" } }),
    "1.2.3.4",
  );
  assert.equal(clientKey({ ip: "10.0.0.1", headers: {} }), "10.0.0.1");
  assert.equal(clientKey({ headers: {} }), "unknown");
});
