import assert from "node:assert/strict";
import test from "node:test";
import {
  applyBoardElementPatches,
  createBoardSceneElement,
  createDefaultTableData,
  invertBoardElementPatches,
} from "../src/sceneElements.ts";

const stable = (element) => {
  const copy = structuredClone(element);
  delete copy.updatedAt;
  delete copy.revision;
  return copy;
};

test("field and independent style patches generate exact inverse operations", () => {
  const original = createBoardSceneElement({
    id: "shape", boardId: "board", kind: "shape",
    transform: { x: 10, y: 20, width: 120, height: 80, rotation: 0 },
  });
  const patches = [
    { op: "field.set", path: ["transform", "x"], value: 90 },
    { op: "field.set", path: ["style", "fill"], value: "#ef4444" },
    { op: "field.set", path: ["metadata", "owner"], value: "Ada" },
  ];
  const inverse = invertBoardElementPatches(original, patches);
  const changed = applyBoardElementPatches(original, patches, "later");
  const restored = applyBoardElementPatches(changed, inverse, "undo");
  assert.deepEqual(stable(restored), stable(original));
});

test("table structure, cell content, and merges invert without replacing unrelated cells", () => {
  const data = createDefaultTableData("table", 2, 2);
  const original = createBoardSceneElement({ id: "table", boardId: "board", kind: "table", ...data });
  const cells = Object.values(original.cells);
  const row = { id: "row-new", height: 60 };
  const rowCells = original.columns.map((column, index) => ({
    ...cells[0], id: `new-${index}`, rowId: row.id, columnId: column.id,
  }));
  const patches = [
    { op: "table.cell.patched", cellId: cells[0].id, patch: { style: { ...cells[0].style, fill: "#fde68a" } } },
    { op: "table.row.inserted", index: 1, row, cells: rowCells },
    { op: "table.cells.merged", merge: { id: "merge", cellIds: [cells[0].id, cells[1].id], anchorCellId: cells[0].id } },
  ];
  const inverse = invertBoardElementPatches(original, patches);
  const changed = applyBoardElementPatches(original, patches, "later");
  const restored = applyBoardElementPatches(changed, inverse, "undo");
  assert.deepEqual(stable(restored), stable(original));
});
