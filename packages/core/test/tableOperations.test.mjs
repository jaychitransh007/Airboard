import assert from "node:assert/strict";
import test from "node:test";
import {
  assertTableCapacity,
  nextTableCellId,
  parseSpreadsheetText,
  tableDuplicateColumnOperation,
  tableDuplicateRowOperation,
  tableMergeOperation,
  tablePastePatches,
  tableToCsv,
} from "../src/tableOperations.ts";

function table() {
  const rows = [{ id: "r1", height: 44 }, { id: "r2", height: 44 }];
  const columns = [{ id: "c1", width: 120 }, { id: "c2", width: 120 }];
  const cell = (id, rowId, columnId, text) => ({
    id, rowId, columnId,
    content: { type: "doc", blocks: [{ type: "paragraph", runs: [{ text }] }] },
    style: { fill: "#fff", textColor: "#111", horizontalAlign: "left", verticalAlign: "middle" },
  });
  return {
    id: "table", boardId: "board", kind: "table", status: "active",
    transform: { x: 0, y: 0, width: 240, height: 88, rotation: 0, scaleX: 1, scaleY: 1 },
    zIndex: 1, locked: false, visible: true, createdAt: "now", updatedAt: "now", revision: 0,
    rows, columns,
    cells: {
      a: cell("a", "r1", "c1", "Name"), b: cell("b", "r1", "c2", "Note"),
      c: cell("c", "r2", "c1", "Ada"), d: cell("d", "r2", "c2", "Uses, commas"),
    },
    merges: [],
  };
}

function ids() {
  let value = 0;
  return () => `new-${++value}`;
}

test("CSV and spreadsheet paste preserve quoted commas, quotes, and newlines", () => {
  assert.deepEqual(parseSpreadsheetText('A,"B, C"\nD,"E\nF"'), [["A", "B, C"], ["D", "E\nF"]]);
  assert.equal(tableToCsv(table()), 'Name,Note\r\nAda,"Uses, commas"');
  assert.deepEqual(
    tablePastePatches(table(), { row: 0, column: 0 }, "One\tTwo\nThree\tFour")
      .map((patch) => patch.patch.content.blocks[0].runs[0].text),
    ["One", "Two", "Three", "Four"],
  );
});

test("table navigation wraps in row-major order", () => {
  assert.equal(nextTableCellId(table(), "a"), "b");
  assert.equal(nextTableCellId(table(), "d"), "a");
  assert.equal(nextTableCellId(table(), "a", true), "d");
});

test("row and column duplication retain content with fresh identities", () => {
  const row = tableDuplicateRowOperation(table(), "r1", ids());
  assert.equal(row.op, "table.row.inserted");
  assert.deepEqual(row.cells.map((cell) => cell.content.blocks[0].runs[0].text), ["Name", "Note"]);
  assert.equal(new Set(row.cells.map((cell) => cell.id)).size, 2);

  const column = tableDuplicateColumnOperation(table(), "c2", ids());
  assert.equal(column.op, "table.column.inserted");
  assert.deepEqual(column.cells.map((cell) => cell.content.blocks[0].runs[0].text), ["Note", "Uses, commas"]);
});

test("merges must be rectangular and cannot overlap", () => {
  const merge = tableMergeOperation(table(), ["a", "b", "c", "d"], ids());
  assert.equal(merge.op, "table.cells.merged");
  assert.equal(merge.merge.anchorCellId, "a");
  assert.throws(() => tableMergeOperation(table(), ["a", "d"], ids()), /RECTANGULAR/);
  assert.throws(
    () => tableMergeOperation({ ...table(), merges: [merge.merge] }, ["a", "b"], ids()),
    /OVERLAP/,
  );
});

test("tables reject dimensions beyond the 500-cell limit", () => {
  assert.doesNotThrow(() => assertTableCapacity(20, 25));
  assert.throws(() => assertTableCapacity(21, 25), /TABLE_CELL_LIMIT_EXCEEDED/);
});
