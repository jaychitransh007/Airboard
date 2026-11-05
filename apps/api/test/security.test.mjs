import assert from "node:assert/strict";
import test from "node:test";

import { loadConfig } from "../src/config.ts";
import { apiTokenAllowed, clientIp, clientKey, createRateLimiter } from "../src/security.ts";

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

test("clientKey never trusts a client-supplied first X-Forwarded-For entry", () => {
  // Cloud Run appends the real client address after whatever the client sent.
  const spoofed = { ip: "169.254.1.1", headers: { "x-forwarded-for": "6.6.6.6, 1.2.3.4" } };
  assert.equal(clientKey(spoofed, { trustedProxyHops: 1 }), "ip:1.2.3.4");
  // Rotating the spoofed prefix does not mint a fresh budget.
  assert.equal(
    clientKey({ ...spoofed, headers: { "x-forwarded-for": "7.7.7.7, 1.2.3.4" } }, { trustedProxyHops: 1 }),
    "ip:1.2.3.4",
  );
  // An extra trusted hop (external load balancer) moves one entry left.
  assert.equal(
    clientKey(
      { ip: "10.0.0.1", headers: { "x-forwarded-for": "6.6.6.6, 1.2.3.4, 130.211.0.9" } },
      { trustedProxyHops: 2 },
    ),
    "ip:1.2.3.4",
  );
  // Without a trusted proxy the header is ignored entirely.
  assert.equal(clientKey(spoofed), "ip:169.254.1.1");
  assert.equal(clientKey({ ip: "10.0.0.1", headers: {} }, { trustedProxyHops: 1 }), "ip:10.0.0.1");
  assert.equal(clientKey({ headers: {} }), "ip:unknown");
  assert.equal(
    clientIp({ ip: "10.0.0.1", headers: { "x-forwarded-for": ["6.6.6.6", "1.2.3.4"] } }, 1),
    "1.2.3.4",
  );
});

test("clientKey keys authenticated callers on their profile, not their address", () => {
  const request = { ip: "169.254.1.1", headers: { "x-forwarded-for": "1.2.3.4" } };
  assert.equal(clientKey(request, { profileId: "p-1", trustedProxyHops: 1 }), "profile:p-1");
  assert.equal(clientKey(request, { profileId: null, trustedProxyHops: 1 }), "ip:1.2.3.4");
});

test("trusted proxy hops default to one on Cloud Run and zero elsewhere", () => {
  assert.equal(loadConfig({}).trustedProxyHops, 0);
  assert.equal(loadConfig({ K_SERVICE: "airboard-api" }).trustedProxyHops, 1);
  assert.equal(
    loadConfig({ K_SERVICE: "airboard-api", AIRBOARD_TRUSTED_PROXY_HOPS: "2" }).trustedProxyHops,
    2,
  );
  assert.throws(() => loadConfig({ AIRBOARD_TRUSTED_PROXY_HOPS: "-1" }), /AIRBOARD_TRUSTED_PROXY_HOPS/);
});
