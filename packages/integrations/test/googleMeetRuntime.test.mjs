import assert from "node:assert/strict";
import test from "node:test";

import {
  describeGoogleMeetError,
  parseGoogleMeetActivityData,
  serializeGoogleMeetActivityData,
} from "../src/googleMeetRuntime.ts";

test("Google Meet activity data round-trips with a protocol version", () => {
  const encoded = serializeGoogleMeetActivityData({ boardSessionId: "session_abc-123" });
  assert.deepEqual(parseGoogleMeetActivityData(encoded), {
    protocolVersion: 1,
    boardSessionId: "session_abc-123",
  });
});

test("Google Meet activity data rejects malformed and unsafe session IDs", () => {
  assert.throws(() => parseGoogleMeetActivityData(undefined), /missing/);
  assert.throws(() => parseGoogleMeetActivityData("not-json"), /valid JSON/);
  assert.throws(
    () => parseGoogleMeetActivityData('{"protocolVersion":2,"boardSessionId":"session"}'),
    /unsupported/,
  );
  assert.throws(
    () => serializeGoogleMeetActivityData({ boardSessionId: "../../another-tenant" }),
    /Invalid Airboard session ID/,
  );
});

test("Google Meet SDK errors retain their typed reason for diagnostics", () => {
  const error = Object.assign(new Error("Missing Meet URL parameter"), {
    errorType: "MissingUrlParameter",
  });
  assert.equal(
    describeGoogleMeetError(error),
    "MissingUrlParameter: Missing Meet URL parameter",
  );
});

