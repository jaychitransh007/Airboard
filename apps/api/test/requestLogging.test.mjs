import assert from "node:assert/strict";
import test from "node:test";
import { redactSensitiveRequestUrl } from "../src/requestLogging.ts";

test("request logging redacts signed tickets and credentials while preserving routing fields", () => {
  assert.equal(
    redactSensitiveRequestUrl("/sessions/123/state?ticket=signed.jwt&view=board"),
    "/sessions/123/state?ticket=%5BREDACTED%5D&view=board",
  );
  assert.equal(
    redactSensitiveRequestUrl("/callback?code=temporary-code&provider=google"),
    "/callback?code=%5BREDACTED%5D&provider=google",
  );
  assert.equal(redactSensitiveRequestUrl("/ready"), "/ready");
});
