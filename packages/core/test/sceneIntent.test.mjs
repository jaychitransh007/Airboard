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
    placement: { direction: "up", target: "contextual", pronoun: "it" },
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

const it_ = { kind: "contextual", pronoun: "it" };
const label = (value) => ({ kind: "visible_label", label: value });

test("gap 5: compound or open-ended sentences go to the AI planner instead of being misapplied", () => {
  for (const command of [
    "Airo, add a database and a cache",
    "create a flowchart for user signup",
    "add a database named Orders and connect it to the API",
    "add three services named Auth, Billing and Search",
    "add three services named Auth, Billing, Search",
    "connect User to API and API to Database",
    "add a database, a cache, and a queue",
    "add two databases",
    "add a user named Alice and Bob",
    "add a sticky called Research and Development",
    "delete the API which talks to billing",
    "make the database that handles orders red",
    "add a database then connect it to the API",
    "add a cache between the API and the database",
    "create a diagram of the checkout",
    "create a mind map for the launch plan",
    "add a database connect it to the API",
    "move the database",
    "add a database to the right",
  ]) {
    assert.equal(parseBoardSceneIntent(command), null, command);
  }
});

test("gap 5: everyday wording that is clean applies the right thing", () => {
  // A describing word names the shape: "Payments Service", in the speaker's casing.
  assert.deepEqual(parseBoardSceneIntent("add a payments service"), {
    type: "create", kind: "shape", shapeKind: "service", label: "Payments Service",
  });
  assert.equal(parseBoardSceneIntent("add an API gateway").label, "API Gateway");
  assert.equal(parseBoardSceneIntent("add an Orders queue").label, "Orders Queue");
  // Words that do not name anything stay out of the label.
  assert.deepEqual(parseBoardSceneIntent("add a big red database"), {
    type: "create", kind: "shape", shapeKind: "database", label: "Database", generatedLabel: true,
  });
  // "the database" names an existing one: move it, never create a second.
  assert.deepEqual(parseBoardSceneIntent("put the database below the API"), {
    type: "move_to",
    target: label("database"),
    destination: { direction: "down", target: "visible_label", label: "API" },
  });
  assert.deepEqual(parseBoardSceneIntent("move the database to the right of the API"), {
    type: "move_to",
    target: label("database"),
    destination: { direction: "right", target: "visible_label", label: "API" },
  });
  // "a database" is a new one.
  assert.equal(parseBoardSceneIntent("put a database below the API").type, "create");
  assert.deepEqual(parseBoardSceneIntent("make it a queue"), {
    type: "change_shape", target: it_, shapeKind: "queue",
  });
  assert.deepEqual(parseBoardSceneIntent("move the database to the right"), {
    type: "move", target: label("database"), dx: 80, dy: 0,
  });
  assert.deepEqual(parseBoardSceneIntent("move it up a bit"), {
    type: "move", target: it_, dx: 0, dy: -40,
  });
});

test("leading and trailing fillers do not change what a command does", () => {
  const plain = parseBoardSceneIntent("add a database");
  for (const command of [
    "please add a database",
    "now add a database",
    "then add a database",
    "next, add a database",
    "okay add a database",
    "ok, add a database",
    "so add a database",
    "and add a database",
    "also add a database",
    "can you add a database",
    "could you please add a database",
    "would you add a database",
    "let's add a database",
    "go ahead and add a database",
    "I want to add a database",
    "I'd like to add a database",
    "add a database please",
    "add a database, thanks",
    "okay so can you please add a database thank you",
    "Airo, please add a database",
    "please, Airo, add a database",
  ]) {
    assert.deepEqual(parseBoardSceneIntent(command), plain, command);
  }
});

test("pronouns are contextual references the UI resolves", () => {
  assert.deepEqual(parseBoardSceneIntent("rename it to Orders"), {
    type: "rename", target: it_, label: "Orders",
  });
  assert.deepEqual(parseBoardSceneIntent("make it blue"), {
    type: "style", target: it_, color: "#3b82f6",
  });
  assert.deepEqual(parseBoardSceneIntent("delete it"), { type: "delete", target: it_ });
  assert.deepEqual(parseBoardSceneIntent("delete that one"), {
    type: "delete", target: { kind: "contextual", pronoun: "that" },
  });
  assert.deepEqual(parseBoardSceneIntent("call it Orders"), {
    type: "rename", target: it_, label: "Orders",
  });
  assert.deepEqual(parseBoardSceneIntent("group them as Front End"), {
    type: "group", target: { kind: "contextual", pronoun: "them" }, label: "Front End",
  });
  // "selected" is still the selection itself.
  assert.deepEqual(parseBoardSceneIntent("delete the selected objects"), {
    type: "delete", target: { kind: "selection" },
  });
});

test("change type and resize read as edits, not creates", () => {
  assert.deepEqual(parseBoardSceneIntent("change it to a queue"), {
    type: "change_shape", target: it_, shapeKind: "queue",
  });
  assert.deepEqual(parseBoardSceneIntent("turn it into a decision"), {
    type: "change_shape", target: it_, shapeKind: "diamond",
  });
  assert.deepEqual(parseBoardSceneIntent("change the API to a queue"), {
    type: "change_shape", target: label("api"), shapeKind: "queue",
  });
  assert.deepEqual(parseBoardSceneIntent("make it bigger"), {
    type: "resize", target: it_, scaleX: 1.25, scaleY: 1.25,
  });
  assert.deepEqual(parseBoardSceneIntent("make it smaller"), {
    type: "resize", target: it_, scaleX: 0.8, scaleY: 0.8,
  });
  assert.deepEqual(parseBoardSceneIntent("make it wider"), {
    type: "resize", target: it_, scaleX: 1.25, scaleY: 1,
  });
  assert.deepEqual(parseBoardSceneIntent("make it taller"), {
    type: "resize", target: it_, scaleX: 1, scaleY: 1.25,
  });
  assert.deepEqual(parseBoardSceneIntent("make the API a bit wider"), {
    type: "resize", target: label("api"), scaleX: 1.1, scaleY: 1,
  });
  // A colour after "change … to" is a style, not a shape.
  assert.equal(parseBoardSceneIntent("change it to blue").type, "style");
});

test("here and this/that keep where the hand points", () => {
  assert.deepEqual(parseBoardSceneIntent("add a database here"), {
    type: "create",
    kind: "shape",
    shapeKind: "database",
    label: "Database",
    generatedLabel: true,
    placement: { target: "pointer" },
  });
  assert.deepEqual(parseBoardSceneIntent("add a database over there").placement, { target: "pointer" });
  assert.deepEqual(parseBoardSceneIntent("connect this to that"), {
    type: "connect",
    from: { kind: "contextual", pronoun: "this" },
    to: { kind: "contextual", pronoun: "that" },
    pathKind: "bent",
  });
  assert.deepEqual(parseBoardSceneIntent("move it here"), {
    type: "move_to", target: it_, destination: { target: "pointer" },
  });
  assert.deepEqual(parseBoardSceneIntent("put the database over there"), {
    type: "move_to", target: label("database"), destination: { target: "pointer" },
  });
  assert.deepEqual(parseBoardSceneIntent("add a queue next to this").placement, {
    direction: "right", target: "contextual", pronoun: "this",
  });
});

test("undo, redo, corrections and view commands", () => {
  // The web app's intent parser already runs these; leave them to it.
  for (const command of ["undo", "undo that", "go back", "please undo", "Airo, undo", "never mind", "cancel"]) {
    assert.equal(parseBoardSceneIntent(command), null, command);
  }
  assert.deepEqual(parseBoardSceneIntent("then undo"), { type: "undo", count: 1 });
  assert.deepEqual(parseBoardSceneIntent("scratch that"), { type: "undo", count: 1 });
  assert.deepEqual(parseBoardSceneIntent("undo twice"), { type: "undo", count: 2 });
  assert.deepEqual(parseBoardSceneIntent("undo three times"), { type: "undo", count: 3 });
  assert.deepEqual(parseBoardSceneIntent("undo the last two changes"), { type: "undo", count: 2 });
  assert.deepEqual(parseBoardSceneIntent("go back twice"), { type: "undo", count: 2 });
  assert.deepEqual(parseBoardSceneIntent("redo"), { type: "redo", count: 1 });
  assert.deepEqual(parseBoardSceneIntent("redo that"), { type: "redo", count: 1 });
  assert.deepEqual(parseBoardSceneIntent("bring it back"), { type: "redo", count: 1 });
  assert.deepEqual(parseBoardSceneIntent("no, I meant a database"), {
    type: "correct", remainder: "a database", intent: null, shapeKind: "database",
  });
  assert.deepEqual(parseBoardSceneIntent("no I meant make it red"), {
    type: "correct",
    remainder: "make it red",
    intent: { type: "style", target: it_, color: "#ef4444" },
  });
  assert.equal(parseBoardSceneIntent("I mean the API is slow"), null);
  assert.equal(parseBoardSceneIntent("no, I meant the database and the cache"), null);
  for (const command of ["zoom to fit", "show everything", "fit the board", "show me everything"]) {
    assert.deepEqual(parseBoardSceneIntent(command), { type: "zoom_to_fit" }, command);
  }
  assert.deepEqual(parseBoardSceneIntent("focus on payments"), { type: "focus", target: label("payments") });
  assert.deepEqual(parseBoardSceneIntent("zoom in on payments"), { type: "focus", target: label("payments") });
  assert.deepEqual(parseBoardSceneIntent("bring it to the front"), { type: "reorder", target: it_, position: "front" });
  assert.deepEqual(parseBoardSceneIntent("send the API to the back"), {
    type: "reorder", target: label("api"), position: "back",
  });
  assert.equal(parseBoardSceneIntent("zoom in"), null);
});

test("narration still does not parse as a command", () => {
  for (const sentence of [
    "so this is where orders come in",
    "then we add the cache",
    "and then the user calls the API",
    "let's move on",
    "let's go back to the agenda",
    "we should add that to the agenda for the next sprint",
    "let's move the deadline to Thursday and see how it goes",
    "we need to focus on payments this quarter",
    "I think the database is the bottleneck",
    "now it is time to talk about billing",
    "the API should be bigger than that",
  ]) {
    assert.equal(parseBoardSceneIntent(sentence), null, sentence);
  }
});
