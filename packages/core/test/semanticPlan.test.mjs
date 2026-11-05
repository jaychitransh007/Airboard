import assert from "node:assert/strict";
import { test } from "node:test";

import {
  AIRBOARD_SEMANTIC_CAPABILITY_REGISTRY,
  AIRBOARD_SEMANTIC_CAPABILITY_REGISTRY_VERSION,
  AIRBOARD_SEMANTIC_NODE_CAPABILITIES,
  AIRBOARD_SEMANTIC_PLAN_CONTRACT_VERSION,
  AIRBOARD_SEMANTIC_PLAN_JSON_SCHEMA,
  AIRBOARD_SEMANTIC_PLAN_TOOL,
  AIRBOARD_SEMANTIC_PLAN_TOOL_NAME,
  AIRBOARD_SEMANTIC_TRANSCRIPTION_KEYTERMS,
  parseSemanticPlan,
} from "../dist/index.js";

const ref = (label) => ({ kind: "visible_label", label, occurrence: null });
const resolved = (actions) => ({
  version: AIRBOARD_SEMANTIC_PLAN_CONTRACT_VERSION,
  status: "resolved",
  issueCode: "none",
  clarificationQuestion: null,
  missingSlots: [],
  actions,
});

test("capability registry is a versioned source for palette, aliases, and transcription terms", () => {
  assert.equal(AIRBOARD_SEMANTIC_CAPABILITY_REGISTRY.version, "2.0");
  assert.equal(
    AIRBOARD_SEMANTIC_CAPABILITY_REGISTRY.version,
    AIRBOARD_SEMANTIC_CAPABILITY_REGISTRY_VERSION,
  );

  const decision = AIRBOARD_SEMANTIC_NODE_CAPABILITIES.find(
    ({ nodeType }) => nodeType === "decision",
  );
  assert.ok(decision);
  assert.equal(decision.title, "Decision");
  assert.equal(decision.defaultLabel, "Decision");
  assert.equal(decision.palette.title, "Decision");
  assert.equal(decision.visual.kind, "decision");
  assert.deepEqual(decision.visual.defaultSize, { width: 120, height: 88 });
  assert.ok(decision.terms.includes("condition block"));
  assert.ok(decision.terms.includes("conditional block"));
  assert.ok(AIRBOARD_SEMANTIC_TRANSCRIPTION_KEYTERMS.includes("condition block"));
  assert.ok(AIRBOARD_SEMANTIC_TRANSCRIPTION_KEYTERMS.includes("rename"));
  assert.equal(
    AIRBOARD_SEMANTIC_TRANSCRIPTION_KEYTERMS.length,
    new Set(AIRBOARD_SEMANTIC_TRANSCRIPTION_KEYTERMS).size,
  );
  assert.equal(
    AIRBOARD_SEMANTIC_NODE_CAPABILITIES.every(
      ({ visual }) => visual.defaultSize.width > 0 && visual.defaultSize.height > 0,
    ),
    true,
  );
});

test("exports a strict Responses API function-tool schema", () => {
  assert.equal(AIRBOARD_SEMANTIC_PLAN_TOOL_NAME, "propose_diagram_plan");
  assert.equal(AIRBOARD_SEMANTIC_PLAN_TOOL.type, "function");
  assert.equal(AIRBOARD_SEMANTIC_PLAN_TOOL.name, AIRBOARD_SEMANTIC_PLAN_TOOL_NAME);
  assert.equal(AIRBOARD_SEMANTIC_PLAN_TOOL.strict, true);
  assert.equal(AIRBOARD_SEMANTIC_PLAN_TOOL.parameters, AIRBOARD_SEMANTIC_PLAN_JSON_SCHEMA);

  const visit = (value) => {
    if (!value || typeof value !== "object") return;
    if (value.type === "object") {
      assert.equal(value.additionalProperties, false);
      assert.deepEqual([...value.required].sort(), Object.keys(value.properties).sort());
    }
    for (const nested of Object.values(value)) visit(nested);
  };
  visit(AIRBOARD_SEMANTIC_PLAN_JSON_SCHEMA);
});

test("parses creates, same-plan handles, and labelled branches", () => {
  const result = parseSemanticPlan(
    resolved([
      {
        type: "create",
        nodeType: "decision",
        label: "Approved?",
        handle: "decision",
        placement: { kind: "canvas_region", region: "center" },
      },
      {
        type: "create",
        nodeType: "user",
        label: "User One",
        handle: "user_one",
        placement: {
          kind: "relative",
          anchor: { kind: "plan_handle", handle: "decision" },
          direction: "right",
        },
      },
      {
        type: "create",
        nodeType: "user",
        label: "User Two",
        handle: "user_two",
        placement: { kind: "canvas_region", region: "bottom" },
      },
      {
        type: "branch",
        from: { kind: "plan_handle", handle: "decision" },
        branches: [
          { to: { kind: "plan_handle", handle: "user_one" }, label: "yes" },
          { to: { kind: "plan_handle", handle: "user_two" }, label: "no" },
        ],
      },
    ]),
  );

  assert.equal(result.ok, true);
  assert.equal(result.value.actions[3].type, "branch");
  assert.equal(result.value.actions[3].branches[1].label, "no");
});

test("accepts every supported typed action variant", () => {
  const actionPlans = [
    { type: "connect", from: ref("API"), to: ref("Database"), label: "writes" },
    {
      type: "reverse_connection",
      connection: {
        kind: "connection",
        from: ref("User One"),
        to: ref("User Two"),
        label: null,
        occurrence: null,
      },
      label: "calls",
    },
    {
      type: "delete_connection",
      connection: {
        kind: "connection",
        from: ref("API"),
        to: ref("Database"),
        label: "writes",
        occurrence: 1,
      },
    },
    { type: "rename", target: ref("Circle"), label: "User" },
    { type: "delete", targets: [{ kind: "current_selection" }] },
    { type: "duplicate", targets: [ref("API")], placement: { kind: "auto" } },
    {
      type: "move",
      targets: [{ kind: "type_ordinal", nodeType: "user", ordinal: 2 }],
      placement: { kind: "offset", direction: "right", distance: "medium" },
    },
    { type: "align", targets: [ref("A"), ref("B")], alignment: "top" },
    { type: "distribute", targets: [ref("A"), ref("B"), ref("C")], axis: "horizontal" },
    { type: "layout", targets: [ref("A"), ref("B")], direction: "left_to_right" },
    { type: "group", targets: [ref("API")], label: "Backend", handle: "backend" },
    { type: "select", targets: [ref("API")], mode: "replace" },
    { type: "undo" },
    { type: "cancel" },
  ];

  for (const action of actionPlans) {
    const result = parseSemanticPlan(resolved([action]));
    assert.equal(result.ok, true, action.type);
  }
});

test("accepts clarification and unsupported outcomes without executable actions", () => {
  assert.deepEqual(
    parseSemanticPlan({
      version: "1.1",
      status: "clarification",
      issueCode: "incomplete_request",
      clarificationQuestion: "What label should the second branch have?",
      missingSlots: ["branch_label"],
      actions: [],
    }).ok,
    true,
  );
  assert.deepEqual(
    parseSemanticPlan({
      version: "1.1",
      status: "unsupported",
      issueCode: "not_board_command",
      clarificationQuestion: null,
      missingSlots: [],
      actions: [],
    }).ok,
    true,
  );
});

test("rejects malformed, oversized, control-character, and undocumented model output", () => {
  assert.equal(parseSemanticPlan("not json").ok, false);
  assert.equal(parseSemanticPlan("x".repeat(65_537)).ok, false);

  const withRawId = resolved([
    {
      type: "rename",
      target: { kind: "visible_label", label: "Circle", occurrence: null, id: "stroke-1" },
      label: "User",
    },
  ]);
  assert.equal(parseSemanticPlan(withRawId).ok, false);
  assert.equal(
    parseSemanticPlan(resolved([{ type: "rename", target: ref("Circle"), label: "Bad\nLabel" }])).ok,
    false,
  );
});

test("rejects invalid variants for every reference kind", () => {
  const invalidReferences = [
    { kind: "current_selection", unexpected: true },
    { kind: "pointer", unexpected: true },
    {
      kind: "visible_label",
      label: "API",
      occurrence: null,
      unexpected: true,
    },
    {
      kind: "type_ordinal",
      nodeType: "service",
      ordinal: 1,
      unexpected: true,
    },
    { kind: "plan_handle", handle: "created", unexpected: true },
  ];
  const observedKinds = new Set();
  for (const target of invalidReferences) {
    observedKinds.add(target.kind);
    assert.equal(
      parseSemanticPlan(
        resolved([{ type: "rename", target, label: "Renamed" }]),
      ).ok,
      false,
      target.kind,
    );
  }
  observedKinds.add("connection");
  assert.equal(
    parseSemanticPlan(
      resolved([
        {
          type: "delete_connection",
          connection: {
            kind: "connection",
            from: ref("API"),
            to: ref("Database"),
            label: null,
            occurrence: null,
            unexpected: true,
          },
        },
      ]),
    ).ok,
    false,
  );
  assert.deepEqual([...observedKinds].sort(), [
    "connection",
    "current_selection",
    "plan_handle",
    "pointer",
    "type_ordinal",
    "visible_label",
  ]);
});

test("enforces resolution and clarification consistency", () => {
  assert.equal(parseSemanticPlan(resolved([])).ok, false);
  assert.equal(
    parseSemanticPlan({
      version: "1.1",
      status: "clarification",
      issueCode: "missing_target",
      clarificationQuestion: null,
      missingSlots: ["target"],
      actions: [],
    }).ok,
    false,
  );
  assert.equal(
    parseSemanticPlan({
      version: "1.1",
      status: "clarification",
      issueCode: "missing_target",
      clarificationQuestion: "Which target?",
      missingSlots: [],
      actions: [],
    }).ok,
    false,
  );
  assert.equal(
    parseSemanticPlan({
      version: "1.1",
      status: "unsupported",
      issueCode: "unsupported_operation",
      clarificationQuestion: null,
      missingSlots: [],
      actions: [{ type: "cancel" }],
    }).ok,
    false,
  );
  assert.equal(
    parseSemanticPlan({ ...resolved([{ type: "undo" }]), issueCode: "missing_context" }).ok,
    false,
  );
});

test("requires unique, backward-only plan handles and standalone undo/cancel", () => {
  assert.equal(
    parseSemanticPlan(
      resolved([
        {
          type: "connect",
          from: { kind: "plan_handle", handle: "later" },
          to: ref("API"),
          label: null,
        },
        {
          type: "create",
          nodeType: "user",
          label: null,
          handle: "later",
          placement: { kind: "auto" },
        },
      ]),
    ).ok,
    false,
  );
  assert.equal(
    parseSemanticPlan(
      resolved([
        { type: "create", nodeType: "user", label: null, handle: "same", placement: { kind: "auto" } },
        { type: "group", targets: [ref("API")], label: null, handle: "same" },
      ]),
    ).ok,
    false,
  );
  assert.equal(
    parseSemanticPlan(resolved([{ type: "undo" }, { type: "delete", targets: [ref("API")] }])).ok,
    false,
  );
});
