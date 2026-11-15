import Link from "next/link";
import type { Dispatch, RefObject, SetStateAction } from "react";
import type { ScreenUnderlayStatus } from "../engine/boardTypes";
import { liveLinkDropped } from "./boardLabels";

export type BoardTopBarProps = {
  liveGuest: boolean;
  titleEditing: boolean;
  titleDraft: string;
  setTitleDraft: Dispatch<SetStateAction<string>>;
  titleCancelPendingRef: RefObject<boolean>;
  commitTitleEdit: () => Promise<void>;
  restoreTitleFocusRef: RefObject<boolean>;
  cancelTitleEdit: () => void;
  titleButtonRef: RefObject<HTMLButtonElement | null>;
  boardTitle: string;
  onRenameBoard?: ((title: string) => Promise<void>) | undefined;
  beginTitleEdit: () => void;
  boardSyncStatus: string;
  titleStatus: "idle" | "saving" | "saved" | "error";
  persistentSaveStatus: "saved" | "saving" | "error";
  titleError: string | null;
  activeBoardSessionId: string | null;
  shareButtonRef: RefObject<HTMLButtonElement | null>;
  shareMenuOpen: boolean;
  setShareMenuOpen: Dispatch<SetStateAction<boolean>>;
  setMoreMenuOpen: Dispatch<SetStateAction<boolean>>;
  shareMenuRef: RefObject<HTMLDivElement | null>;
  setSettingsOpen: Dispatch<SetStateAction<boolean>>;
  setShareOpen: Dispatch<SetStateAction<boolean>>;
  exportPdf: () => void;
  exportPng: () => void;
  copyBoardImage: () => void;
  moreMenuOpen: boolean;
  settingsOpen: boolean;
  moreMenuRef: RefObject<HTMLDivElement | null>;
  screenUnderlayStatus: ScreenUnderlayStatus;
  recordingState: "idle" | "recording";
  stopScreenUnderlay: (notice?: string | null) => void;
  startScreenUnderlay: () => Promise<void>;
  onDeleteBoard?: (() => Promise<void>) | undefined;
  setDeleteStatus: Dispatch<SetStateAction<"idle" | "deleting" | "error">>;
  setDeleteError: Dispatch<SetStateAction<string | null>>;
  setDeleteDialogOpen: Dispatch<SetStateAction<boolean>>;
};

/** The board's top bar: back link, editable title, save state, and the Share and ••• menus. */
export function BoardTopBar({
  liveGuest,
  titleEditing,
  titleDraft,
  setTitleDraft,
  titleCancelPendingRef,
  commitTitleEdit,
  restoreTitleFocusRef,
  cancelTitleEdit,
  titleButtonRef,
  boardTitle,
  onRenameBoard,
  beginTitleEdit,
  boardSyncStatus,
  titleStatus,
  persistentSaveStatus,
  titleError,
  activeBoardSessionId,
  shareButtonRef,
  shareMenuOpen,
  setShareMenuOpen,
  setMoreMenuOpen,
  shareMenuRef,
  setSettingsOpen,
  setShareOpen,
  exportPdf,
  exportPng,
  copyBoardImage,
  moreMenuOpen,
  settingsOpen,
  moreMenuRef,
  screenUnderlayStatus,
  recordingState,
  stopScreenUnderlay,
  startScreenUnderlay,
  onDeleteBoard,
  setDeleteStatus,
  setDeleteError,
  setDeleteDialogOpen,
}: BoardTopBarProps) {
  return (
    <header className="topbar canvas-topbar">
      <div className="canvas-topbar-identity">
        <Link
          className="canvas-back-link"
          href={liveGuest ? "/" : "/app"}
          aria-label={liveGuest ? "Leave the live board" : "Back to boards"}
        >
          <span aria-hidden="true">←</span>
        </Link>
        <span className="canvas-brand-orbit" aria-hidden="true" />
        <div className="canvas-title-stack">
          <h1 className="canvas-title-heading">
          {titleEditing ? (
            <input
              className="canvas-title-input"
              aria-label="Canvas name"
              autoFocus
              maxLength={240}
              value={titleDraft}
              onChange={(event) => setTitleDraft(event.target.value)}
              onBlur={() => {
                if (titleCancelPendingRef.current) {
                  titleCancelPendingRef.current = false;
                  return;
                }
                void commitTitleEdit();
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  restoreTitleFocusRef.current = true;
                  void commitTitleEdit();
                } else if (event.key === "Escape") {
                  event.preventDefault();
                  restoreTitleFocusRef.current = true;
                  cancelTitleEdit();
                }
              }}
            />
          ) : (
            <button
              ref={titleButtonRef}
              type="button"
              className="canvas-title-button"
              aria-label={`Rename canvas ${boardTitle}`}
              title="Rename canvas"
              disabled={!onRenameBoard}
              onClick={beginTitleEdit}
            >
              {boardTitle}
            </button>
          )}
          </h1>
          <span
            className={`canvas-save-state ${
              liveGuest
                ? boardSyncStatus === "connected"
                  ? "saved"
                  : boardSyncStatus === "connecting" ||
                      boardSyncStatus === "paused" ||
                      liveLinkDropped(boardSyncStatus)
                    ? "saving"
                    : "error"
                : titleStatus === "saving"
                ? "saving"
                : titleStatus === "error"
                  ? "error"
                  : persistentSaveStatus
            }`}
            role="status"
            aria-live="polite"
          >
            {liveGuest
              ? boardSyncStatus === "connected"
                ? "Live · changes save to the host's board"
                : boardSyncStatus === "connecting"
                  ? "Connecting…"
                  : boardSyncStatus === "ended"
                    ? "This live session has ended"
                    : boardSyncStatus === "paused"
                      ? "Waiting for the host to come back…"
                      : liveLinkDropped(boardSyncStatus)
                        ? "Reconnecting…"
                        : "Not connected"
              : `${
                  titleError ??
                  (titleStatus === "saving"
                    ? "Renaming…"
                    : titleStatus === "saved"
                      ? "Renamed"
                      : persistentSaveStatus === "saving"
                        ? "Saving…"
                        : persistentSaveStatus === "error"
                          ? "Save interrupted"
                          : "Saved")
                }${
                  // The host's board saves either way; say when guests stop seeing it.
                  !activeBoardSessionId
                    ? ""
                    : boardSyncStatus === "ended" || boardSyncStatus === "rejected"
                      ? " · Live session ended"
                      : liveLinkDropped(boardSyncStatus) || boardSyncStatus === "paused"
                        ? " · Live link reconnecting…"
                        : ""
                }`}
          </span>
        </div>
      </div>
      {/* The top bar keeps two menus: Share (sharing and exports) and
          ••• for the board's other actions and settings. */}
      <div className="toolbar canvas-toolbar">
        <div className="canvas-more canvas-share">
          <button
            ref={shareButtonRef}
            type="button"
            className="toolbar-share-button"
            data-testid="share-board"
            aria-haspopup="menu"
            aria-expanded={shareMenuOpen}
            onClick={() => {
              setShareMenuOpen((value) => !value);
              setMoreMenuOpen(false);
            }}
          >
            Share
            <svg aria-hidden="true" viewBox="0 0 12 12" width="10" height="10" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="m2.5 4.5 3.5 3.5 3.5-3.5" />
            </svg>
          </button>
          {shareMenuOpen ? (
            <div ref={shareMenuRef} className="canvas-more-menu" role="menu" aria-label="Share and export">
              <button
                type="button"
                role="menuitem"
                data-testid="share-board-people"
                onClick={() => {
                  setShareMenuOpen(false);
                  setSettingsOpen(false);
                  setShareOpen(true);
                }}
              >
                <span aria-hidden="true">⤴</span>
                Share with people
              </button>
              <div className="canvas-more-separator" role="separator" />
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  exportPdf();
                  setShareMenuOpen(false);
                }}
              >
                <span aria-hidden="true">⇩</span>
                Export PDF
              </button>
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  exportPng();
                  setShareMenuOpen(false);
                }}
              >
                <span aria-hidden="true">⇩</span>
                Export PNG
              </button>
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  copyBoardImage();
                  setShareMenuOpen(false);
                }}
              >
                <span aria-hidden="true">⧉</span>
                Copy image
              </button>
            </div>
          ) : null}
        </div>
        <div className="canvas-more">
          <button
            type="button"
            className={`toolbar-icon-button${moreMenuOpen || settingsOpen ? " active" : ""}`}
            aria-label="More board actions"
            aria-haspopup="menu"
            aria-expanded={moreMenuOpen}
            onClick={() => {
              setMoreMenuOpen((value) => !value);
              setShareMenuOpen(false);
            }}
          >
            <span aria-hidden="true">•••</span>
          </button>
          {moreMenuOpen ? (
            <div ref={moreMenuRef} className="canvas-more-menu" role="menu" aria-label="Board actions">
              <button
                type="button"
                role="menuitem"
                data-testid="screen-underlay-toggle"
                disabled={screenUnderlayStatus === "starting" || recordingState === "recording"}
                onClick={() => {
                  setMoreMenuOpen(false);
                  if (screenUnderlayStatus === "active") {
                    stopScreenUnderlay("Screen background stopped.");
                  } else {
                    void startScreenUnderlay();
                  }
                }}
              >
                <span aria-hidden="true">▣</span>
                {screenUnderlayStatus === "starting"
                  ? "Choosing a screen…"
                  : screenUnderlayStatus === "active"
                    ? "Stop the screen behind the board"
                    : "Show a screen behind the board"}
              </button>
              <div className="canvas-more-separator" role="separator" />
              <button
                type="button"
                role="menuitem"
                aria-controls={settingsOpen ? "canvas-settings" : undefined}
                onClick={() => {
                  setSettingsOpen((value) => !value);
                  setMoreMenuOpen(false);
                }}
              >
                <span aria-hidden="true">⚙</span>
                {settingsOpen ? "Close board settings" : "Board settings"}
              </button>
              <Link
                href="/help/using-the-board/commands"
                target="_blank"
                rel="noreferrer"
                role="menuitem"
                onClick={() => setMoreMenuOpen(false)}
              >
                <span aria-hidden="true">?</span>
                Help center
              </Link>
              {onDeleteBoard ? (
                <button
                  type="button"
                  role="menuitem"
                  className="danger"
                  onClick={() => {
                    setMoreMenuOpen(false);
                    setDeleteStatus("idle");
                    setDeleteError(null);
                    setDeleteDialogOpen(true);
                  }}
                >
                  <span aria-hidden="true">⌫</span>
                  Delete canvas
                </button>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>
    </header>
  );
}
