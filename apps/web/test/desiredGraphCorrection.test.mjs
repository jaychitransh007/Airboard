import assert from "node:assert/strict";
import test from "node:test";

import {
  normalizeSpokenNumberAliases,
  parseDesiredGraphCorrection,
} from "../src/features/board/desiredGraphCorrection.ts";
import { describeSemanticPlan } from "../src/features/board/intentPipeline.ts";

const EXACT_UTTERANCE =
  "diagram connectors from user two to user one. Currently, user one is making the call to user two, but user two should be making the call to user one, and then user two updates the database.";
const FLOWING_REQUEST_UTTERANCE =
  "There are there are two square rectangles for... named as user, user one and user two are there. Currently, request is flowing from user one to user two. It should be reversed. Request should be flowing from user two to user one, and then it updates the database.";

test("REGRESSION: current-state narration becomes the minimum desired graph correction", () => {
  const plan = parseDesiredGraphCorrection(EXACT_UTTERANCE);
  assert.ok(plan);
  assert.equal(plan.status, "resolved");
  assert.deepEqual(plan.actions, [
    {
      type: "reverse_connection",
      connection: {
        kind: "connection",
        from: { kind: "visible_label", label: "User One", occurrence: null },
        to: { kind: "visible_label", label: "User Two", occurrence: null },
        label: null,
        occurrence: null,
      },
      label: "calls",
    },
    {
      type: "connect",
      from: { kind: "visible_label", label: "User Two", occurrence: null },
      to: { kind: "visible_label", label: "Database", occurrence: null },
      label: "updates",
    },
  ]);
  assert.equal(
    describeSemanticPlan(plan.actions),
    "Reverse User One → User Two and add User Two → Database.",
  );
});

test("REGRESSION: disfluent flowing-request narration reverses the edge and continues from its receiver", () => {
  const plan = parseDesiredGraphCorrection(FLOWING_REQUEST_UTTERANCE);
  assert.ok(plan);
  assert.deepEqual(plan.actions, [
    {
      type: "reverse_connection",
      connection: {
        kind: "connection",
        from: { kind: "visible_label", label: "User One", occurrence: null },
        to: { kind: "visible_label", label: "User Two", occurrence: null },
        label: null,
        occurrence: null,
      },
      label: "request",
    },
    {
      type: "connect",
      from: { kind: "visible_label", label: "User One", occurrence: null },
      to: { kind: "visible_label", label: "Database", occurrence: null },
      label: "updates",
    },
  ]);
  assert.equal(
    describeSemanticPlan(plan.actions),
    "Reverse User One → User Two and add User One → Database.",
  );
});

test("spoken and written number labels resolve to the same canonical lookup", () => {
  assert.equal(normalizeSpokenNumberAliases("User Two"), "user 2");
  assert.equal(normalizeSpokenNumberAliases("user 2"), "user 2");
  assert.equal(normalizeSpokenNumberAliases("the second user"), "user 2");
});

test("rejects contradictory current and desired graph narration", () => {
  assert.equal(
    parseDesiredGraphCorrection(
      "Currently User One calls User Two, but User Three should call User One, and then User Three updates Database.",
    ),
    null,
  );
});
