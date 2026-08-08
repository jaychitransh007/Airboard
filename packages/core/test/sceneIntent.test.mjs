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
    placement: { direction: "up", target: "selection" },
  });
  assert.deepEqual(
    parseBoardSceneIntent("add a database, uh, layer that is connected to service"),
    {
      type: "create_connected",
      shapeKind: "database",
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
