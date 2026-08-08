"use client";

import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type DragEvent,
  type KeyboardEvent,
  type RefObject,
} from "react";
import { CatalogGlyph } from "./catalogGlyphs";
import type { ObjectDockTool } from "./gestureAnnotationMode";
import {
  ALL_SHAPES,
  CONNECTOR_TOOLS,
  CREATION_DRAG_MIME,
  DRAW_TOOLS,
  INSERT_TOOLS,
  SHAPE_CATEGORIES,
  creationToolLabel,
  legacyToolForCreationTool,
  shapeForTool,
  shapeToolId,
  type CreationToolId,
  type ShapeDefinition,
} from "./creationToolCatalog";

export type CreationPanelId = "draw" | "shape" | "connector" | "table" | "stamp" | "insert";

type CreationToolbarProps = {
  activeTool: CreationToolId;
  openPanel: string | null;
  onOpenPanelChange: (panel: CreationPanelId | null) => void;
  onToolSelect: (tool: CreationToolId) => void;
  onStampSelect?: (emoji: string) => void;
  onTableSizeSelect?: (rows: number, columns: number) => void;
  dockRef: RefObject<HTMLDivElement | null>;
  gestureHover?: string | null;
};

const DEFAULT_RECENT_SHAPES = [
  "basic-square",
  "basic-ellipse",
  "basic-diamond",
  "basic-rounded-rectangle",
  "flowchart-document",
  "flowchart-cylinder",
] as const;
const RECENT_SHAPES_STORAGE_KEY = "airboard.creation.recent-shapes.v1";
const RECENT_STAMPS_STORAGE_KEY = "airboard.creation.recent-stamps.v1";
const STAMPS = ["👍", "❤️", "🎉", "✅", "⭐", "👀", "🔥", "💡", "🚀", "❓", "⚠️", "👏"] as const;

export function CreationToolbar({
  activeTool,
  openPanel,
  onOpenPanelChange,
  onToolSelect,
  onStampSelect,
  onTableSizeSelect,
  dockRef,
  gestureHover = null,
}: CreationToolbarProps) {
  const [shapeLibraryOpen, setShapeLibraryOpen] = useState(false);
  const [shapeSearch, setShapeSearch] = useState("");
  const [recentShapeIds, setRecentShapeIds] = useState<string[]>([...DEFAULT_RECENT_SHAPES]);
  const [recentStamps, setRecentStamps] = useState<string[]>([]);
  const surfaceRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    try {
      const parsed = JSON.parse(window.localStorage.getItem(RECENT_SHAPES_STORAGE_KEY) ?? "null");
      if (Array.isArray(parsed)) {
        const valid = parsed.filter(
          (value): value is string =>
            typeof value === "string" && ALL_SHAPES.some((entry) => entry.id === value),
        );
        if (valid.length > 0) setRecentShapeIds(valid.slice(0, 8));
      }
    } catch {
      // Recents are a convenience; an unavailable preference store does not block the board.
    }
  }, []);

  useEffect(() => {
    try {
      const parsed = JSON.parse(window.localStorage.getItem(RECENT_STAMPS_STORAGE_KEY) ?? "null");
      if (Array.isArray(parsed)) {
        setRecentStamps(parsed.filter((value): value is string => typeof value === "string").slice(0, 4));
      }
    } catch {
      // Stamp recents are optional local convenience data.
    }
  }, []);

  useEffect(() => {
    if (!openPanel) return;
    const closeOnOutsidePointer = (event: PointerEvent) => {
      if (surfaceRef.current?.contains(event.target as Node)) return;
      onOpenPanelChange(null);
    };
    window.addEventListener("pointerdown", closeOnOutsidePointer);
    return () => window.removeEventListener("pointerdown", closeOnOutsidePointer);
  }, [onOpenPanelChange, openPanel]);

  const recentShapes = useMemo(
    () =>
      recentShapeIds.flatMap((id) => {
        const found = ALL_SHAPES.find((entry) => entry.id === id);
        return found ? [found] : [];
      }),
    [recentShapeIds],
  );

  const filteredCategories = useMemo(() => {
    const query = shapeSearch.trim().toLowerCase();
    if (!query) return SHAPE_CATEGORIES;
    return SHAPE_CATEGORIES.map((category) => ({
      ...category,
      shapes: category.shapes.filter((entry) =>
        [entry.label, entry.id, ...(entry.keywords ?? [])]
          .join(" ")
          .toLowerCase()
          .includes(query),
      ),
    })).filter((category) => category.shapes.length > 0);
  }, [shapeSearch]);

  const selectShape = (definition: ShapeDefinition) => {
    const tool = shapeToolId(definition.id);
    setRecentShapeIds((current) => {
      const next = [definition.id, ...current.filter((id) => id !== definition.id)].slice(0, 8);
      try {
        window.localStorage.setItem(RECENT_SHAPES_STORAGE_KEY, JSON.stringify(next));
      } catch {
        // Best-effort preference persistence.
      }
      return next;
    });
    onToolSelect(tool);
  };

  const selectAndClose = (tool: CreationToolId) => {
    onToolSelect(tool);
    onOpenPanelChange(null);
  };

  const selectStamp = (emoji: string) => {
    const next = [emoji, ...recentStamps.filter((candidate) => candidate !== emoji)].slice(0, 4);
    setRecentStamps(next);
    try {
      window.localStorage.setItem(RECENT_STAMPS_STORAGE_KEY, JSON.stringify(next));
    } catch {
      // Best-effort local recents only.
    }
    onStampSelect?.(emoji);
    selectAndClose("stamp");
  };

  const togglePanel = (panel: CreationPanelId) => {
    onOpenPanelChange(openPanel === panel ? null : panel);
  };

  const toolbarKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") {
      if (openPanel) {
        event.preventDefault();
        onOpenPanelChange(null);
      }
      return;
    }
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    if ((event.target as HTMLElement).closest(".creation-popover")) return;
    const buttons = [...event.currentTarget.querySelectorAll<HTMLButtonElement>("[data-toolbar-button]")]
      .filter((button) => !button.disabled && button.offsetParent !== null);
    const currentIndex = buttons.indexOf(event.target as HTMLButtonElement);
    if (currentIndex < 0 || buttons.length === 0) return;
    event.preventDefault();
    const nextIndex =
      event.key === "Home"
        ? 0
        : event.key === "End"
          ? buttons.length - 1
          : (currentIndex + (event.key === "ArrowRight" ? 1 : -1) + buttons.length) % buttons.length;
    buttons[nextIndex]?.focus();
  };

  return (
    <div ref={surfaceRef} className="creation-surface">
      <div
        ref={dockRef}
        className="object-dock catalog-dock creation-toolbar"
        role="toolbar"
        aria-label="Board creation tools"
        aria-orientation="horizontal"
        onKeyDown={toolbarKeyDown}
      >
        <div className="creation-toolbar-group" role="group" aria-label="Navigation">
          <ToolbarButton
            tool="move"
            active={activeTool === "move"}
            gestureHover={gestureHover === "select"}
            dockId="select"
            shortcut="V"
            onClick={() => selectAndClose("move")}
          />
          <ToolbarButton
            tool="hand"
            active={activeTool === "hand"}
            gestureHover={gestureHover === "hand"}
            dockId="hand"
            shortcut="H"
            onClick={() => selectAndClose("hand")}
          />
        </div>

        <span className="catalog-dock-divider" aria-hidden="true" />

        <div className="creation-toolbar-group" role="group" aria-label="Objects">
          <PopoverTrigger
            panel="draw"
            label="Draw"
            active={activeTool.startsWith("draw:")}
            expanded={openPanel === "draw"}
            gestureHover={gestureHover === "category:draw"}
            onClick={() => togglePanel("draw")}
          />
          {openPanel === "draw" ? (
            <CreationPopover label="Drawing tools" className="creation-popover-draw">
              {DRAW_TOOLS.map((entry) => {
                const tool = entry.id as CreationToolId;
                const legacy = legacyToolForCreationTool(tool);
                return (
                  <MenuToolButton
                    key={entry.id}
                    tool={tool}
                    active={activeTool === tool}
                    shortcut={entry.shortcut}
                    dockId={legacy === "eraser" ? "eraser" : legacy ? `tool:${legacy}` : `creation:${entry.id}`}
                    gestureHover={
                      gestureHover === (legacy === "eraser" ? "eraser" : legacy ? `tool:${legacy}` : `creation:${entry.id}`)
                    }
                    onClick={() => selectAndClose(tool)}
                  />
                );
              })}
            </CreationPopover>
          ) : null}

          <ToolbarButton
            tool="sticky"
            active={activeTool === "sticky"}
            gestureHover={gestureHover === "tool:note"}
            dockId="tool:note"
            shortcut="S"
            draggable
            onClick={() => selectAndClose("sticky")}
          />

          <PopoverTrigger
            panel="shape"
            label="Shape"
            active={activeTool.startsWith("shape:")}
            expanded={openPanel === "shape"}
            gestureHover={gestureHover === "category:shape"}
            iconTool={shapeForTool(activeTool)?.legacyTool}
            onClick={() => togglePanel("shape")}
          />
          {openPanel === "shape" ? (
            <CreationPopover label="Recent shapes and connectors" className="creation-popover-shape">
              <p className="creation-popover-heading">Recent</p>
              <div className="creation-quick-grid">
                {recentShapes.map((definition) => (
                  <ShapeButton
                    key={definition.id}
                    definition={definition}
                    active={activeTool === shapeToolId(definition.id)}
                    gestureHover={gestureHover}
                    onClick={() => selectShape(definition)}
                  />
                ))}
              </div>
              <p className="creation-popover-heading">Lines</p>
              <div className="creation-quick-grid creation-lines-grid">
                {CONNECTOR_TOOLS.map((entry) => (
                  <MenuToolButton
                    compact
                    key={entry.id}
                    tool={entry.id}
                    active={activeTool === entry.id}
                    dockId={"legacyTool" in entry ? `tool:${entry.legacyTool}` : `creation:${entry.id}`}
                    gestureHover={gestureHover === ("legacyTool" in entry ? `tool:${entry.legacyTool}` : `creation:${entry.id}`)}
                    onClick={() => selectAndClose(entry.id)}
                  />
                ))}
              </div>
              <button
                type="button"
                className="creation-more-shapes"
                role="menuitem"
                onClick={() => {
                  setShapeLibraryOpen(true);
                  onOpenPanelChange(null);
                }}
              >
                <span aria-hidden="true">⊞</span>
                More shapes
                <span aria-hidden="true">›</span>
              </button>
            </CreationPopover>
          ) : null}

          <PopoverTrigger
            panel="connector"
            label="Connector"
            active={activeTool.startsWith("connector:")}
            expanded={openPanel === "connector"}
            gestureHover={gestureHover === "category:connector"}
            iconTool={activeTool === "connector:straight" ? "arrow" : "connector"}
            onClick={() => togglePanel("connector")}
          />
          {openPanel === "connector" ? (
            <CreationPopover label="Connector types" className="creation-popover-connector">
              {CONNECTOR_TOOLS.map((entry) => (
                <MenuToolButton
                  key={entry.id}
                  tool={entry.id}
                  active={activeTool === entry.id}
                  shortcut={entry.id === "connector:bent" ? "X" : entry.id === "connector:straight" ? "L" : undefined}
                  dockId={"legacyTool" in entry ? `tool:${entry.legacyTool}` : `creation:${entry.id}`}
                  gestureHover={gestureHover === ("legacyTool" in entry ? `tool:${entry.legacyTool}` : `creation:${entry.id}`)}
                  onClick={() => selectAndClose(entry.id)}
                />
              ))}
            </CreationPopover>
          ) : null}
        </div>

        <span className="catalog-dock-divider" aria-hidden="true" />

        <div className="creation-toolbar-group" role="group" aria-label="Tools">
          <ToolbarButton tool="text" active={activeTool === "text"} shortcut="T" onClick={() => selectAndClose("text")} />
          <ToolbarButton tool="section" active={activeTool === "section"} shortcut="⇧S" onClick={() => selectAndClose("section")} />
          <PopoverTrigger
            panel="table"
            label="Table"
            active={activeTool === "table"}
            expanded={openPanel === "table"}
            shortcut="⇧T"
            onClick={() => togglePanel("table")}
          />
          {openPanel === "table" ? (
            <CreationPopover label="Choose table size" className="creation-popover-table">
              <TableSizePicker
                onSelect={(rows, columns) => {
                  if (onTableSizeSelect) onTableSizeSelect(rows, columns);
                  else selectAndClose("table");
                }}
              />
            </CreationPopover>
          ) : null}
          <PopoverTrigger
            panel="stamp"
            label="Stamp"
            active={activeTool === "stamp"}
            expanded={openPanel === "stamp"}
            gestureHover={gestureHover === "category:stamp"}
            onClick={() => togglePanel("stamp")}
          />
          {openPanel === "stamp" ? (
            <CreationPopover label="Stamps" className="creation-popover-stamp">
              {recentStamps.length > 0 ? (
                <>
                  <p className="creation-popover-heading">Recent</p>
                  <div className="creation-stamp-wheel recent" role="group" aria-label="Recent permanent stamps">
                    {recentStamps.map((emoji) => (
                      <button
                        key={emoji}
                        type="button"
                        role="menuitem"
                        aria-label={`Recent stamp ${emoji}`}
                        data-dock-id={`creation:stamp:recent:${emoji}`}
                        data-creation-tool="stamp"
                        onClick={() => selectStamp(emoji)}
                      >
                        <span aria-hidden="true">{emoji}</span>
                      </button>
                    ))}
                  </div>
                </>
              ) : null}
              <p className="creation-popover-heading">Stamps</p>
              <div className="creation-stamp-wheel" role="group" aria-label="Permanent stamp choices">
                {STAMPS.map((emoji) => (
                  <button
                    key={emoji}
                    type="button"
                    role="menuitem"
                    aria-label={`Stamp ${emoji}`}
                    data-dock-id={`creation:stamp:choice:${emoji}`}
                    data-creation-tool="stamp"
                    onClick={() => selectStamp(emoji)}
                  >
                    <span aria-hidden="true">{emoji}</span>
                  </button>
                ))}
              </div>
            </CreationPopover>
          ) : null}
        </div>

        <span className="catalog-dock-divider" aria-hidden="true" />

        <div className="creation-toolbar-group" role="group" aria-label="Insert">
          <PopoverTrigger
            panel="insert"
            label="Insert"
            active={activeTool.startsWith("insert:")}
            expanded={openPanel === "insert"}
            gestureHover={gestureHover === "category:insert"}
            onClick={() => togglePanel("insert")}
          />
          {openPanel === "insert" ? (
            <CreationPopover label="Insert on board" className="creation-popover-insert">
              <p className="creation-popover-heading">Insert</p>
              <div className="creation-insert-list">
                {INSERT_TOOLS.map((entry) => (
                  <button
                    key={entry.id}
                    type="button"
                    role="menuitem"
                    className={activeTool === entry.id ? "selected" : undefined}
                    data-dock-id={`creation:${entry.id}`}
                    data-creation-tool={entry.id}
                    onClick={() => selectAndClose(entry.id)}
                  >
                    <CreationGlyph tool={entry.id} />
                    <span>
                      <strong>{entry.label}</strong>
                      <small>{entry.description}</small>
                    </span>
                    <kbd>{insertShortcut(entry.id)}</kbd>
                  </button>
                ))}
              </div>
            </CreationPopover>
          ) : null}
        </div>
      </div>

      {shapeLibraryOpen ? (
        <aside className="creation-shape-sidebar" aria-label="More shapes">
          <header>
            <div>
              <strong>Shapes</strong>
              <span>FigJam catalog</span>
            </div>
            <button type="button" aria-label="Close shapes" onClick={() => setShapeLibraryOpen(false)}>×</button>
          </header>
          <label className="creation-shape-search">
            <span className="sr-only">Search shapes</span>
            <span aria-hidden="true">⌕</span>
            <input
              type="search"
              placeholder="Search shapes"
              value={shapeSearch}
              onChange={(event) => setShapeSearch(event.target.value)}
              autoFocus
            />
          </label>
          <div className="creation-shape-scroll">
            {!shapeSearch && recentShapes.length > 0 ? (
              <ShapeSection title="Recent" shapes={recentShapes} activeTool={activeTool} onSelect={selectShape} />
            ) : null}
            {!shapeSearch ? (
              <section className="creation-shape-section" aria-labelledby="creation-lines-title">
                <h3 id="creation-lines-title">Lines</h3>
                <div className="creation-shape-grid">
                  {CONNECTOR_TOOLS.map((entry) => (
                    <MenuToolButton
                      compact
                      key={entry.id}
                      tool={entry.id}
                      active={activeTool === entry.id}
                      onClick={() => onToolSelect(entry.id)}
                    />
                  ))}
                </div>
              </section>
            ) : null}
            {filteredCategories.map((category) => (
              <ShapeSection
                key={category.id}
                title={category.label}
                shapes={category.shapes}
                activeTool={activeTool}
                onSelect={selectShape}
              />
            ))}
            {filteredCategories.length === 0 ? (
              <p className="creation-shape-empty" role="status">No matching shapes.</p>
            ) : null}
          </div>
        </aside>
      ) : null}
    </div>
  );
}

function ToolbarButton({
  tool,
  active,
  shortcut,
  dockId,
  gestureHover,
  draggable = false,
  onClick,
}: {
  tool: CreationToolId;
  active: boolean;
  shortcut?: string;
  dockId?: string;
  gestureHover?: boolean;
  draggable?: boolean;
  onClick: () => void;
}) {
  const label = creationToolLabel(tool);
  return (
    <button
      type="button"
      className={`catalog-dock-button creation-tool-button${active ? " selected" : ""}${gestureHover ? " gesture-hover" : ""}`}
      data-toolbar-button="true"
      data-dock-id={dockId ?? `creation:${tool}`}
      data-creation-tool={tool}
      data-tooltip={shortcut ? `${label} · ${shortcut}` : label}
      title={shortcut ? `${label} (${shortcut})` : label}
      aria-label={shortcut ? `${label}, shortcut ${shortcut}` : label}
      aria-pressed={active}
      draggable={draggable}
      onDragStart={draggable ? (event) => setCreationDragData(event, tool) : undefined}
      onClick={onClick}
    >
      <CreationGlyph tool={tool} />
      <span className="sr-only">{label}</span>
    </button>
  );
}

function PopoverTrigger({
  panel,
  label,
  active,
  expanded,
  gestureHover,
  iconTool,
  shortcut,
  onClick,
}: {
  panel: CreationPanelId;
  label: string;
  active: boolean;
  expanded: boolean;
  gestureHover?: boolean;
  iconTool?: ObjectDockTool | undefined;
  shortcut?: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className={`catalog-dock-button catalog-category-trigger creation-tool-button${active || expanded ? " selected" : ""}${gestureHover ? " gesture-hover" : ""}`}
      data-toolbar-button="true"
      data-dock-id={`category:${panel}`}
      data-tooltip={shortcut ? `${label} · ${shortcut}` : label}
      title={shortcut ? `${label} (${shortcut})` : label}
      aria-label={shortcut ? `${label}, shortcut ${shortcut}` : label}
      aria-pressed={active}
      aria-haspopup="menu"
      aria-expanded={expanded}
      onClick={onClick}
    >
      {iconTool ? <CatalogGlyph tool={iconTool} /> : <CreationGlyph tool={panelIcon(panel)} />}
      <span className="sr-only">{label}</span>
      <span className="creation-menu-caret" aria-hidden="true">⌃</span>
    </button>
  );
}

function CreationPopover({
  label,
  className,
  children,
}: {
  label: string;
  className?: string;
  children: React.ReactNode;
}) {
  const keyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!["ArrowDown", "ArrowUp", "ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    const items = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')]
      .filter((button) => !button.disabled);
    if (items.length === 0) return;
    const current = items.indexOf(document.activeElement as HTMLButtonElement);
    const forward = event.key === "ArrowDown" || event.key === "ArrowRight";
    const next = event.key === "Home" ? 0 : event.key === "End" ? items.length - 1 : (current + (forward ? 1 : -1) + items.length) % items.length;
    event.preventDefault();
    items[next]?.focus();
  };
  return (
    <div className={`catalog-flyout creation-popover ${className ?? ""}`} role="menu" aria-label={label} onKeyDown={keyDown}>
      {children}
    </div>
  );
}

function MenuToolButton({
  tool,
  active,
  shortcut,
  dockId,
  gestureHover,
  compact = false,
  onClick,
}: {
  tool: CreationToolId;
  active: boolean;
  shortcut?: string | undefined;
  dockId?: string;
  gestureHover?: boolean;
  compact?: boolean;
  onClick: () => void;
}) {
  const label = creationToolLabel(tool);
  const draggable = tool.startsWith("connector:");
  return (
    <button
      type="button"
      role="menuitem"
      className={`creation-menu-tool${compact ? " compact" : ""}${active ? " selected" : ""}${gestureHover ? " gesture-hover" : ""}`}
      data-dock-id={dockId ?? `creation:${tool}`}
      data-creation-tool={tool}
      draggable={draggable}
      onDragStart={draggable ? (event) => setCreationDragData(event, tool) : undefined}
      onClick={onClick}
      aria-label={shortcut ? `${label}, shortcut ${shortcut}` : label}
      title={label}
    >
      <CreationGlyph tool={tool} />
      <span>{label}</span>
      {shortcut ? <kbd>{shortcut}</kbd> : null}
    </button>
  );
}

function ShapeButton({
  definition,
  active,
  gestureHover,
  onClick,
}: {
  definition: ShapeDefinition;
  active: boolean;
  gestureHover?: string | null;
  onClick: () => void;
}) {
  const tool = shapeToolId(definition.id);
  const instanceId = useId().replaceAll(":", "");
  const dockId = `creation:${tool}:${instanceId}`;
  return (
    <button
      type="button"
      role="menuitem"
      className={`creation-shape-button${active ? " selected" : ""}${gestureHover === dockId ? " gesture-hover" : ""}`}
      data-dock-id={dockId}
      data-creation-tool={tool}
      draggable
      onDragStart={(event) => setCreationDragData(event, tool)}
      onClick={onClick}
      aria-label={definition.label}
      title={`${definition.label} — click to arm or drag onto the board`}
    >
      <ShapeGlyph definition={definition} />
      <span>{definition.label}</span>
    </button>
  );
}

function ShapeSection({
  title,
  shapes,
  activeTool,
  onSelect,
}: {
  title: string;
  shapes: readonly ShapeDefinition[];
  activeTool: CreationToolId;
  onSelect: (definition: ShapeDefinition) => void;
}) {
  const id = `creation-shapes-${title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
  return (
    <section className="creation-shape-section" aria-labelledby={id}>
      <h3 id={id}>{title}</h3>
      <div className="creation-shape-grid">
        {shapes.map((definition) => (
          <ShapeButton
            key={definition.id}
            definition={definition}
            active={activeTool === shapeToolId(definition.id)}
            onClick={() => onSelect(definition)}
          />
        ))}
      </div>
    </section>
  );
}

function TableSizePicker({ onSelect }: { onSelect: (rows: number, columns: number) => void }) {
  const [size, setSize] = useState({ rows: 3, columns: 3 });
  const sizeRef = useRef(size);
  const draggingRef = useRef(false);
  useEffect(() => {
    sizeRef.current = size;
  }, [size]);
  useEffect(() => {
    const finish = () => {
      if (!draggingRef.current) return;
      draggingRef.current = false;
      onSelect(sizeRef.current.rows, sizeRef.current.columns);
    };
    window.addEventListener("pointerup", finish);
    window.addEventListener("pointercancel", finish);
    return () => {
      window.removeEventListener("pointerup", finish);
      window.removeEventListener("pointercancel", finish);
    };
  }, [onSelect]);
  return (
    <div className="creation-table-size-picker">
      <strong>{size.rows} × {size.columns}</strong>
      <div className="creation-table-size-grid" role="grid" aria-label="Initial table size">
        {Array.from({ length: 10 }, (_, rowIndex) =>
          Array.from({ length: 10 }, (_, columnIndex) => {
            const rows = rowIndex + 1;
            const columns = columnIndex + 1;
            const selected = rows <= size.rows && columns <= size.columns;
            return (
              <button
                key={`${rows}:${columns}`}
                type="button"
                role="menuitem"
                aria-label={`${rows} by ${columns} table`}
                aria-pressed={selected}
                data-dock-id={`creation:table:${rows}x${columns}`}
                data-creation-tool="table"
                className={selected ? "selected" : undefined}
                onPointerDown={(event) => {
                  event.preventDefault();
                  draggingRef.current = true;
                  setSize({ rows, columns });
                }}
                onPointerEnter={() => {
                  if (draggingRef.current) setSize({ rows, columns });
                }}
                onClick={(event) => {
                  if (event.detail === 0) onSelect(rows, columns);
                }}
              />
            );
          }),
        )}
      </div>
      <small>Drag to choose rows and columns</small>
    </div>
  );
}

function CreationGlyph({ tool }: { tool: CreationToolId }) {
  const definition = shapeForTool(tool);
  if (definition) return <ShapeGlyph definition={definition} />;
  const legacy = legacyToolForCreationTool(tool);
  if (legacy) return <CatalogGlyph tool={legacy as ObjectDockTool} />;
  return (
    <svg className="catalog-glyph creation-glyph" viewBox="0 0 40 32" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      {toolGlyph(tool)}
    </svg>
  );
}

function ShapeGlyph({ definition }: { definition: ShapeDefinition }) {
  if (definition.legacyTool) return <CatalogGlyph tool={definition.legacyTool as ObjectDockTool} />;
  const id = definition.id;
  const short = definition.label.split(/\s+/).map((part) => part[0]).join("").slice(0, 2).toUpperCase();
  return (
    <svg className="catalog-glyph creation-glyph" viewBox="0 0 40 32" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" strokeLinecap="round">
      {shapeGlyphPath(id, short)}
    </svg>
  );
}

function toolGlyph(tool: CreationToolId) {
  switch (tool) {
    case "hand": return <><path d="M12 17V9a2 2 0 0 1 4 0v6-9a2 2 0 0 1 4 0v9-7a2 2 0 0 1 4 0v8-5a2 2 0 0 1 4 0v8c0 7-4 10-10 10-4 0-6-2-9-7l-3-4a2.2 2.2 0 0 1 3.5-2.6z" /></>;
    case "draw:marker": return <><path d="M8 25 27 6l5 5-19 19H8z" /><path d="m23 10 5 5M6 29h14" /></>;
    case "draw:washi": return <><path d="M6 11c4-5 8 5 14 0s10 5 14 0v12c-4 5-8-5-14 0s-10-5-14 0z" /><path d="M10 15h4m4 0h4m4 0h4M9 20h4m4 0h4m4 0h4" /></>;
    case "connector:curved": return <><path d="M5 25C9 4 27 6 35 16" /><path d="m30 13 5 3-3 5" /></>;
    case "text": return <><path d="M8 7h24M20 7v20M14 27h12" /></>;
    case "section": return <><rect x="5" y="6" width="30" height="22" rx="2" strokeDasharray="3 2" /><path d="M5 11h30" /></>;
    case "table": return <><rect x="5" y="6" width="30" height="22" rx="2" /><path d="M5 13h30M5 20h30M15 6v22M25 6v22" /></>;
    case "stamp": return <><circle cx="20" cy="16" r="12" /><circle cx="16" cy="13" r="1" fill="currentColor" /><circle cx="24" cy="13" r="1" fill="currentColor" /><path d="M14 19c2 5 10 5 12 0" /></>;
    case "insert:mind-map": return <><circle cx="20" cy="16" r="4" /><circle cx="7" cy="8" r="3" /><circle cx="33" cy="7" r="3" /><circle cx="33" cy="25" r="3" /><path d="m16 14-6-4m14 4 6-5m-6 10 6 4" /></>;
    case "insert:face-stamp": return <><circle cx="20" cy="11" r="5" /><path d="M10 28c0-7 4-11 10-11s10 4 10 11" /><path d="M28 7h6v6" /></>;
    case "insert:code-block": return <><rect x="4" y="5" width="32" height="24" rx="3" /><path d="m15 12-5 5 5 5m10-10 5 5-5 5m-3-12-4 14" /></>;
    case "insert:media": return <><rect x="5" y="6" width="30" height="22" rx="3" /><circle cx="14" cy="13" r="3" /><path d="m8 25 8-7 5 4 5-6 7 9" /></>;
    case "insert:link": return <><path d="m17 21-3 3a6 6 0 0 1-8-8l5-5a6 6 0 0 1 8 0" /><path d="m23 11 3-3a6 6 0 0 1 8 8l-5 5a6 6 0 0 1-8 0M14 19l12-6" /></>;
    default: return <><circle cx="20" cy="16" r="12" /><path d="M20 10v12M14 16h12" /></>;
  }
}

function shapeGlyphPath(id: string, short: string) {
  if (id.endsWith("triangle")) return <path d={id.includes("downward") ? "M4 7h32L20 28z" : "M20 4 37 28H3z"} />;
  if (id.endsWith("pentagon")) return <path d="M20 3 37 14 31 29H9L3 14z" />;
  if (id.endsWith("hexagon")) return <path d="M10 4h20l8 12-8 12H10L2 16z" />;
  if (id.endsWith("octagon")) return <path d="m12 3 16 0 9 9v8l-9 9H12l-9-9v-8z" />;
  if (id.endsWith("plus")) return <path d="M15 4h10v7h7v10h-7v7H15v-7H8V11h7z" />;
  if (id.endsWith("left-arrow")) return <path d="m17 5-13 11 13 11v-7h19v-8H17z" />;
  if (id.endsWith("right-arrow")) return <path d="m23 5 13 11-13 11v-7H4v-8h19z" />;
  if (id.endsWith("chevron")) return <path d="M3 6h15l10 10-10 10H3l10-10z" />;
  if (id.endsWith("star")) return <path d="m20 3 4 9 10 1-8 7 3 9-9-5-9 5 3-9-8-7 10-1z" />;
  if (id.endsWith("speech-bubble") || id.endsWith("chat")) return <path d="M4 5h32v19H19l-8 5v-5H4z" />;
  if (id.includes("parallelogram")) return <path d={id.includes("left-leaning") ? "M10 5h27l-7 22H3z" : "M3 5h27l7 22H10z"} />;
  if (id.endsWith("horizontal-cylinder")) return <><ellipse cx="9" cy="16" rx="5" ry="11" /><path d="M9 5h21c7 0 7 22 0 22H9" /><path d="M30 5c-7 0-7 22 0 22" /></>;
  if (id.endsWith("file")) return <path d="M7 3h18l8 8v18H7zM25 3v8h8" />;
  if (id.endsWith("folder")) return <path d="M3 8h14l4 4h16l-3 16H6z" />;
  if (id.endsWith("multiple-documents")) return <><path d="M9 3h25v20" /><path d="M5 7h25v20H5z" /><path d="M10 13h15m-15 5h15" /></>;
  if (id.endsWith("predefined-process")) return <><rect x="4" y="5" width="32" height="22" /><path d="M10 5v22m20-22v22" /></>;
  if (id.endsWith("shield") || id.endsWith("security")) return <path d="M20 3 34 8v8c0 8-5 12-14 15C11 28 6 24 6 16V8z" />;
  if (id.endsWith("trapezoid")) return <path d="M10 5h20l7 22H3z" />;
  if (id.endsWith("manual-input")) return <path d="M4 11 36 5v22H4z" />;
  if (id.endsWith("internal-storage")) return <><rect x="4" y="5" width="32" height="22" /><path d="M10 5v22M4 11h32" /></>;
  if (id.endsWith("-or") || id.endsWith("summing-junction")) return <><circle cx="20" cy="16" r="12" /><path d={id.endsWith("-or") ? "M12 16h16M20 8v16" : "m13 9 14 14m0-14-14 14"} /></>;
  if (id.endsWith("cloud")) return <path d="M10 25h20a7 7 0 0 0 1-14 11 11 0 0 0-20-3 8 8 0 0 0-1 17z" />;
  if (id.endsWith("email")) return <><rect x="4" y="6" width="32" height="22" rx="2" /><path d="m5 8 15 11L35 8" /></>;
  if (id.endsWith("location")) return <><path d="M20 30S9 21 9 12a11 11 0 0 1 22 0c0 9-11 18-11 18z" /><circle cx="20" cy="12" r="4" /></>;
  if (id.endsWith("mobile")) return <><rect x="12" y="2" width="16" height="28" rx="3" /><path d="M18 26h4" /></>;
  if (id.endsWith("send")) return <path d="m3 15 34-12-10 27-8-10zM19 20 37 3" />;
  if (id.endsWith("terminal")) return <><rect x="4" y="5" width="32" height="23" rx="3" /><path d="m10 12 5 5-5 5m9 1h10" /></>;
  return <><rect x="4" y="5" width="32" height="22" rx="4" /><text x="20" y="19" textAnchor="middle" fill="currentColor" stroke="none" fontSize="8" fontWeight="700">{short}</text></>;
}

function panelIcon(panel: CreationPanelId): CreationToolId {
  switch (panel) {
    case "draw": return "draw:marker";
    case "shape": return "shape:basic-square";
    case "connector": return "connector:bent";
    case "table": return "table";
    case "stamp": return "stamp";
    case "insert": return "insert:mind-map";
  }
}

function insertShortcut(id: (typeof INSERT_TOOLS)[number]["id"]): string {
  if (id === "insert:code-block") return "`";
  if (id === "insert:media") return "⇧⌘K";
  return "";
}

function setCreationDragData(event: DragEvent<HTMLButtonElement>, tool: CreationToolId) {
  event.dataTransfer.setData(CREATION_DRAG_MIME, tool);
  event.dataTransfer.effectAllowed = "copy";
}
