import assert from "node:assert/strict";
import test from "node:test";

import {
  normalizeIntentCanvasText,
  parseIntentCanvasCommand,
} from "../src/features/board/intentCanvasParser.ts";

function parsed(text, options) {
  const result = parseIntentCanvasCommand(text, options);
  assert.equal(result.status, "parsed", result.status === "parsed" ? undefined : result.issue.message);
  return result;
}

test("normalizes speech punctuation and whitespace", () => {
  assert.equal(normalizeIntentCanvasText("  Create   an API—here?!  "), "create an api-here");
});

test("requires prefix activation by default", () => {
  const result = parseIntentCanvasCommand("create a database here");
  assert.equal(result.status, "inactive");
  assert.equal(result.issue.code, "activation_required");
  assert.equal(result.activation.activated, false);
});

test("accepts wake phrase variants and external activation", () => {
  const wakeResult = parsed("Hey Air board, please add an API here.");
  assert.equal(wakeResult.activation.source, "wake_word");
  assert.equal(wakeResult.normalizedText, "add an api here");

  const externalResult = parsed("add an API here", { activationPolicy: "externally_activated" });
  assert.equal(externalResult.activation.source, "external");
  assert.equal(externalResult.activation.explicit, true);

  const airoResult = parsed("Airo, add a circle here");
  assert.deepEqual(airoResult.command, {
    kind: "create_node",
    nodeType: "circle",
    count: 1,
    placement: {
      direction: "here",
      relativeTo: { kind: "pointer" },
    },
  });
});

test("creates typed and labelled nodes at deictic placements", () => {
  const result = parsed("Airboard, create a payment service below this");
  assert.deepEqual(result.command, {
    kind: "create_node",
    nodeType: "service",
    count: 1,
    label: "payment",
    placement: {
      direction: "below",
      relativeTo: { kind: "deictic", pronoun: "this" },
    },
  });
  assert.equal(result.confidence.band, "high");
});

test("uses the shared Airboard capability catalog for Flow terminology", () => {
  const result = parsed("Airboard, create a flow on the left");
  assert.equal(result.command.kind, "create_node");
  if (result.command.kind === "create_node") {
    assert.equal(result.command.nodeType, "process");
  }
});

test("accepts discourse prefixes and condition block terminology", () => {
  const result = parsed("Airo now add a conditional block");
  assert.equal(result.normalizedText, "add a conditional block");
  assert.deepEqual(result.command, {
    kind: "create_node",
    nodeType: "decision",
    count: 1,
    placement: { direction: "here", relativeTo: { kind: "pointer" } },
  });
});

test("preserves explicit label casing and supports counts", () => {
  const result = parsed('Airboard, add three services named "Payments API" on the left');
  assert.equal(result.command.kind, "create_node");
  assert.equal(result.command.count, 3);
  assert.equal(result.command.label, "Payments API");
  assert.deepEqual(result.command.placement, {
    direction: "left",
    relativeTo: { kind: "canvas" },
  });
});

test("defaults an omitted create placement to the pointer and lowers its basis", () => {
  const result = parsed("Airboard create the database");
  assert.equal(result.command.kind, "create_node");
  assert.deepEqual(result.command.placement, {
    direction: "here",
    relativeTo: { kind: "pointer" },
  });
  assert.equal(result.confidence.basis, "defaulted_argument");
});

test("connects deictic endpoints with an optional label", () => {
  const result = parsed('Airboard, connect this to that with label "publishes"');
  assert.deepEqual(result.command, {
    kind: "connect",
    from: { kind: "deictic", pronoun: "this" },
    to: { kind: "deictic", pronoun: "that" },
    label: "publishes",
  });
});

test("connects named endpoints using to and with separators", () => {
  const userToApi = parsed("connect user with API", {
    activationPolicy: "externally_activated",
  });
  assert.deepEqual(userToApi.command, {
    kind: "connect",
    from: { kind: "named", label: "user", normalizedLabel: "user" },
    to: { kind: "named", label: "API", normalizedLabel: "api" },
  });

  const databaseToPaymentShare = parsed("connect database to payment share", {
    activationPolicy: "externally_activated",
  });
  assert.deepEqual(databaseToPaymentShare.command, {
    kind: "connect",
    from: { kind: "named", label: "database", normalizedLabel: "database" },
    to: { kind: "named", label: "payment share", normalizedLabel: "payment share" },
  });
});

test("connects named endpoints using and while preserving safe lookup text", () => {
  const result = parsed("Airboard, connect Orders API and Payment Share");
  assert.deepEqual(result.command, {
    kind: "connect",
    from: { kind: "named", label: "Orders API", normalizedLabel: "orders api" },
    to: { kind: "named", label: "Payment Share", normalizedLabel: "payment share" },
  });
  assert.equal(result.confidence.basis, "normalized_alias");
});

test("supports connector labels after named endpoints", () => {
  const asLabel = parsed("Airboard, connect user to API as writes");
  assert.deepEqual(asLabel.command, {
    kind: "connect",
    from: { kind: "named", label: "user", normalizedLabel: "user" },
    to: { kind: "named", label: "API", normalizedLabel: "api" },
    label: "writes",
  });

  const withLabel = parsed("Airboard, connect database and payment share with label replicates to");
  assert.deepEqual(withLabel.command, {
    kind: "connect",
    from: { kind: "named", label: "database", normalizedLabel: "database" },
    to: { kind: "named", label: "payment share", normalizedLabel: "payment share" },
    label: "replicates to",
  });
});

test("supports mixed deictic and named connection references", () => {
  assert.deepEqual(parsed("Airboard, connect this to Orders API").command, {
    kind: "connect",
    from: { kind: "deictic", pronoun: "this" },
    to: { kind: "named", label: "Orders API", normalizedLabel: "orders api" },
  });
});

test("does not guess missing or identical connection endpoints", () => {
  const missing = parseIntentCanvasCommand("Airboard, connect this");
  assert.equal(missing.status, "clarification");
  assert.equal(missing.issue.code, "missing_connection_endpoint");

  const identical = parseIntentCanvasCommand("Airboard, connect this to this");
  assert.equal(identical.status, "clarification");
  assert.equal(identical.issue.code, "same_connection_endpoint");

  const identicalNamed = parseIntentCanvasCommand("Airboard, connect the User to user");
  assert.equal(identicalNamed.status, "clarification");
  assert.equal(identicalNamed.issue.code, "same_connection_endpoint");

  const missingLabel = parseIntentCanvasCommand("Airboard, connect user to API with label");
  assert.equal(missingLabel.status, "clarification");
  assert.equal(missingLabel.issue.code, "invalid_connection_label");
});

test("parses rename, delete, duplicate, and move selection operations", () => {
  assert.deepEqual(parsed("Airboard, rename selected to Orders API").command, {
    kind: "rename_selection",
    label: "Orders API",
  });
  assert.deepEqual(parsed("Airboard, delete the selected object").command, {
    kind: "delete_selection",
  });
  assert.deepEqual(parsed("Airboard, copy selection").command, {
    kind: "duplicate_selection",
  });
  assert.deepEqual(parsed("Airboard, move selected down").command, {
    kind: "move_selection",
    direction: "below",
  });
});

test("parses a named-object rename without requiring prior selection", () => {
  assert.deepEqual(parsed("Airo, change the name of circle to user").command, {
    kind: "rename_object",
    target: { kind: "named", label: "circle", normalizedLabel: "circle" },
    label: "user",
  });
});

test("parses alignment, distribution, and layout operations", () => {
  assert.deepEqual(parsed("Airboard, align selected horizontally").command, {
    kind: "align_selection",
    alignment: { axis: "y", anchor: "center" },
  });
  assert.deepEqual(parsed("Airboard, distribute the selection vertically").command, {
    kind: "distribute_selection",
    axis: "y",
  });
  assert.deepEqual(parsed("Airboard, lay out selected left to right").command, {
    kind: "layout_selection",
    direction: "left_to_right",
  });
  assert.deepEqual(parsed("Airboard, arrange the selection in a grid").command, {
    kind: "layout_selection",
    direction: "grid",
  });
});

test("requests an axis for ambiguous center alignment", () => {
  const result = parseIntentCanvasCommand("Airboard, align selected center");
  assert.equal(result.status, "clarification");
  assert.equal(result.issue.code, "ambiguous_alignment");
});

test("parses undo and cancel but refuses compound mutations", () => {
  assert.deepEqual(parsed("Airboard, undo the last change").command, { kind: "undo" });
  assert.deepEqual(parsed("Airboard, never mind").command, { kind: "cancel" });

  const compound = parseIntentCanvasCommand("Airboard, add a service here and connect this to that");
  assert.equal(compound.status, "clarification");
  assert.equal(compound.issue.code, "compound_command");

  const branch = parseIntentCanvasCommand(
    "Airo connect the decision to user one and user two with yes and no",
  );
  assert.equal(branch.status, "clarification");
  assert.equal(branch.issue.code, "compound_command");
});

test("returns actionable messages for incomplete and unknown commands", () => {
  const missingType = parseIntentCanvasCommand("Airboard, create something here");
  assert.equal(missingType.status, "clarification");
  assert.equal(missingType.issue.code, "missing_node_type");
  assert.ok(missingType.issue.examples.length > 0);

  const unknown = parseIntentCanvasCommand("Airboard, make it better");
  assert.equal(unknown.status, "clarification");
  assert.equal(unknown.issue.code, "missing_node_type");
});

test("never guesses a label from a subordinate clause", () => {
  // "make a note that <clause>" is meeting-style dictation; guessing the
  // clause as a label would let ambient speech mutate the board through an
  // open push-to-talk gate.
  const clause = parseIntentCanvasCommand("make a note that we owe legal a response by Friday", {
    activationPolicy: "externally_activated",
  });
  assert.equal(clause.status, "clarification");
  assert.equal(clause.issue.code, "missing_label");

  const about = parseIntentCanvasCommand("add a note about the churn numbers", {
    activationPolicy: "externally_activated",
  });
  assert.equal(about.status, "clarification");
  assert.equal(about.issue.code, "missing_label");

  // Explicit labels remain untouched, including clause-like text.
  const explicit = parsed("add a note named that one weird bug", {
    activationPolicy: "externally_activated",
  });
  assert.equal(explicit.command.kind, "create_node");
  assert.equal(explicit.command.label, "that one weird bug");

  // Ordinary modifier labels still infer.
  const modifier = parsed("add a payment service here", {
    activationPolicy: "externally_activated",
  });
  assert.equal(modifier.command.kind, "create_node");
  assert.equal(modifier.command.label, "payment");
});

test("strips spoken disfluencies before parsing", () => {
  const uh = parsed("Uh, add a circle.", { activationPolicy: "externally_activated" });
  assert.equal(uh.command.kind, "create_node");
  assert.equal(uh.command.nodeType, "circle");

  const stacked = parsed("Okay, so, uh, connect this to that", {
    activationPolicy: "externally_activated",
  });
  assert.equal(stacked.command.kind, "connect");

  const courtesyComma = parsed("Okay, add a user here", {
    activationPolicy: "externally_activated",
  });
  assert.equal(courtesyComma.command.kind, "create_node");

  // Fillers are prefix-only: they never eat words inside a label.
  const label = parsed("add a service named So Fresh", {
    activationPolicy: "externally_activated",
  });
  assert.equal(label.command.label, "So Fresh");

  // A bare filler is still an empty command, not a guess.
  const bare = parseIntentCanvasCommand("uh", { activationPolicy: "externally_activated" });
  assert.equal(bare.status, "clarification");
  assert.equal(bare.issue.code, "empty_command");
});
