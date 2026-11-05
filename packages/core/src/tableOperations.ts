import type {
  BoardElementPatchOperation,
  RichTextDocument,
  TableCell,
  TableCellStyle,
  TableColumn,
  TableElement,
  TableMerge,
  TableRow,
} from "./types.ts";

export const MAX_TABLE_CELLS = 500;

export type TableGridPosition = { row: number; column: number };

const DEFAULT_CELL_STYLE: TableCellStyle = {
  fill: "#ffffff",
  textColor: "#1f2937",
  horizontalAlign: "left",
  verticalAlign: "middle",
};

/** Return a row-major cell matrix, independent of record insertion order. */
export function tableCellMatrix(table: TableElement): Array<Array<TableCell | null>> {
  const byCoordinate = new Map<string, TableCell>();
  for (const cell of Object.values(table.cells)) {
    byCoordinate.set(`${cell.rowId}:${cell.columnId}`, cell);
  }
  return table.rows.map((row) =>
    table.columns.map((column) => byCoordinate.get(`${row.id}:${column.id}`) ?? null),
  );
}

export function tableCellAt(
  table: TableElement,
  position: TableGridPosition,
): TableCell | null {
  if (position.row < 0 || position.column < 0) return null;
  return tableCellMatrix(table)[position.row]?.[position.column] ?? null;
}

export function nextTableCellId(
  table: TableElement,
  currentCellId: string,
  backwards = false,
): string | null {
  const cells = tableCellMatrix(table).flat().filter((cell): cell is TableCell => Boolean(cell));
  const index = cells.findIndex(({ id }) => id === currentCellId);
  if (index < 0 || cells.length === 0) return cells[0]?.id ?? null;
  const offset = backwards ? -1 : 1;
  return cells[(index + offset + cells.length) % cells.length]?.id ?? null;
}

/**
 * Parse clipboard data from spreadsheets and CSV files. Tabs take precedence;
 * otherwise RFC-4180 quoting (including embedded newlines) is supported.
 */
export function parseSpreadsheetText(input: string): string[][] {
  const normalized = input.replace(/\r\n?/g, "\n");
  if (normalized.includes("\t")) {
    return normalized.replace(/\n$/, "").split("\n").map((row) => row.split("\t"));
  }
  return parseCsv(normalized);
}

export function tablePastePatches(
  table: TableElement,
  start: TableGridPosition,
  clipboard: string,
): BoardElementPatchOperation[] {
  const grid = parseSpreadsheetText(clipboard);
  const patches: BoardElementPatchOperation[] = [];
  for (let rowOffset = 0; rowOffset < grid.length; rowOffset += 1) {
    for (let columnOffset = 0; columnOffset < (grid[rowOffset]?.length ?? 0); columnOffset += 1) {
      const cell = tableCellAt(table, {
        row: start.row + rowOffset,
        column: start.column + columnOffset,
      });
      if (!cell) continue;
      patches.push({
        op: "table.cell.patched",
        cellId: cell.id,
        patch: { content: plainRichText(grid[rowOffset]?.[columnOffset] ?? "") },
      });
    }
  }
  return patches;
}

export function tableToCsv(table: TableElement): string {
  return tableCellMatrix(table)
    .map((row) => row.map((cell) => csvEscape(cell ? richTextPlainText(cell.content) : "")).join(","))
    .join("\r\n");
}

export function tableInsertRowOperation(
  table: TableElement,
  index: number,
  id: () => string = () => crypto.randomUUID(),
): BoardElementPatchOperation {
  assertTableCapacity(table.rows.length + 1, table.columns.length);
  const row: TableRow = { id: id(), height: 44 };
  const cells = table.columns.map((column) => newCell(row.id, column.id, id));
  return {
    op: "table.row.inserted",
    index: clampIndex(index, table.rows.length),
    row,
    cells,
  };
}

export function tableDuplicateRowOperation(
  table: TableElement,
  rowId: string,
  id: () => string = () => crypto.randomUUID(),
): BoardElementPatchOperation {
  const sourceIndex = table.rows.findIndex((row) => row.id === rowId);
  if (sourceIndex < 0) throw new Error("TABLE_ROW_NOT_FOUND");
  assertTableCapacity(table.rows.length + 1, table.columns.length);
  const sourceRow = table.rows[sourceIndex]!;
  const row: TableRow = { ...sourceRow, id: id() };
  const sourceByColumn = new Map(
    Object.values(table.cells)
      .filter((cell) => cell.rowId === rowId)
      .map((cell) => [cell.columnId, cell]),
  );
  const cells = table.columns.map((column) => {
    const source = sourceByColumn.get(column.id);
    return source
      ? { ...source, id: id(), rowId: row.id, content: cloneRichText(source.content), style: { ...source.style } }
      : newCell(row.id, column.id, id);
  });
  return { op: "table.row.inserted", index: sourceIndex + 1, row, cells };
}

export function tableInsertColumnOperation(
  table: TableElement,
  index: number,
  id: () => string = () => crypto.randomUUID(),
): BoardElementPatchOperation {
  assertTableCapacity(table.rows.length, table.columns.length + 1);
  const column: TableColumn = { id: id(), width: 160 };
  const cells = table.rows.map((row) => newCell(row.id, column.id, id));
  return {
    op: "table.column.inserted",
    index: clampIndex(index, table.columns.length),
    column,
    cells,
  };
}

export function tableDuplicateColumnOperation(
  table: TableElement,
  columnId: string,
  id: () => string = () => crypto.randomUUID(),
): BoardElementPatchOperation {
  const sourceIndex = table.columns.findIndex((column) => column.id === columnId);
  if (sourceIndex < 0) throw new Error("TABLE_COLUMN_NOT_FOUND");
  assertTableCapacity(table.rows.length, table.columns.length + 1);
  const sourceColumn = table.columns[sourceIndex]!;
  const column: TableColumn = { ...sourceColumn, id: id() };
  const sourceByRow = new Map(
    Object.values(table.cells)
      .filter((cell) => cell.columnId === columnId)
      .map((cell) => [cell.rowId, cell]),
  );
  const cells = table.rows.map((row) => {
    const source = sourceByRow.get(row.id);
    return source
      ? { ...source, id: id(), columnId: column.id, content: cloneRichText(source.content), style: { ...source.style } }
      : newCell(row.id, column.id, id);
  });
  return { op: "table.column.inserted", index: sourceIndex + 1, column, cells };
}

export function tableMergeOperation(
  table: TableElement,
  cellIds: string[],
  id: () => string = () => crypto.randomUUID(),
): BoardElementPatchOperation {
  const uniqueIds = [...new Set(cellIds)];
  if (uniqueIds.length < 2) throw new Error("TABLE_MERGE_REQUIRES_MULTIPLE_CELLS");
  if (table.merges.some((merge) => merge.cellIds.some((cellId) => uniqueIds.includes(cellId)))) {
    throw new Error("TABLE_MERGE_OVERLAP");
  }
  const positions = uniqueIds.map((cellId) => locateCell(table, cellId));
  if (positions.some((position) => !position)) throw new Error("TABLE_CELL_NOT_FOUND");
  const valid = positions as TableGridPosition[];
  const rows = valid.map(({ row }) => row);
  const columns = valid.map(({ column }) => column);
  const minRow = Math.min(...rows);
  const maxRow = Math.max(...rows);
  const minColumn = Math.min(...columns);
  const maxColumn = Math.max(...columns);
  if ((maxRow - minRow + 1) * (maxColumn - minColumn + 1) !== uniqueIds.length) {
    throw new Error("TABLE_MERGE_MUST_BE_RECTANGULAR");
  }
  const expected = new Set<string>();
  for (let row = minRow; row <= maxRow; row += 1) {
    for (let column = minColumn; column <= maxColumn; column += 1) {
      const cell = tableCellAt(table, { row, column });
      if (!cell) throw new Error("TABLE_CELL_NOT_FOUND");
      expected.add(cell.id);
    }
  }
  if (uniqueIds.some((cellId) => !expected.has(cellId))) {
    throw new Error("TABLE_MERGE_MUST_BE_RECTANGULAR");
  }
  const anchor = tableCellAt(table, { row: minRow, column: minColumn });
  if (!anchor) throw new Error("TABLE_CELL_NOT_FOUND");
  const merge: TableMerge = { id: id(), cellIds: [...expected], anchorCellId: anchor.id };
  return { op: "table.cells.merged", merge };
}

export function assertTableCapacity(rows: number, columns: number): void {
  if (!Number.isInteger(rows) || !Number.isInteger(columns) || rows < 1 || columns < 1) {
    throw new Error("INVALID_TABLE_DIMENSIONS");
  }
  if (rows * columns > MAX_TABLE_CELLS) throw new Error("TABLE_CELL_LIMIT_EXCEEDED");
}

export function richTextPlainText(document: RichTextDocument): string {
  return document.blocks.map((block) => block.runs.map((run) => run.text).join("")).join("\n");
}

function locateCell(table: TableElement, cellId: string): TableGridPosition | null {
  const cell = table.cells[cellId];
  if (!cell) return null;
  const row = table.rows.findIndex(({ id }) => id === cell.rowId);
  const column = table.columns.findIndex(({ id }) => id === cell.columnId);
  return row < 0 || column < 0 ? null : { row, column };
}

function newCell(rowId: string, columnId: string, id: () => string): TableCell {
  return {
    id: id(),
    rowId,
    columnId,
    content: plainRichText(""),
    style: { ...DEFAULT_CELL_STYLE },
  };
}

function plainRichText(text: string): RichTextDocument {
  return { type: "doc", blocks: [{ type: "paragraph", runs: [{ text }] }] };
}

function cloneRichText(document: RichTextDocument): RichTextDocument {
  return {
    type: "doc",
    blocks: document.blocks.map((block) => ({
      ...block,
      runs: block.runs.map((run) => ({
        ...run,
        ...(run.marks ? { marks: { ...run.marks } } : {}),
        ...(run.mention ? { mention: { ...run.mention } } : {}),
      })),
    })),
  };
}

function parseCsv(input: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let index = 0; index < input.length; index += 1) {
    const character = input[index]!;
    if (quoted) {
      if (character === '"' && input[index + 1] === '"') {
        field += '"';
        index += 1;
      } else if (character === '"') {
        quoted = false;
      } else {
        field += character;
      }
    } else if (character === '"' && field.length === 0) {
      quoted = true;
    } else if (character === ",") {
      row.push(field);
      field = "";
    } else if (character === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += character;
    }
  }
  row.push(field);
  if (row.length > 1 || row[0] || rows.length === 0) rows.push(row);
  return rows;
}

function csvEscape(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
}

function clampIndex(index: number, length: number): number {
  if (!Number.isFinite(index)) return length;
  return Math.min(length, Math.max(0, Math.trunc(index)));
}
