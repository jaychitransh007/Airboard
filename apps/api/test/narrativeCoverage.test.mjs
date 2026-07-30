import assert from "node:assert/strict";
import test from "node:test";

import {
  extractNarrativeRelationshipCoverage,
  validateEmptyBoardNarrativeCoverage,
} from "../src/semanticIntent/narrativeCoverage.ts";

const COMPLETE_PLAN = {
  version: "1.1",
  status: "resolved",
  issueCode: "none",
  clarificationQuestion: null,
  missingSlots: [],
  actions: [
    {
      type: "create",
      nodeType: "user",
      label: "User",
      handle: "user",
      placement: { kind: "auto" },
    },
    {
      type: "create",
      nodeType: "service",
      label: "Airboard Authentication Service",
      handle: "auth",
      placement: { kind: "auto" },
    },
    {
      type: "create",
      nodeType: "custom",
      label: "Airboard",
      handle: "airboard",
      placement: { kind: "auto" },
    },
    {
      type: "connect",
      from: { kind: "plan_handle", handle: "user" },
      to: { kind: "plan_handle", handle: "auth" },
      label: "request",
    },
    {
      type: "connect",
      from: { kind: "plan_handle", handle: "auth" },
      to: { kind: "plan_handle", handle: "user" },
      label: "authenticates",
    },
    {
      type: "connect",
      from: { kind: "plan_handle", handle: "user" },
      to: { kind: "plan_handle", handle: "airboard" },
      label: "lands on",
    },
  ],
};

const AUTHENTICATION_TRANSCRIPT =
  "User makes a request to, uh, Airboard authentication service and that, uh, authenticates the user, and the user lands to the Airboard. Create a flow diagram for this.";

test("extracts every explicit relationship in a disfluent authentication narrative", () => {
  assert.deepEqual(
    extractNarrativeRelationshipCoverage(
      AUTHENTICATION_TRANSCRIPT,
    ),
    {
      explicitRelationshipCount: 3,
      cues: [
        { kind: "request", phrase: "makes a request to", offset: 5 },
        { kind: "authenticate", phrase: "authenticates", offset: 75 },
        { kind: "land", phrase: "lands to", offset: 112 },
      ],
    },
  );
});

test("extracts ordered trigger narratives and ignores ordinary creation commands", () => {
  const coverage = extractNarrativeRelationshipCoverage(
    "User makes a request to Airboard, then the authentication service gets fired, then User lands on the Airboard page.",
  );
  assert.deepEqual(
    coverage?.cues.map(({ kind }) => kind),
    ["request", "trigger", "land"],
  );
  assert.equal(
    extractNarrativeRelationshipCoverage("add an authentication service here"),
    null,
  );
});

test("rejects partial empty-board narratives before they can mutate the board", () => {
  const coverage = extractNarrativeRelationshipCoverage(
    AUTHENTICATION_TRANSCRIPT,
  );
  assert.equal(
    validateEmptyBoardNarrativeCoverage(
      AUTHENTICATION_TRANSCRIPT,
      coverage,
      COMPLETE_PLAN,
      { objectCount: 0, edgeCount: 0 },
    ),
    null,
  );

  const partialPlan = {
    ...COMPLETE_PLAN,
    actions: COMPLETE_PLAN.actions.filter(
      (action, index) => action.type !== "connect" || index === 3,
    ),
  };
  assert.deepEqual(
    validateEmptyBoardNarrativeCoverage(
      AUTHENTICATION_TRANSCRIPT,
      coverage,
      partialPlan,
      { objectCount: 0, edgeCount: 0 },
    ),
    { expectedMinimum: 3, actual: 1 },
  );
  assert.equal(
    validateEmptyBoardNarrativeCoverage(
      AUTHENTICATION_TRANSCRIPT,
      coverage,
      partialPlan,
      { objectCount: 1, edgeCount: 0 },
    ),
    null,
    "non-empty boards need full semantic grounding rather than a connector-count shortcut",
  );
});
