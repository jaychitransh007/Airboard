import assert from "node:assert/strict";
import test from "node:test";
import { createSceneElementForTool } from "../src/features/board/sceneCreation.ts";

const options = { boardId: "board", creatorId: "user", point: { x: 400, y: 300 } };

test("all v2 creation families construct complete scene elements", () => {
  const expectations = [
    ["sticky", "sticky"],
    ["shape:basic-star", "shape"],
    ["shape:flowchart-document", "shape"],
    ["connector:curved", "connector"],
    ["text", "text"],
    ["section", "section"],
    ["table", "table"],
    ["stamp", "stamp"],
    ["insert:face-stamp", "stamp"],
    ["insert:code-block", "code_block"],
    ["insert:mind-map", "mind_map_node"],
  ];
  for (const [tool, kind] of expectations) {
    const element = createSceneElementForTool(tool, options);
    assert.equal(element.kind, kind, tool);
    assert.equal(element.boardId, "board");
    assert.equal(element.status, "active");
  }
});

test("tables honor requested dimensions and 500-cell validation", () => {
  const table = createSceneElementForTool("table", { ...options, table: { rows: 4, columns: 5 } });
  assert.equal(table.rows.length, 4);
  assert.equal(table.columns.length, 5);
  assert.equal(Object.keys(table.cells).length, 20);
  assert.throws(
    () => createSceneElementForTool("table", { ...options, table: { rows: 25, columns: 21 } }),
    /TABLE_CELL_LIMIT_EXCEEDED/,
  );
});

test("catalog shape aliases resolve to canonical v2 kinds", () => {
  assert.equal(createSceneElementForTool("shape:basic-ellipse", options).shapeKind, "ellipse");
  assert.equal(createSceneElementForTool("shape:advanced-database", options).shapeKind, "database");
  assert.equal(createSceneElementForTool("shape:airboard-queue", options).shapeKind, "queue");
});

test("a hand-placed connector keeps its attached ends", () => {
  const connector = createSceneElementForTool("connector:bent", {
    ...options,
    connector: {
      start: { point: { x: 200, y: 140 }, binding: { elementId: "a", anchor: "auto" }, decoration: "none" },
      end: { point: { x: 500, y: 180 }, binding: { elementId: "b", anchor: "auto" }, decoration: "solid_arrow" },
    },
  });
  assert.equal(connector.kind, "connector");
  assert.equal(connector.pathKind, "bent");
  assert.equal(connector.start.binding?.elementId, "a");
  assert.equal(connector.end.binding?.elementId, "b");
  assert.deepEqual(connector.transform, { x: 200, y: 140, width: 300, height: 40, rotation: 0 });
});
