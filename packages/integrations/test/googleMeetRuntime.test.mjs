import assert from "node:assert/strict";
import test from "node:test";

import { describeGoogleMeetError } from "../src/googleMeetRuntime.ts";

test("Google Meet SDK errors retain their typed reason for diagnostics", () => {
  const error = Object.assign(new Error("Missing Meet URL parameter"), {
    errorType: "MissingUrlParameter",
  });
  assert.equal(
    describeGoogleMeetError(error),
    "MissingUrlParameter: Missing Meet URL parameter",
  );
});

