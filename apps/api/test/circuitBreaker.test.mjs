import assert from "node:assert/strict";
import test from "node:test";

import { createCircuitBreaker } from "../src/security.ts";

test("a circuit breaker opens after repeated outages and lets one trial through after the cooldown", () => {
  const breaker = createCircuitBreaker({ failureThreshold: 3, cooldownMs: 30_000 });
  breaker.recordFailure(0);
  breaker.recordFailure(0);
  assert.equal(breaker.retryAfterMs(0), null, "two outages are not enough");
  breaker.recordSuccess();
  breaker.recordFailure(0);
  breaker.recordFailure(0);
  assert.equal(breaker.retryAfterMs(0), null, "a success resets the count");
  breaker.recordFailure(1_000);
  assert.equal(breaker.retryAfterMs(1_000), 30_000);
  assert.equal(breaker.retryAfterMs(16_000), 15_000);

  // After the cooldown one trial goes through while others still wait.
  assert.equal(breaker.retryAfterMs(31_000), null);
  assert.equal(breaker.retryAfterMs(31_000), 1_000);
  // A failed trial reopens it for a full cooldown.
  breaker.recordFailure(32_000);
  assert.equal(breaker.retryAfterMs(32_000), 30_000);

  // A successful trial closes it.
  assert.equal(breaker.retryAfterMs(62_000), null);
  breaker.recordSuccess();
  assert.equal(breaker.retryAfterMs(62_000), null);
  assert.equal(breaker.retryAfterMs(62_000), null);
});

test("an abandoned or silent trial frees the slot for the next caller", () => {
  const breaker = createCircuitBreaker({ failureThreshold: 1, cooldownMs: 1_000 });
  breaker.recordFailure(0);
  assert.equal(breaker.retryAfterMs(1_000), null);
  breaker.abandon();
  assert.equal(breaker.retryAfterMs(1_000), null);
  // A trial that never reports back expires after one cooldown.
  assert.equal(breaker.retryAfterMs(1_500), 1_000);
  assert.equal(breaker.retryAfterMs(2_000), null);
});
