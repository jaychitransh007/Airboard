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

test("the current selection alone satisfies multi-object actions", () => {
  const selection = [{ kind: "current_selection" }];
  for (const action of [
    { type: "align", targets: selection, alignment: "left" },
    { type: "distribute", targets: selection, axis: "horizontal" },
    { type: "layout", targets: selection, direction: "grid" },
  ]) {
    assert.equal(parseSemanticPlan(resolved([action])).ok, true, action.type);
  }
  // A single named object is still too few.
  assert.equal(
    parseSemanticPlan(resolved([{ type: "align", targets: [ref("A")], alignment: "left" }])).ok,
    false,
  );
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

test("the tool schema asks for as many targets as the validator needs (RGB-041)", () => {
  // The model may only write what the validator accepts; a refused step
  // throws away the whole plan, as spreading out two shapes once did.
  const steps = {
    align: (targets) => ({ type: "align", targets, alignment: "top" }),
    distribute: (targets) => ({ type: "distribute", targets, axis: "horizontal" }),
    layout: (targets) => ({ type: "layout", targets, direction: "left_to_right" }),
  };
  const schemaFor = (type) =>
    AIRBOARD_SEMANTIC_PLAN_JSON_SCHEMA.$defs.action.anyOf.find((variant) => variant.properties.type.enum[0] === type)
      .properties.targets;
  for (const [type, step] of Object.entries(steps)) {
    const [selectionOnly, named] = schemaFor(type).anyOf;
    assert.deepEqual(selectionOnly.items.properties.kind.enum, ["current_selection"], type);
    assert.equal(selectionOnly.maxItems, 1, type);
    for (let count = 1; count <= 3; count += 1) {
      const targets = ["A", "B", "C"].slice(0, count).map(ref);
      assert.equal(parseSemanticPlan(resolved([step(targets)])).ok, count >= named.minItems, `${type} with ${count}`);
    }
    assert.equal(parseSemanticPlan(resolved([step([{ kind: "current_selection" }])])).ok, true, `${type} on the selection`);
  }
  assert.equal(schemaFor("distribute").anyOf[1].minItems, 3);
});

test("plans hold a two-minute narration and the new edit actions", async () => {
  const core = await import("../dist/index.js");
  assert.equal(core.AIRBOARD_SEMANTIC_PLAN_MAX_ACTIONS, 40);
  assert.equal(core.AIRBOARD_SEMANTIC_PLAN_MAX_DIAGRAM_COMMANDS, 150);
  const creates = Array.from({ length: 40 }, (_, index) => ({
    type: "create", nodeType: "process", shape: null, label: `Step ${index + 1}`, handle: `s${index}`, placement: { kind: "auto" },
  }));
  assert.equal(parseSemanticPlan(resolved(creates)).ok, true);
  assert.equal(parseSemanticPlan(resolved([...creates, { ...creates[0], handle: "extra" }])).ok, false);

  const connection = { kind: "connection", from: ref("User"), to: ref("API"), label: null, occurrence: null };
  const plan = resolved([
    { type: "create", nodeType: "database", shape: "horizontal-cylinder", label: "Cache", handle: "cache", placement: { kind: "auto" } },
    { type: "create", nodeType: "service", label: "Legacy plan without a shape", handle: "legacy", placement: { kind: "auto" } },
    { type: "change_type", targets: [ref("Review")], nodeType: "decision", shape: null },
    { type: "change_type", targets: [{ kind: "plan_handle", handle: "cache" }], nodeType: "custom", shape: "cloud" },
    { type: "resize", targets: [ref("API")], change: "bigger" },
    { type: "label_connection", connection, label: "login" },
    { type: "style_connection", connection, lineStyle: "dashed" },
    { type: "layout", targets: [ref("API"), ref("Auth"), ref("Billing")], direction: "radial" },
    { type: "layout", targets: [{ kind: "current_selection" }], direction: "tree" },
  ]);
  const parsed = parseSemanticPlan(plan);
  assert.equal(parsed.ok, true, JSON.stringify(parsed));

  const bad = [
    { type: "create", nodeType: "database", shape: "teapot", label: null, handle: "x", placement: { kind: "auto" } },
    { type: "change_type", targets: [ref("A")], nodeType: "decision" },
    { type: "resize", targets: [ref("A")], change: "huge" },
    { type: "label_connection", connection, label: "" },
    { type: "style_connection", connection, lineStyle: "wavy" },
    { type: "layout", targets: [ref("A"), ref("B")], direction: "spiral" },
    { type: "change_type", targets: [{ kind: "plan_handle", handle: "later" }], nodeType: "decision", shape: null },
  ];
  for (const action of bad) {
    assert.equal(parseSemanticPlan(resolved([action])).ok, false, JSON.stringify(action));
  }

  const actionSchemas = AIRBOARD_SEMANTIC_PLAN_JSON_SCHEMA.$defs.action.anyOf;
  const createSchema = actionSchemas.find((schema) => schema.properties.type.enum[0] === "create");
  assert.ok(createSchema.required.includes("shape"), "strict mode needs every property required");
  assert.ok(createSchema.properties.shape.anyOf[0].enum.includes("cloud"));
  for (const type of ["change_type", "resize", "label_connection", "style_connection"]) {
    const schema = actionSchemas.find((candidate) => candidate.properties.type.enum[0] === type);
    assert.ok(schema, `${type} has a tool schema`);
    assert.deepEqual([...schema.required].sort(), Object.keys(schema.properties).sort());
  }
});

test("a spoken name suggests a node type and catalogue shape", async () => {
  const { inferSemanticNodeForLabel } = await import("../dist/index.js");
  assert.deepEqual(inferSemanticNodeForLabel("Orders Cache"), { nodeType: "database", shape: "horizontal-cylinder" });
  assert.deepEqual(inferSemanticNodeForLabel("Load Balancer"), { nodeType: "service", shape: "hexagon" });
  assert.deepEqual(inferSemanticNodeForLabel("CDN"), { nodeType: "custom", shape: "cloud" });
  assert.deepEqual(inferSemanticNodeForLabel("Payments Service"), { nodeType: "service", shape: null });
  assert.deepEqual(inferSemanticNodeForLabel("User Database"), { nodeType: "database", shape: null });
  assert.deepEqual(inferSemanticNodeForLabel("Quarterly Plan"), { nodeType: "custom", shape: null });
});
