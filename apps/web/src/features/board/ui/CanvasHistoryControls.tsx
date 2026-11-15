import type { RefObject } from "react";
import type { UndoSource } from "../history/boardHistory";

export type CanvasHistoryControlsProps = {
  undoLastAction: (source?: UndoSource) => void;
  redoLastSceneAction: () => void;
  diagramVisible: boolean;
  setDiagramVisibility: (visible: boolean, source: "snap" | "keyboard" | "voice" | "menu" | "test") => void;
  diagramVisibleRef: RefObject<boolean>;
};

/** Undo, redo and hide-diagram buttons at the bottom left of the canvas. */
export function CanvasHistoryControls({
  undoLastAction,
  redoLastSceneAction,
  diagramVisible,
  setDiagramVisibility,
  diagramVisibleRef,
}: CanvasHistoryControlsProps) {
  return (
    <div className="canvas-history-controls" role="toolbar" aria-label="Undo, redo and hide">
      <button
        type="button"
        aria-label="Undo"
        title="Undo (Cmd/Ctrl+Z)"
        onClick={() => undoLastAction("button")}
      >
        <svg aria-hidden="true" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
          <path d="M9 14 4 9l5-5" />
          <path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11" />
        </svg>
      </button>
      <button
        type="button"
        aria-label="Redo"
        title="Redo (Shift+Cmd/Ctrl+Z)"
        onClick={redoLastSceneAction}
      >
        <svg aria-hidden="true" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
          <path d="m15 14 5-5-5-5" />
          <path d="M20 9H9.5a5.5 5.5 0 0 0 0 11H13" />
        </svg>
      </button>
      <button
        type="button"
        data-testid="diagram-visibility-menu-action"
        aria-label={diagramVisible ? "Hide diagram" : "Show diagram"}
        aria-pressed={!diagramVisible}
        title={diagramVisible ? "Hide diagram (Shift+H)" : "Show diagram (Shift+H)"}
        onClick={() => setDiagramVisibility(!diagramVisibleRef.current, "menu")}
      >
        {diagramVisible ? (
          <svg aria-hidden="true" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
            <path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z" />
            <circle cx="12" cy="12" r="3" />
          </svg>
        ) : (
          <svg aria-hidden="true" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
            <path d="M3 3l18 18" />
            <path d="M10.6 5.6A9.7 9.7 0 0 1 12 5.5C18 5.5 21.5 12 21.5 12a17 17 0 0 1-3.1 3.9M6.1 7.1C3.8 8.8 2.5 12 2.5 12S6 18.5 12 18.5a9 9 0 0 0 4.4-1.1" />
            <path d="M9.9 9.9a3 3 0 0 0 4.2 4.2" />
          </svg>
        )}
      </button>
    </div>
  );
}
