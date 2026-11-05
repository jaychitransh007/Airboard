import assert from "node:assert/strict";
import test from "node:test";

import { bearerToken, issueSignedToken, verifySignedToken } from "../src/signedTokens.ts";

const SECRET = "unit-test-signing-secret-with-enough-entropy";

test("signed tokens round-trip bounded, purpose-scoped claims", () => {
  const token = issueSignedToken(SECRET, {
    purpose: "realtime",
    sub: "profile-1",
    organizationId: "org-1",
    sessionId: "session-1",
    participantId: "participant-1",
    ttlSeconds: 60,
  });
  const claims = verifySignedToken(SECRET, token, "realtime");
  assert.equal(claims?.sub, "profile-1");
  assert.equal(claims?.organizationId, "org-1");
  assert.equal(claims?.sessionId, "session-1");
  assert.equal(claims?.participantId, "participant-1");
  assert.ok((claims?.exp ?? 0) > (claims?.iat ?? 0));
});

test("purpose mismatch, secret mismatch and tampering fail closed", () => {
  const token = issueSignedToken(SECRET, {
    purpose: "installation_link",
    sub: "profile-1",
    installationId: "install-1",
    ttlSeconds: 60,
  });
  assert.equal(verifySignedToken(SECRET, token, "installation"), null);
  assert.equal(verifySignedToken("different-secret", token, "installation_link"), null);
  const [payload, signature] = token.split(".");
  assert.equal(verifySignedToken(SECRET, `${payload}x.${signature}`, "installation_link"), null);
  assert.equal(verifySignedToken(SECRET, `${payload}.${signature}.extra`, "installation_link"), null);
});

test("bearer parsing is case-insensitive and rejects ambiguous input", () => {
  assert.equal(bearerToken({ authorization: "Bearer abc.def" }), "abc.def");
  assert.equal(bearerToken({ authorization: "bearer token" }), "token");
  assert.equal(bearerToken({ authorization: "Basic token" }), null);
  assert.equal(bearerToken({ authorization: ["Bearer one", "Bearer two"] }), null);
  assert.equal(bearerToken({}), null);
});

test("installation credentials support a ninety-day sliding window", () => {
  const token = issueSignedToken(SECRET, {
    purpose: "installation",
    sub: "profile-1",
    organizationId: "org-1",
    installationId: "install-1",
    ttlSeconds: 90 * 24 * 60 * 60,
  });
  const claims = verifySignedToken(SECRET, token, "installation");
  assert.ok(claims);
  assert.ok((claims.exp - claims.iat) >= 89 * 24 * 60 * 60);
});
