import assert from "node:assert/strict";
import test from "node:test";
import { parseBoardSceneIntent } from "../src/sceneIntent.ts";

test("parses deterministic v2 creation intents", () => {
  assert.deepEqual(parseBoardSceneIntent("Airo, add a 4 by 5 table"), {
    type: "create", kind: "table", table: { rows: 4, columns: 5 },
  });
  assert.deepEqual(parseBoardSceneIntent("create a mind map named Launch"), {
    type: "create", kind: "mind_map_node", label: "Launch",
  });
  assert.deepEqual(parseBoardSceneIntent("add a code block in Python"), {
    type: "create", kind: "code_block", language: "python",
  });
  assert.deepEqual(parseBoardSceneIntent("add a right-leaning parallelogram named Input"), {
    type: "create", kind: "shape", shapeKind: "right-parallelogram", label: "Input",
  });
  assert.deepEqual(parseBoardSceneIntent("add a database named Archive right of selected"), {
    type: "create",
    kind: "shape",
    shapeKind: "database",
    label: "Archive",
    placement: { direction: "right", target: "selection" },
  });
  assert.deepEqual(parseBoardSceneIntent("add a process above selected"), {
    type: "create",
    kind: "shape",
    shapeKind: "process",
    label: "Process",
    generatedLabel: true,
    placement: { direction: "up", target: "selection" },
  });
  assert.deepEqual(
    parseBoardSceneIntent("add a database, uh, layer that is connected to service"),
    {
      type: "create_connected",
      shapeKind: "database",
      label: "Database",
      generatedLabel: true,
      to: { kind: "visible_label", label: "service" },
      pathKind: "bent",
    },
  );
  assert.deepEqual(
    parseBoardSceneIntent("add a database named Archive that is connected to Service"),
    {
      type: "create_connected",
      shapeKind: "database",
      label: "Archive",
      to: { kind: "visible_label", label: "Service" },
      pathKind: "bent",
    },
  );
  assert.deepEqual(parseBoardSceneIntent("add a face stamp"), {
    type: "create",
    kind: "stamp",
    stampKind: "face",
  });
});

test("maps legacy shape aliases onto canonical catalog shapes", () => {
  assert.equal(parseBoardSceneIntent("add a circle").shapeKind, "ellipse");
  assert.equal(parseBoardSceneIntent("create a decision").shapeKind, "diamond");
  assert.equal(parseBoardSceneIntent("put a data store").shapeKind, "database");
  assert.equal(parseBoardSceneIntent("make a start end").shapeKind, "terminator");
});

test("enforces the table limit before element creation", () => {
  assert.deepEqual(parseBoardSceneIntent("add a 25 by 21 table"), {
    type: "invalid", reason: "TABLE_CELL_LIMIT_EXCEEDED",
  });
});

test("parses selected-element lifecycle and styling commands", () => {
  assert.deepEqual(parseBoardSceneIntent("rename selected to Checkout API"), {
    type: "rename", target: { kind: "selection" }, label: "Checkout API",
  });
  assert.deepEqual(parseBoardSceneIntent("move selected left 120"), {
    type: "move", target: { kind: "selection" }, dx: -120, dy: 0,
  });
  assert.deepEqual(parseBoardSceneIntent("make selected purple"), {
    type: "style", target: { kind: "selection" }, color: "#8b5cf6",
  });
  assert.deepEqual(parseBoardSceneIntent("make selected taller"), {
    type: "resize",
    target: { kind: "selection" },
    scaleX: 1,
    scaleY: 1.25,
  });
  assert.deepEqual(parseBoardSceneIntent("select everything"), {
    type: "select_all",
  });
  assert.deepEqual(parseBoardSceneIntent("layout selected grid"), {
    type: "layout", target: { kind: "selection" }, direction: "grid",
  });
  assert.deepEqual(
    parseBoardSceneIntent("connect Golden Dataset to Planner as Additional Context"),
    {
      type: "connect",
      from: { kind: "visible_label", label: "golden dataset" },
      to: { kind: "visible_label", label: "planner" },
      pathKind: "bent",
      label: "Additional Context",
    },
  );
  assert.equal(
    parseBoardSceneIntent("Connect existing disconnected line to Client and Planner."),
    null,
  );
});

test("places new elements beside a named element instead of folding the phrase into the label", () => {
  assert.deepEqual(parseBoardSceneIntent("add an API to the right of the user"), {
    type: "create",
    kind: "shape",
    shapeKind: "api",
    label: "API",
    generatedLabel: true,
    placement: { direction: "right", target: "visible_label", label: "user" },
  });
  assert.deepEqual(parseBoardSceneIntent("add a service called Checkout to the left of Orders"), {
    type: "create",
    kind: "shape",
    shapeKind: "service",
    label: "Checkout",
    placement: { direction: "left", target: "visible_label", label: "Orders" },
  });
  assert.deepEqual(parseBoardSceneIntent("Airo, add a database below the API.").placement, {
    direction: "down",
    target: "visible_label",
    label: "API",
  });
  assert.deepEqual(parseBoardSceneIntent("add a queue next to Checkout").placement, {
    direction: "right",
    target: "visible_label",
    label: "Checkout",
  });
  assert.deepEqual(parseBoardSceneIntent("add a message queue on the left side of API").placement, {
    direction: "left",
    target: "visible_label",
    label: "API",
  });
  assert.deepEqual(parseBoardSceneIntent("add a sticky note above it"), {
    type: "create",
    kind: "sticky",
    placement: { direction: "up", target: "selection" },
  });
  assert.deepEqual(parseBoardSceneIntent("add a 4 by 5 table below API"), {
    type: "create",
    kind: "table",
    table: { rows: 4, columns: 5 },
    placement: { direction: "down", target: "visible_label", label: "API" },
  });
});

test("the last placement phrase wins so labels can contain placement words", () => {
  const intent = parseBoardSceneIntent("add a box called Look below the fold next to API");
  assert.equal(intent.label, "Look below the fold");
  assert.deepEqual(intent.placement, { direction: "right", target: "visible_label", label: "API" });
  // A long tail reads as part of a label, not a reference to one element.
  assert.equal(
    parseBoardSceneIntent("add a sticky note called Ship below the line we agreed on in the last planning meeting").placement,
    undefined,
  );
  // Placement phrases belong to creation only.
  assert.equal(parseBoardSceneIntent("connect user to API").type, "connect");
});

test("names system shapes created by command and leaves plain geometry unlabeled", () => {
  assert.equal(parseBoardSceneIntent("add a user").label, "User");
  assert.equal(parseBoardSceneIntent("add a user").generatedLabel, true);
  assert.equal(parseBoardSceneIntent("add a db").label, "Database");
  assert.equal(parseBoardSceneIntent("add a gateway").label, "Gateway");
  assert.equal(parseBoardSceneIntent("add a decision").label, "Decision");
  assert.equal(parseBoardSceneIntent("add a circle").label, undefined);
  assert.equal(parseBoardSceneIntent("add a diamond").label, undefined);
  assert.deepEqual(parseBoardSceneIntent("add a user named Alice"), {
    type: "create",
    kind: "shape",
    shapeKind: "user",
    label: "Alice",
  });
});

test("a sentence that only ends in a shape name is left for Airo, not taken as a create (RGB-040)", () => {
  // Found on the live site: this added a "Front End" shape instead of reaching Airo.
  assert.equal(parseBoardSceneIntent("put the user and the API side by side, lined up along the top, and group them as front end"), null);
  assert.equal(parseBoardSceneIntent("make the user and the API line up and group them as front end"), null);
  assert.equal(parseBoardSceneIntent("add the login step to the checkout flow as a new service"), null);
  // A few describing words still make a create.
  for (const [command, shapeKind] of [
    ["add a payment service", "service"],
    ["add an Orders queue here", "queue"],
    ["add a big red database", "database"],
    ["create one process here", "process"],
  ]) {
    const intent = parseBoardSceneIntent(command);
    assert.equal(intent?.type, "create", command);
    assert.equal(intent?.shapeKind, shapeKind, command);
  }
});
