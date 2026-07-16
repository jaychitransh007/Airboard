import assert from "node:assert/strict";
import test from "node:test";

import { validateSessionStartBody } from "../src/sessionStartValidation.ts";

const TAB = String.fromCharCode(9);
const NUL = String.fromCharCode(0);
const DEL = String.fromCharCode(127);

test("missing or empty body defaults to a standalone session", () => {
  for (const body of [undefined, null, {}]) {
    const result = validateSessionStartBody(body);
    assert.equal(result.ok, true);
    assert.deepEqual(result.value, { provider: "standalone", allowParticipantDrawing: true });
  }
});

test("a provider meeting binding is accepted for a meeting provider", () => {
  const result = validateSessionStartBody({
    provider: "google_meet",
    providerMeetingId: "spaces/AAAA-bbbb_cc.12",
    title: "Sprint review",
    allowParticipantDrawing: false,
  });
  assert.equal(result.ok, true);
  assert.deepEqual(result.value, {
    provider: "google_meet",
    providerMeetingId: "spaces/AAAA-bbbb_cc.12",
    title: "Sprint review",
    allowParticipantDrawing: false,
  });
});

test("unknown providers are rejected, not stored", () => {
  for (const provider of ["webex", "", 42, {}, "GOOGLE_MEET"]) {
    assert.deepEqual(validateSessionStartBody({ provider }), {
      ok: false,
      error: "UNSUPPORTED_PROVIDER",
    });
  }
});

test("provider meeting IDs are bounded and shaped before persistence", () => {
  const tooLong = "a".repeat(201);
  const rejected = [tooLong, "", "has space", "semi;colon", "new" + TAB + "line", 7, null];
  for (const providerMeetingId of rejected) {
    assert.deepEqual(
      validateSessionStartBody({ provider: "google_meet", providerMeetingId }),
      { ok: false, error: "INVALID_PROVIDER_MEETING_ID" },
      `must reject ${JSON.stringify(providerMeetingId)}`,
    );
  }
  const atLimit = "a".repeat(200);
  assert.equal(
    validateSessionStartBody({ provider: "google_meet", providerMeetingId: atLimit }).ok,
    true,
  );
});

test("a meeting binding without a meeting provider is contradictory", () => {
  assert.deepEqual(validateSessionStartBody({ providerMeetingId: "abc-defg-hij" }), {
    ok: false,
    error: "PROVIDER_MEETING_ID_REQUIRES_PROVIDER",
  });
  assert.deepEqual(
    validateSessionStartBody({ provider: "standalone", providerMeetingId: "abc-defg-hij" }),
    { ok: false, error: "PROVIDER_MEETING_ID_REQUIRES_PROVIDER" },
  );
});

test("titles keep spaces but reject control characters, blanks, and oversize", () => {
  assert.equal(validateSessionStartBody({ title: "Airboard — Q3 planning" }).ok, true);
  const rejected = ["", "   ", "a" + TAB + "b", "a" + NUL + "b", "a" + DEL + "b", "x".repeat(201), 9];
  for (const title of rejected) {
    assert.deepEqual(
      validateSessionStartBody({ title }),
      { ok: false, error: "INVALID_TITLE" },
      `must reject ${JSON.stringify(title)}`,
    );
  }
});

test("non-object bodies and non-boolean drawing flags are rejected", () => {
  assert.deepEqual(validateSessionStartBody([]), { ok: false, error: "INVALID_BODY" });
  assert.deepEqual(validateSessionStartBody("provider=google_meet"), {
    ok: false,
    error: "INVALID_BODY",
  });
  assert.deepEqual(validateSessionStartBody({ allowParticipantDrawing: "yes" }), {
    ok: false,
    error: "INVALID_ALLOW_PARTICIPANT_DRAWING",
  });
});
