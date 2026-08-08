"use client";

import {
  tableDuplicateColumnOperation,
  tableDuplicateRowOperation,
  tableInsertColumnOperation,
  tableInsertRowOperation,
  tableMergeOperation,
  tablePastePatches,
  tableToCsv,
  nextTableCellId,
  type BoardElementPatchOperation,
  type BoardJsonValue,
  type BoardSceneElement,
  type CodeLanguage,
  type ConnectorEndpointKind,
  type RichTextDocument,
  type TableElement,
} from "@airboard/core";
import {
  useEffect,
  useMemo,
  useState,
  type ClipboardEvent,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import styles from "./SceneContextToolbar.module.css";
import {
  httpLinkHref,
  normalizeRotation,
  replaceRichTextPlainValue,
  richTextMarkIsActive,
  richTextPlainValue,
  toggleRichTextMark,
  type ToggleableRichTextMark,
} from "./sceneContextToolbarHelpers.ts";

export type SceneContextToolbarProps = {
  selected: BoardSceneElement | null;
  onPatch: (patches: BoardElementPatchOperation[]) => void;
  onDelete: () => void;
  onDuplicate: () => void;
  onCopySectionLink?: (section: Extract<BoardSceneElement, { kind: "section" }>) => void;
  onDeleteSectionWithContents?: (section: Extract<BoardSceneElement, { kind: "section" }>) => void;
  onMediaReplace?: (media: Extract<BoardSceneElement, { kind: "media" }>) => void;
  onMediaPlaybackChange?: (media: Extract<BoardSceneElement, { kind: "media" }>, playing: boolean) => void;
  onWashiPatternReplace?: (drawing: Extract<BoardSceneElement, { kind: "drawing" }>) => void;
  onQuickCreate?: (element: BoardSceneElement, direction: "left" | "right" | "up" | "down") => void;
  onExportCsv?: (csv: string, table: TableElement) => void;
  onMindMapAddChild?: (node: Extract<BoardSceneElement, { kind: "mind_map_node" }>) => void;
  onMindMapAddSibling?: (node: Extract<BoardSceneElement, { kind: "mind_map_node" }>) => void;
  onMindMapAttachSelection?: (node: Extract<BoardSceneElement, { kind: "mind_map_node" }>) => void;
};

const CODE_LANGUAGES: readonly CodeLanguage[] = [
  "cpp",
  "css",
  "go",
  "graphql",
  "html",
  "javascript",
  "json",
  "kotlin",
  "python",
  "react",
  "ruby",
  "rust",
  "sql",
  "swift",
  "typescript",
];

const ENDPOINTS: readonly ConnectorEndpointKind[] = [
  "none",
  "solid_arrow",
  "line_arrow",
  "triangle",
  "diamond",
];

const STAMP_CHOICES = ["👍", "❤️", "🎉", "✅", "⭐", "👀", "🔥", "💡", "🚀", "❓"] as const;

const KIND_LABELS: Record<BoardSceneElement["kind"], string> = {
  drawing: "Drawing",
  sticky: "Sticky note",
  shape: "Shape",
  connector: "Connector",
  text: "Text",
  section: "Section",
  table: "Table",
  stamp: "Stamp",
  media: "Media",
  link_preview: "Link preview",
  code_block: "Code block",
  mind_map_node: "Mind-map node",
};

export function SceneContextToolbar({
  selected,
  onPatch,
  onDelete,
  onDuplicate,
  onCopySectionLink,
  onDeleteSectionWithContents,
  onMediaReplace,
  onMediaPlaybackChange,
  onWashiPatternReplace,
  onQuickCreate,
  onExportCsv,
  onMindMapAddChild,
  onMindMapAddSibling,
  onMindMapAttachSelection,
}: SceneContextToolbarProps) {
  const table = selected?.kind === "table" ? selected : null;
  const [selectedCellIds, setSelectedCellIds] = useState<string[]>([]);
  const [selectedRowId, setSelectedRowId] = useState("");
  const [selectedColumnId, setSelectedColumnId] = useState("");
  const [tableMessage, setTableMessage] = useState("");

  useEffect(() => {
    if (!table) {
      setSelectedCellIds([]);
      setSelectedRowId("");
      setSelectedColumnId("");
      setTableMessage("");
      return;
    }
    const firstCell = Object.values(table.cells)[0];
    setSelectedCellIds(firstCell ? [firstCell.id] : []);
    setSelectedRowId(table.rows[0]?.id ?? "");
    setSelectedColumnId(table.columns[0]?.id ?? "");
    setTableMessage("");
  }, [table?.id]);

  useEffect(() => {
    if (!table) return;
    setSelectedCellIds((current) => {
      const valid = current.filter((id) => Boolean(table.cells[id]));
      if (valid.length > 0) return valid;
      const first = Object.values(table.cells)[0];
      return first ? [first.id] : [];
    });
    setSelectedRowId((current) =>
      table.rows.some((row) => row.id === current) ? current : (table.rows[0]?.id ?? ""),
    );
    setSelectedColumnId((current) =>
      table.columns.some((column) => column.id === current)
        ? current
        : (table.columns[0]?.id ?? ""),
    );
  }, [table?.cells, table?.columns, table?.rows]);

  const selectedCell = table?.cells[selectedCellIds[0] ?? ""];
  const activeMerge = useMemo(
    () => table?.merges.find((merge) => merge.cellIds.some((id) => selectedCellIds.includes(id))),
    [selectedCellIds, table],
  );

  if (!selected || selected.status !== "active") return null;

  const patch = (...patches: BoardElementPatchOperation[]) => onPatch(patches);
  const setField = (path: [string, ...(string | number)[]], value: unknown) => {
    patch({
      op: "field.set",
      path,
      value: value as BoardJsonValue,
    });
  };
  const setDocument = (path: [string, ...(string | number)[]], document: RichTextDocument) =>
    setField(path, document);
  const proportionalResize = selected.metadata?.resizeMode !== "free";
  const resizeElement = (dimension: "width" | "height", value: number) => {
    const next = Math.max(1, value);
    const ratio = selected.transform.width / Math.max(1, selected.transform.height);
    const patches: BoardElementPatchOperation[] = [
      { op: "field.set", path: ["transform", dimension], value: next },
    ];
    if (proportionalResize && selected.kind !== "table") {
      patches.push({
        op: "field.set",
        path: ["transform", dimension === "width" ? "height" : "width"],
        value: dimension === "width" ? Math.max(1, next / ratio) : Math.max(1, next * ratio),
      });
    }
    onPatch(patches);
  };

  const runTableOperation = (operation: () => BoardElementPatchOperation) => {
    try {
      patch(operation());
      setTableMessage("");
    } catch (error) {
      setTableMessage(tableErrorMessage(error));
    }
  };

  return (
    <aside
      className={styles.surface}
      aria-label={`${KIND_LABELS[selected.kind]} properties`}
      data-element-kind={selected.kind}
    >
      <div className={styles.scroller}>
        <div className={styles.identity}>
          <span className={styles.kindIcon} aria-hidden="true">{kindIcon(selected.kind)}</span>
          <span className={styles.kindLabel}>{KIND_LABELS[selected.kind]}</span>
        </div>

        <Divider />

        <div className={styles.group} role="group" aria-label="Common element properties">
          <IconButton
            label={selected.locked ? "Unlock element" : "Lock element"}
            pressed={selected.locked}
            icon={selected.locked ? "●" : "○"}
            onClick={() => setField(["locked"], !selected.locked)}
          />
          <IconButton
            label={selected.visible ? "Hide element" : "Show element"}
            pressed={!selected.visible}
            icon={selected.visible ? "◉" : "◌"}
            onClick={() => setField(["visible"], !selected.visible)}
          />
          <IconButton
            label="Send backward"
            icon="↓"
            onClick={() => setField(["zIndex"], selected.zIndex - 1)}
          />
          <IconButton
            label="Bring forward"
            icon="↑"
            onClick={() => setField(["zIndex"], selected.zIndex + 1)}
          />
          <CompactField label="Rotate">
            <input
              className={styles.numberInput}
              aria-label="Rotation in degrees"
              type="number"
              min={0}
              max={359}
              step={15}
              value={normalizeRotation(selected.transform.rotation)}
              onChange={(event) =>
                setField(["transform", "rotation"], normalizeRotation(numericValue(event.currentTarget.value, 0)))
              }
            />
            <span className={styles.suffix} aria-hidden="true">°</span>
          </CompactField>
          {selected.kind !== "drawing" && selected.kind !== "connector" ? (
            <>
              <CompactField label="Width">
                <input
                  className={styles.numberInput}
                  aria-label="Element width"
                  type="number"
                  min={1}
                  value={Math.round(selected.transform.width)}
                  onChange={(event) => resizeElement("width", numericValue(event.currentTarget.value, selected.transform.width))}
                />
              </CompactField>
              {selected.kind !== "code_block" ? (
                <CompactField label="Height">
                  <input
                    className={styles.numberInput}
                    aria-label="Element height"
                    type="number"
                    min={1}
                    value={Math.round(selected.transform.height)}
                    onChange={(event) => resizeElement("height", numericValue(event.currentTarget.value, selected.transform.height))}
                  />
                </CompactField>
              ) : null}
              {selected.kind !== "table" ? (
                <Toggle
                  label="Keep ratio"
                  checked={proportionalResize}
                  onChange={(checked) => setField(["metadata", "resizeMode"], checked ? "proportional" : "free")}
                />
              ) : null}
            </>
          ) : null}
        </div>

        <Divider />

        {selected.kind === "drawing" ? (
          <div className={styles.group} role="group" aria-label="Drawing properties">
            <CompactField label="Tool">
              <select
                aria-label="Drawing tool"
                value={selected.drawingKind}
                onChange={(event) => setField(["drawingKind"], event.currentTarget.value)}
              >
                <option value="marker">Marker</option>
                <option value="highlighter">Highlighter</option>
                <option value="washi">Washi</option>
              </select>
            </CompactField>
            <ColorField label="Color" value={selected.style.color} onChange={(value) => setField(["style", "color"], value)} />
            <CompactField label="Weight">
              <input
                className={styles.range}
                aria-label="Drawing weight"
                type="range"
                min={1}
                max={32}
                value={selected.style.thickness}
                onChange={(event) => setField(["style", "thickness"], numericValue(event.currentTarget.value, 4))}
              />
            </CompactField>
            <CompactField label="Opacity">
              <input
                className={styles.range}
                aria-label="Drawing opacity"
                type="range"
                min={0.1}
                max={1}
                step={0.1}
                value={selected.style.opacity}
                onChange={(event) => setField(["style", "opacity"], numericValue(event.currentTarget.value, 1))}
              />
            </CompactField>
            <Toggle
              label="Straight line"
              checked={selected.style.straight}
              onChange={(checked) => setField(["style", "straight"], checked)}
            />
            {selected.drawingKind === "washi" && onWashiPatternReplace ? (
              <button type="button" className={styles.textButton} onClick={() => onWashiPatternReplace(selected)}>
                {selected.style.patternAsset ? "Replace pattern" : "Upload pattern"}
              </button>
            ) : null}
          </div>
        ) : null}

        {selected.kind === "sticky" ? (
          <div className={styles.group} role="group" aria-label="Sticky-note properties">
            <ColorField label="Paper" value={selected.color} onChange={(value) => setField(["color"], value)} />
            <CompactField label="Layout">
              <select aria-label="Sticky-note layout" value={selected.layout} onChange={(event) => setField(["layout"], event.currentTarget.value)}>
                <option value="square">Square</option>
                <option value="rectangle">Rectangle</option>
              </select>
            </CompactField>
            <Toggle label="Author" checked={selected.authorVisible} onChange={(checked) => setField(["authorVisible"], checked)} />
            <PlainTextField
              label="Note text"
              value={richTextPlainValue(selected.content)}
              onChange={(value) => {
                const lineCount = value.split("\n").reduce(
                  (count, line) => count + Math.max(1, Math.ceil(line.length / (selected.layout === "square" ? 18 : 30))),
                  0,
                );
                patch(
                  { op: "field.set", path: ["content"], value: replaceRichTextPlainValue(selected.content, value) },
                  { op: "field.set", path: ["transform", "height"], value: Math.max(selected.layout === "square" ? selected.transform.width : 92, 54 + lineCount * 22) },
                );
              }}
            />
          </div>
        ) : null}

        {selected.kind === "shape" ? (
          <div className={styles.group} role="group" aria-label="Shape properties">
            <ColorField label="Fill" value={selected.style.fill} onChange={(value) => setField(["style", "fill"], value)} />
            <ColorField label="Stroke" value={selected.style.stroke} onChange={(value) => setField(["style", "stroke"], value)} />
            <CompactField label="Outline">
              <select aria-label="Shape outline" value={selected.style.strokeStyle} onChange={(event) => setField(["style", "strokeStyle"], event.currentTarget.value)}>
                <option value="solid">Solid</option>
                <option value="dashed">Dashed</option>
                <option value="dotted">Dotted</option>
              </select>
            </CompactField>
            <CompactField label="Weight">
              <input className={styles.numberInput} aria-label="Shape outline weight" type="number" min={0} max={16} value={selected.style.strokeWidth} onChange={(event) => setField(["style", "strokeWidth"], numericValue(event.currentTarget.value, 2))} />
            </CompactField>
            <ColorField label="Text" value={selected.style.textColor} onChange={(value) => setField(["style", "textColor"], value)} />
            <CompactField label="Align">
              <select aria-label="Shape text alignment" value={selected.style.textAlign ?? "center"} onChange={(event) => setField(["style", "textAlign"], event.currentTarget.value)}>
                <option value="left">Left</option>
                <option value="center">Center</option>
                <option value="right">Right</option>
              </select>
            </CompactField>
            <PlainTextField label="Shape text" value={richTextPlainValue(selected.content)} onChange={(value) => setDocument(["content"], replaceRichTextPlainValue(selected.content, value))} />
          </div>
        ) : null}

        {selected.kind === "connector" ? (
          <div className={styles.group} role="group" aria-label="Connector properties">
            <ColorField label="Line" value={selected.style.color} onChange={(value) => setField(["style", "color"], value)} />
            <CompactField label="Path">
              <select aria-label="Connector path" value={selected.pathKind} onChange={(event) => setField(["pathKind"], event.currentTarget.value)}>
                <option value="straight">Straight</option>
                <option value="bent">Bent</option>
                <option value="curved">Curved</option>
              </select>
            </CompactField>
            <CompactField label="Start">
              <select aria-label="Connector start endpoint" value={selected.start.decoration} onChange={(event) => setField(["start", "decoration"], event.currentTarget.value)}>
                {ENDPOINTS.map((endpoint) => <option key={endpoint} value={endpoint}>{endpointLabel(endpoint)}</option>)}
              </select>
            </CompactField>
            <CompactField label="End">
              <select aria-label="Connector end endpoint" value={selected.end.decoration} onChange={(event) => setField(["end", "decoration"], event.currentTarget.value)}>
                {ENDPOINTS.map((endpoint) => <option key={endpoint} value={endpoint}>{endpointLabel(endpoint)}</option>)}
              </select>
            </CompactField>
            <CompactField label="Line">
              <select aria-label="Connector line style" value={selected.style.strokeStyle} onChange={(event) => setField(["style", "strokeStyle"], event.currentTarget.value)}>
                <option value="solid">Solid</option>
                <option value="dashed">Dashed</option>
                <option value="dotted">Dotted</option>
              </select>
            </CompactField>
            <CompactField label="Weight">
              <select aria-label="Connector weight" value={selected.style.thickness} onChange={(event) => setField(["style", "thickness"], event.currentTarget.value)}>
                <option value="thin">Thin</option>
                <option value="thick">Thick</option>
              </select>
            </CompactField>
            <Toggle label="Label fill" checked={selected.style.labelBackground === "matching"} onChange={(checked) => setField(["style", "labelBackground"], checked ? "matching" : "none")} />
            <CompactField label="Label position">
              <input className={styles.range} aria-label="Connector label position" type="range" min={0} max={1} step={0.01} value={selected.labelPosition} onChange={(event) => setField(["labelPosition"], numericValue(event.currentTarget.value, 0.5))} />
            </CompactField>
            {selected.controlPoints.map((control, index) => (
              <span className={styles.controlPoint} key={index}>
                <CompactField label={`P${index + 1} X`}>
                  <input className={styles.numberInput} aria-label={`Control point ${index + 1} x`} type="number" value={Math.round(control.x)} onChange={(event) => setField(["controlPoints", index, "x"], numericValue(event.currentTarget.value, control.x))} />
                </CompactField>
                <CompactField label={`P${index + 1} Y`}>
                  <input className={styles.numberInput} aria-label={`Control point ${index + 1} y`} type="number" value={Math.round(control.y)} onChange={(event) => setField(["controlPoints", index, "y"], numericValue(event.currentTarget.value, control.y))} />
                </CompactField>
              </span>
            ))}
            <button type="button" className={styles.textButton} onClick={() => setField(["controlPoints"], [...selected.controlPoints, { x: (selected.start.point.x + selected.end.point.x) / 2, y: (selected.start.point.y + selected.end.point.y) / 2 }])}>Add path handle</button>
            {selected.controlPoints.length > 0 ? <button type="button" className={styles.textButton} onClick={() => setField(["controlPoints"], [])}>Reset path</button> : null}
            <RichTextMarkButtons document={selected.label} onChange={(document) => setDocument(["label"], document)} />
            <PlainTextField label="Connector label" value={richTextPlainValue(selected.label)} onChange={(value) => setDocument(["label"], replaceRichTextPlainValue(selected.label, value))} />
          </div>
        ) : null}

        {selected.kind === "text" ? (
          <div className={styles.group} role="group" aria-label="Text properties">
            <CompactField label="Style">
              <select aria-label="Text style preset" value={selected.style.preset} onChange={(event) => setField(["style", "preset"], event.currentTarget.value)}>
                <option value="simple">Simple</option>
                <option value="bookish">Bookish</option>
                <option value="technical">Technical</option>
                <option value="scribbled">Scribbled</option>
              </select>
            </CompactField>
            <CompactField label="Mode">
              <select aria-label="Text sizing mode" value={selected.mode} onChange={(event) => setField(["mode"], event.currentTarget.value)}>
                <option value="point">Auto width</option>
                <option value="area">Fixed area</option>
              </select>
            </CompactField>
            <CompactField label="Size">
              <input className={styles.numberInput} aria-label="Text size" type="number" min={8} max={256} value={selected.style.fontSize} onChange={(event) => setField(["style", "fontSize"], numericValue(event.currentTarget.value, 18))} />
            </CompactField>
            <CompactField label="Preset size">
              <select aria-label="Text size preset" value={[12, 18, 24, 36, 64].includes(selected.style.fontSize) ? String(selected.style.fontSize) : "custom"} onChange={(event) => event.currentTarget.value !== "custom" && setField(["style", "fontSize"], Number(event.currentTarget.value))}>
                <option value="12">Small</option><option value="18">Normal</option><option value="24">Large</option><option value="36">Heading</option><option value="64">Display</option><option value="custom">Custom</option>
              </select>
            </CompactField>
            <ColorField label="Color" value={selected.style.color} onChange={(value) => setField(["style", "color"], value)} />
            <CompactField label="Align">
              <select aria-label="Text alignment" value={selected.style.align} onChange={(event) => setField(["style", "align"], event.currentTarget.value)}>
                <option value="left">Left</option>
                <option value="center">Center</option>
                <option value="right">Right</option>
              </select>
            </CompactField>
            <CompactField label="Block">
              <select aria-label="Text block type" value={textBlockValue(selected.content)} onChange={(event) => setDocument(["content"], setTextBlockValue(selected.content, event.currentTarget.value))}>
                <option value="paragraph">Paragraph</option>
                <option value="heading:1">Heading 1</option>
                <option value="heading:2">Heading 2</option>
                <option value="heading:3">Heading 3</option>
                <option value="unordered_list_item">Bulleted list</option>
                <option value="ordered_list_item">Numbered list</option>
                <option value="blockquote">Blockquote</option>
                <option value="code">Code block</option>
              </select>
            </CompactField>
            <IconButton label="Decrease indentation" icon="⇤" onClick={() => setDocument(["content"], adjustTextIndent(selected.content, -1))} />
            <IconButton label="Increase indentation" icon="⇥" onClick={() => setDocument(["content"], adjustTextIndent(selected.content, 1))} />
            <RichTextMarkButtons document={selected.content} onChange={(document) => setDocument(["content"], document)} />
            <CompactField label="Link">
              <input className={styles.linkInput} aria-label="Text hyperlink" type="url" placeholder="https://" value={selected.content.blocks[0]?.runs[0]?.marks?.link ?? ""} onChange={(event) => setDocument(["content"], setTextLink(selected.content, event.currentTarget.value))} />
            </CompactField>
            <CompactField label="Mention">
              <input className={styles.linkInput} aria-label="Mention display name" placeholder="@person" value={selected.content.blocks[0]?.runs[0]?.marks?.mention?.displayName ?? ""} onChange={(event) => setDocument(["content"], setTextMention(selected.content, event.currentTarget.value))} />
            </CompactField>
            <PlainTextField label="Text content" value={richTextPlainValue(selected.content)} onChange={(value) => setDocument(["content"], replaceRichTextPlainValue(selected.content, value))} />
          </div>
        ) : null}

        {selected.kind === "section" ? (
          <div className={styles.group} role="group" aria-label="Section properties">
            <ColorField label="Fill" value={selected.style.fill} onChange={(value) => setField(["style", "fill"], value)} />
            <ColorField label="Border" value={selected.style.stroke} onChange={(value) => setField(["style", "stroke"], value)} />
            <Toggle label="Show title" checked={selected.titleVisible} onChange={(checked) => setField(["titleVisible"], checked)} />
            <Toggle label="Collapsed" checked={selected.collapsed} onChange={(checked) => setField(["collapsed"], checked)} />
            <CompactField label="Lock">
              <select aria-label="Section lock mode" value={selected.lockMode} onChange={(event) => setField(["lockMode"], event.currentTarget.value)}>
                <option value="none">Unlocked</option>
                <option value="background">Background</option>
                <option value="all">All content</option>
              </select>
            </CompactField>
            <PlainTextField label="Section title" value={richTextPlainValue(selected.title)} onChange={(value) => setDocument(["title"], replaceRichTextPlainValue(selected.title, value))} />
            {onCopySectionLink ? <button type="button" className={styles.textButton} onClick={() => onCopySectionLink(selected)}>Copy section link</button> : null}
            {onDeleteSectionWithContents ? <button type="button" className={styles.textButton} onClick={() => onDeleteSectionWithContents(selected)}>Delete with content</button> : null}
          </div>
        ) : null}

        {selected.kind === "table" && table ? (
          <div className={styles.group} role="group" aria-label="Table properties">
            <CompactField label="Row">
              <select aria-label="Selected row" value={selectedRowId} onChange={(event) => setSelectedRowId(event.currentTarget.value)}>
                {table.rows.map((row, index) => <option key={row.id} value={row.id}>Row {index + 1}</option>)}
              </select>
            </CompactField>
            <IconButton label="Add row below" icon="+R" onClick={() => runTableOperation(() => tableInsertRowOperation(table, Math.max(0, table.rows.findIndex((row) => row.id === selectedRowId) + 1)))} />
            <IconButton label="Duplicate selected row" icon="⧉R" disabled={!selectedRowId} onClick={() => runTableOperation(() => tableDuplicateRowOperation(table, selectedRowId))} />
            <IconButton label="Delete selected row" icon="−R" disabled={!selectedRowId || table.rows.length <= 1} onClick={() => patch({ op: "table.row.deleted", rowId: selectedRowId })} />
            <IconButton label="Move row up" icon="↑R" disabled={!selectedRowId || table.rows[0]?.id === selectedRowId} onClick={() => patch({ op: "table.row.moved", rowId: selectedRowId, index: Math.max(0, table.rows.findIndex((row) => row.id === selectedRowId) - 1) })} />
            <IconButton label="Move row down" icon="↓R" disabled={!selectedRowId || table.rows.at(-1)?.id === selectedRowId} onClick={() => patch({ op: "table.row.moved", rowId: selectedRowId, index: Math.min(table.rows.length - 1, table.rows.findIndex((row) => row.id === selectedRowId) + 1) })} />
            {selectedRowId ? <CompactField label="Height"><input className={styles.numberInput} aria-label="Selected row height" type="number" min={24} max={320} value={table.rows.find((row) => row.id === selectedRowId)?.height ?? 44} onChange={(event) => setField(["rows", table.rows.findIndex((row) => row.id === selectedRowId), "height"], numericValue(event.currentTarget.value, 44))} /></CompactField> : null}
            <CompactField label="Column">
              <select aria-label="Selected column" value={selectedColumnId} onChange={(event) => setSelectedColumnId(event.currentTarget.value)}>
                {table.columns.map((column, index) => <option key={column.id} value={column.id}>Column {index + 1}</option>)}
              </select>
            </CompactField>
            <IconButton label="Add column to right" icon="+C" onClick={() => runTableOperation(() => tableInsertColumnOperation(table, Math.max(0, table.columns.findIndex((column) => column.id === selectedColumnId) + 1)))} />
            <IconButton label="Duplicate selected column" icon="⧉C" disabled={!selectedColumnId} onClick={() => runTableOperation(() => tableDuplicateColumnOperation(table, selectedColumnId))} />
            <IconButton label="Delete selected column" icon="−C" disabled={!selectedColumnId || table.columns.length <= 1} onClick={() => patch({ op: "table.column.deleted", columnId: selectedColumnId })} />
            <IconButton label="Move column left" icon="←C" disabled={!selectedColumnId || table.columns[0]?.id === selectedColumnId} onClick={() => patch({ op: "table.column.moved", columnId: selectedColumnId, index: Math.max(0, table.columns.findIndex((column) => column.id === selectedColumnId) - 1) })} />
            <IconButton label="Move column right" icon="→C" disabled={!selectedColumnId || table.columns.at(-1)?.id === selectedColumnId} onClick={() => patch({ op: "table.column.moved", columnId: selectedColumnId, index: Math.min(table.columns.length - 1, table.columns.findIndex((column) => column.id === selectedColumnId) + 1) })} />
            {selectedColumnId ? <CompactField label="Width"><input className={styles.numberInput} aria-label="Selected column width" type="number" min={48} max={640} value={table.columns.find((column) => column.id === selectedColumnId)?.width ?? 120} onChange={(event) => setField(["columns", table.columns.findIndex((column) => column.id === selectedColumnId), "width"], numericValue(event.currentTarget.value, 120))} /></CompactField> : null}
            <CompactField label="Cells">
              <select
                className={styles.cellSelect}
                aria-label="Selected table cells"
                multiple
                value={selectedCellIds}
                onChange={(event) => setSelectedCellIds([...event.currentTarget.selectedOptions].map((option) => option.value))}
              >
                {table.rows.flatMap((row, rowIndex) => table.columns.flatMap((column, columnIndex) => {
                  const cell = Object.values(table.cells).find((candidate) => candidate.rowId === row.id && candidate.columnId === column.id);
                  return cell ? <option key={cell.id} value={cell.id}>{rowIndex + 1}:{columnIndex + 1}</option> : [];
                }))}
              </select>
            </CompactField>
            {selectedCell ? (
              <PlainTextField
                label="Cell text"
                value={richTextPlainValue(selectedCell.content)}
                onChange={(value) => patch({
                  op: "table.cell.patched",
                  cellId: selectedCell.id,
                  patch: { content: replaceRichTextPlainValue(selectedCell.content, value) },
                })}
                onPaste={(event) => {
                  const clipboard = event.clipboardData.getData("text/plain");
                  if (!clipboard.includes("\t") && !clipboard.includes("\n") && !clipboard.includes(",")) return;
                  const row = table.rows.findIndex(({ id }) => id === selectedCell.rowId);
                  const column = table.columns.findIndex(({ id }) => id === selectedCell.columnId);
                  event.preventDefault();
                  onPatch(tablePastePatches(table, { row, column }, clipboard));
                }}
                onKeyDown={(event) => {
                  if (event.key !== "Tab") return;
                  event.preventDefault();
                  const next = nextTableCellId(table, selectedCell.id, event.shiftKey);
                  if (next) setSelectedCellIds([next]);
                }}
              />
            ) : null}
            {selectedCellIds.length > 0 ? <ColorField label="Cell fill" value={selectedCell?.style.fill ?? "#ffffff"} onChange={(value) => onPatch(selectedCellIds.flatMap((cellId) => {
              const cell = table.cells[cellId];
              return cell ? [{ op: "table.cell.patched" as const, cellId, patch: { style: { ...cell.style, fill: value } } }] : [];
            }))} /> : null}
            <IconButton label="Merge selected cells" icon="⇔" disabled={selectedCellIds.length < 2 || Boolean(activeMerge)} onClick={() => runTableOperation(() => tableMergeOperation(table, selectedCellIds))} />
            <IconButton label="Unmerge selected cells" icon="⇥" disabled={!activeMerge} onClick={() => activeMerge && patch({ op: "table.cells.unmerged", mergeId: activeMerge.id })} />
            <button type="button" className={styles.textButton} onClick={() => exportCsv(table, onExportCsv)}>CSV</button>
            <label className={styles.textButton}>
              Import
              <input
                className={styles.hiddenFile}
                type="file"
                accept=".csv,text/csv,text/tab-separated-values"
                onChange={(event) => {
                  const file = event.currentTarget.files?.[0];
                  if (!file) return;
                  void file.text().then((text) => onPatch(tablePastePatches(table, { row: 0, column: 0 }, text)));
                  event.currentTarget.value = "";
                }}
              />
            </label>
            {tableMessage ? <span className={styles.message} role="status">{tableMessage}</span> : null}
          </div>
        ) : null}

        {selected.kind === "stamp" ? (
          <div className={styles.group} role="group" aria-label="Stamp properties">
            <CompactField label="Emoji">
              <input className={styles.emojiInput} aria-label="Stamp emoji" value={selected.emoji} maxLength={12} onChange={(event) => setField(["emoji"], event.currentTarget.value)} />
            </CompactField>
            <div className={styles.stampChoices} aria-label="Quick stamp choices">
              {STAMP_CHOICES.map((emoji) => <button type="button" key={emoji} aria-label={`Use ${emoji} stamp`} aria-pressed={selected.emoji === emoji} onClick={() => setField(["emoji"], emoji)}>{emoji}</button>)}
            </div>
          </div>
        ) : null}

        {selected.kind === "media" ? (
          <div className={styles.group} role="group" aria-label="Media properties">
            <PlainTextField label="Alt text" value={selected.altText} rows={1} onChange={(value) => setField(["altText"], value)} />
            <IconButton label="Rotate left 90 degrees" icon="↶" onClick={() => setField(["transform", "rotation"], normalizeRotation(selected.transform.rotation - 90))} />
            <IconButton label="Rotate right 90 degrees" icon="↷" onClick={() => setField(["transform", "rotation"], normalizeRotation(selected.transform.rotation + 90))} />
            <CompactField label="Aspect">
              <select aria-label="Media aspect ratio" value={aspectRatioValue(selected.transform.width, selected.transform.height)} onChange={(event) => {
                const ratio = aspectRatio(event.currentTarget.value);
                if (ratio) setField(["transform", "height"], Math.round(selected.transform.width / ratio));
              }}>
                <option value="custom">Custom</option>
                <option value="1:1">1:1</option>
                <option value="4:3">4:3</option>
                <option value="16:9">16:9</option>
              </select>
            </CompactField>
            <CompactField label="Crop X">
              <input className={styles.range} aria-label="Media crop horizontal position" type="range" min={0} max={1} step={0.01} value={selected.crop.x} onChange={(event) => setField(["crop", "x"], numericValue(event.currentTarget.value, 0))} />
            </CompactField>
            <CompactField label="Crop Y">
              <input className={styles.range} aria-label="Media crop vertical position" type="range" min={0} max={1} step={0.01} value={selected.crop.y} onChange={(event) => setField(["crop", "y"], numericValue(event.currentTarget.value, 0))} />
            </CompactField>
            <CompactField label="Zoom">
              <input className={styles.range} aria-label="Media crop zoom" type="range" min={1} max={4} step={0.05} value={selected.crop.zoom} onChange={(event) => setField(["crop", "zoom"], numericValue(event.currentTarget.value, 1))} />
            </CompactField>
            {selected.mediaKind !== "image" ? <Toggle label="Playback" checked={selected.playing} onChange={(checked) => onMediaPlaybackChange ? onMediaPlaybackChange(selected, checked) : setField(["playing"], checked)} /> : null}
            {onMediaReplace ? <button type="button" className={styles.textButton} onClick={() => onMediaReplace(selected)}>Replace</button> : null}
          </div>
        ) : null}

        {selected.kind === "link_preview" ? (
          <div className={styles.group} role="group" aria-label="Link properties">
            <PlainTextField label="URL" value={selected.url} rows={1} onChange={(value) => setField(["url"], value)} />
            <CompactField label="Display">
              <select aria-label="Link display" value={selected.display} onChange={(event) => setField(["display"], event.currentTarget.value)}>
                <option value="card">Card</option>
                <option value="embed" disabled={!selected.embedUrl}>Embed</option>
                <option value="url">URL</option>
              </select>
            </CompactField>
            <CompactField label="Layout">
              <select aria-label="Link card layout" value={selected.layout} onChange={(event) => setField(["layout"], event.currentTarget.value)}>
                <option value="horizontal">Horizontal</option>
                <option value="vertical">Vertical</option>
              </select>
            </CompactField>
            {httpLinkHref(selected.url) ? <a className={styles.textButton} href={httpLinkHref(selected.url) ?? undefined} target="_blank" rel="noopener noreferrer">Open</a> : <span className={styles.message}>Enter an HTTP(S) URL</span>}
          </div>
        ) : null}

        {selected.kind === "code_block" ? (
          <div className={styles.group} role="group" aria-label="Code-block properties">
            <CompactField label="Language">
              <select aria-label="Code language" value={selected.language} onChange={(event) => setField(["language"], event.currentTarget.value)}>
                {CODE_LANGUAGES.map((language) => <option key={language} value={language}>{languageLabel(language)}</option>)}
              </select>
            </CompactField>
            <CompactField label="Theme">
              <select aria-label="Code theme" value={selected.theme} onChange={(event) => setField(["theme"], event.currentTarget.value)}>
                <option value="light">Light</option>
                <option value="dark">Dark</option>
              </select>
            </CompactField>
            <label className={styles.codeField}>
              <span>Code</span>
              <textarea aria-label="Code" rows={4} spellCheck={false} value={selected.code} onChange={(event) => setField(["code"], event.currentTarget.value)} />
            </label>
          </div>
        ) : null}

        {selected.kind === "mind_map_node" ? (
          <div className={styles.group} role="group" aria-label="Mind-map properties">
            <CompactField label="Direction">
              <select aria-label="Mind-map branch direction" value={selected.relation.direction} onChange={(event) => patch({ op: "mind_map.relation.changed", relation: { ...selected.relation, direction: event.currentTarget.value as typeof selected.relation.direction } })}>
                <option value="left">Left</option>
                <option value="right">Right</option>
                <option value="up">Up</option>
                <option value="down">Down</option>
              </select>
            </CompactField>
            <ColorField label="Fill" value={selected.style.fill} onChange={(value) => setField(["style", "fill"], value)} />
            <ColorField label="Text" value={selected.style.textColor} onChange={(value) => setField(["style", "textColor"], value)} />
            <ColorField label="Line" value={selected.style.lineColor} onChange={(value) => setField(["style", "lineColor"], value)} />
            <PlainTextField label="Node text" value={richTextPlainValue(selected.content)} onChange={(value) => setDocument(["content"], replaceRichTextPlainValue(selected.content, value))} />
            {onMindMapAddChild ? <button type="button" className={styles.textButton} onClick={() => onMindMapAddChild(selected)}>Add child</button> : null}
            {onMindMapAddSibling ? <button type="button" className={styles.textButton} onClick={() => onMindMapAddSibling(selected)}>Add sibling</button> : null}
            {onMindMapAttachSelection ? <button type="button" className={styles.textButton} onClick={() => onMindMapAttachSelection(selected)}>Attach selected</button> : null}
          </div>
        ) : null}

        {onQuickCreate && (selected.kind === "sticky" || selected.kind === "shape") ? (
          <div className={styles.group} role="group" aria-label="Quick create">
            <IconButton label="Quick create above" icon="↑" onClick={() => onQuickCreate(selected, "up")} />
            <IconButton label="Quick create right" icon="→" onClick={() => onQuickCreate(selected, "right")} />
            <IconButton label="Quick create below" icon="↓" onClick={() => onQuickCreate(selected, "down")} />
            <IconButton label="Quick create left" icon="←" onClick={() => onQuickCreate(selected, "left")} />
          </div>
        ) : null}

        <Divider />

        <div className={styles.group} role="group" aria-label="Element actions">
          <IconButton label="Duplicate element" icon="⧉" onClick={onDuplicate} />
          <IconButton danger label="Delete element" icon="⌫" onClick={onDelete} />
        </div>
      </div>
    </aside>
  );
}

function RichTextMarkButtons({
  document,
  onChange,
}: {
  document: RichTextDocument;
  onChange: (document: RichTextDocument) => void;
}) {
  const marks: readonly { mark: ToggleableRichTextMark; label: string; icon: string }[] = [
    { mark: "bold", label: "Bold", icon: "B" },
    { mark: "italic", label: "Italic", icon: "I" },
    { mark: "strikethrough", label: "Strikethrough", icon: "S" },
    { mark: "inlineCode", label: "Inline code", icon: "<>" },
  ];
  return (
    <div className={styles.markButtons} role="group" aria-label="Text formatting">
      {marks.map(({ mark, label, icon }) => (
        <IconButton
          key={mark}
          label={label}
          icon={icon}
          pressed={richTextMarkIsActive(document, mark)}
          onClick={() => onChange(toggleRichTextMark(document, mark))}
        />
      ))}
    </div>
  );
}

function CompactField({ label, children }: { label: string; children: ReactNode }) {
  return <label className={styles.compactField}><span>{label}</span><span className={styles.control}>{children}</span></label>;
}

function ColorField({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <label className={styles.colorField} title={`${label}: ${value}`}>
      <span>{label}</span>
      <span className={styles.colorControl}>
        <input aria-label={`${label} color`} type="color" value={validColor(value)} onChange={(event) => onChange(event.currentTarget.value)} />
        <span aria-hidden="true">{value.toUpperCase()}</span>
      </span>
    </label>
  );
}

function PlainTextField({ label, value, onChange, onPaste, onKeyDown, rows = 2 }: { label: string; value: string; onChange: (value: string) => void; onPaste?: (event: ClipboardEvent<HTMLTextAreaElement>) => void; onKeyDown?: (event: KeyboardEvent<HTMLTextAreaElement>) => void; rows?: number }) {
  return (
    <label className={styles.textField}>
      <span>{label}</span>
      <textarea aria-label={label} rows={rows} value={value} onChange={(event) => onChange(event.currentTarget.value)} onPaste={onPaste} onKeyDown={onKeyDown} />
    </label>
  );
}

function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (checked: boolean) => void }) {
  return (
    <label className={styles.toggle}>
      <input type="checkbox" checked={checked} onChange={(event) => onChange(event.currentTarget.checked)} />
      <span>{label}</span>
    </label>
  );
}

function IconButton({ label, icon, onClick, pressed, disabled = false, danger = false }: { label: string; icon: string; onClick: () => void; pressed?: boolean; disabled?: boolean; danger?: boolean }) {
  return (
    <button
      type="button"
      className={`${styles.iconButton}${danger ? ` ${styles.danger}` : ""}`}
      aria-label={label}
      aria-pressed={pressed}
      title={label}
      disabled={disabled}
      onClick={onClick}
    >
      {icon}
    </button>
  );
}

function Divider() {
  return <span className={styles.divider} aria-hidden="true" />;
}

function numericValue(value: string, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function validColor(value: string): string {
  return /^#[\da-f]{6}$/i.test(value) ? value : "#111827";
}

function endpointLabel(endpoint: ConnectorEndpointKind): string {
  return endpoint.split("_").map((part) => part[0]?.toUpperCase() + part.slice(1)).join(" ");
}

function languageLabel(language: CodeLanguage): string {
  const labels: Partial<Record<CodeLanguage, string>> = {
    cpp: "C++",
    css: "CSS",
    go: "Go",
    graphql: "GraphQL",
    html: "HTML",
    javascript: "JavaScript",
    json: "JSON",
    kotlin: "Kotlin",
    python: "Python",
    react: "React",
    ruby: "Ruby",
    rust: "Rust",
    sql: "SQL",
    swift: "Swift",
    typescript: "TypeScript",
  };
  return labels[language] ?? language;
}

function aspectRatio(value: string): number | null {
  if (value === "1:1") return 1;
  if (value === "4:3") return 4 / 3;
  if (value === "16:9") return 16 / 9;
  return null;
}

function aspectRatioValue(width: number, height: number): "custom" | "1:1" | "4:3" | "16:9" {
  if (height <= 0) return "custom";
  const ratio = width / height;
  if (Math.abs(ratio - 1) < 0.02) return "1:1";
  if (Math.abs(ratio - 4 / 3) < 0.02) return "4:3";
  if (Math.abs(ratio - 16 / 9) < 0.02) return "16:9";
  return "custom";
}

function tableErrorMessage(error: unknown): string {
  const code = error instanceof Error ? error.message : "";
  if (code === "TABLE_CELL_LIMIT_EXCEEDED") return "Tables support up to 500 cells.";
  if (code === "TABLE_MERGE_MUST_BE_RECTANGULAR") return "Select a rectangular cell range.";
  if (code === "TABLE_MERGE_OVERLAP") return "Unmerge the existing range first.";
  return "That table operation is not available.";
}

function textBlockValue(document: RichTextDocument): string {
  const block = document.blocks[0];
  return block?.type === "heading" ? `heading:${block.level ?? 1}` : block?.type ?? "paragraph";
}

function setTextBlockValue(document: RichTextDocument, value: string): RichTextDocument {
  const [type, rawLevel] = value.split(":");
  return {
    ...document,
    blocks: document.blocks.map((block) => ({
      ...block,
      type: type as RichTextDocument["blocks"][number]["type"],
      ...(type === "heading" ? { level: Math.min(6, Math.max(1, Number(rawLevel ?? 1))) as 1 | 2 | 3 | 4 | 5 | 6 } : {}),
    })),
  };
}

function adjustTextIndent(document: RichTextDocument, delta: number): RichTextDocument {
  return {
    ...document,
    blocks: document.blocks.map((block) => ({
      ...block,
      indent: Math.max(0, Math.min(8, (block.indent ?? 0) + delta)),
    })),
  };
}

function setTextLink(document: RichTextDocument, link: string): RichTextDocument {
  return mapTextMarks(document, (marks) => {
    const next = { ...marks };
    if (link.trim()) next.link = link.trim();
    else delete next.link;
    return next;
  });
}

function setTextMention(document: RichTextDocument, displayName: string): RichTextDocument {
  return mapTextMarks(document, (marks) => {
    const next = { ...marks };
    if (displayName.trim()) next.mention = { displayName: displayName.trim().replace(/^@/, "") };
    else delete next.mention;
    return next;
  });
}

function mapTextMarks(
  document: RichTextDocument,
  update: (marks: NonNullable<RichTextDocument["blocks"][number]["runs"][number]["marks"]>) => NonNullable<RichTextDocument["blocks"][number]["runs"][number]["marks"]>,
): RichTextDocument {
  return {
    ...document,
    blocks: document.blocks.map((block) => ({
      ...block,
      runs: block.runs.map((run) => {
        const marks = update(run.marks ?? {});
        return Object.keys(marks).length > 0 ? { ...run, marks } : { text: run.text };
      }),
    })),
  };
}

function exportCsv(table: TableElement, callback?: (csv: string, table: TableElement) => void) {
  const csv = tableToCsv(table);
  if (callback) {
    callback(csv, table);
    return;
  }
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `airboard-table-${table.id}.csv`;
  anchor.click();
  URL.revokeObjectURL(url);
}

function kindIcon(kind: BoardSceneElement["kind"]): string {
  const icons: Record<BoardSceneElement["kind"], string> = {
    drawing: "✎",
    sticky: "▰",
    shape: "◇",
    connector: "↗",
    text: "T",
    section: "▣",
    table: "▦",
    stamp: "●",
    media: "▧",
    link_preview: "↗",
    code_block: "</>",
    mind_map_node: "⌘",
  };
  return icons[kind];
}

export default SceneContextToolbar;
