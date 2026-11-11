"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { airboardApi } from "../../platform/api";
import { canEditBoards, useAirboardAuth } from "../../platform/auth";
import { useMenuKeyboard } from "../../platform/menuKeyboard";
import { useModalFocus } from "../../platform/modalFocus";
import { validateBoardTitle } from "../board/boardLifecycle";
import { BoardThumbnail } from "./BoardThumbnail";
import { boardCardDetail, boardMatchesQuery, type LibraryBoard } from "./boardLibrary";

type Board = LibraryBoard & {
  id: string;
  latest_version: number;
};

type BoardAction =
  | { kind: "rename"; board: Board; title: string }
  | { kind: "delete"; board: Board }
  | null;

/**
 * The signed-in home page: every Airboard you can open, yours and your team's,
 * most recently changed first, with Create Airboard always in reach.
 */
export function AirboardsHome() {
  const auth = useAirboardAuth();
  // Viewer and Billing members can open boards but not create or change them.
  const readOnly = Boolean(auth.account) && !canEditBoards(auth.account?.organization.role);
  const [boards, setBoards] = useState<Board[]>([]);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const loadedRef = useRef(false);
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  // Only one board menu is open at a time, so one ref serves them all.
  const boardMenuRef = useRef<HTMLDivElement | null>(null);
  useMenuKeyboard(boardMenuRef, openMenuId !== null, () => setOpenMenuId(null));
  const [action, setAction] = useState<BoardAction>(null);
  const [actionBusy, setActionBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    if (!auth.accessToken) return;
    void airboardApi<{ boards: Board[] }>("/boards?preview=1", { accessToken: auth.accessToken })
      .then((result) => {
        loadedRef.current = true;
        setBoards(result.boards);
        setLoadFailed(false);
      })
      // A failed first load must not look like an account with no boards; a
      // failed re-fetch (after a token refresh) keeps the list already shown.
      .catch(() => {
        if (!loadedRef.current) setLoadFailed(true);
      })
      .finally(() => setLoading(false));
    if (new URLSearchParams(window.location.search).get("deleted") === "1") {
      setNotice("Canvas deleted.");
      window.history.replaceState({}, "", window.location.pathname);
    }
  }, [auth.accessToken]);

  const visible = useMemo(
    () => boards.filter((board) => boardMatchesQuery(board, query)),
    [boards, query],
  );

  const closeAction = () => {
    if (actionBusy) return;
    setAction(null);
    setActionError(null);
  };
  const actionDialogRef = useRef<HTMLElement | null>(null);
  useModalFocus(actionDialogRef, action !== null, closeAction);

  const renameBoard = async () => {
    if (!auth.accessToken || action?.kind !== "rename" || actionBusy) return;
    const validation = validateBoardTitle(action.title);
    if (!validation.valid) {
      setActionError(validation.message);
      return;
    }
    const title = validation.title;
    setActionBusy(true);
    setActionError(null);
    try {
      const result = await airboardApi<{ board: Board }>(`/boards/${action.board.id}`, {
        method: "PATCH",
        accessToken: auth.accessToken,
        body: JSON.stringify({ title }),
      });
      setBoards((current) =>
        current.map((board) =>
          board.id === action.board.id ? { ...board, ...result.board } : board,
        ),
      );
      setNotice("Canvas renamed.");
      setAction(null);
    } catch (caught) {
      setActionError(caught instanceof Error ? caught.message : "Could not rename this canvas.");
    } finally {
      setActionBusy(false);
    }
  };

  const deleteBoard = async () => {
    if (!auth.accessToken || action?.kind !== "delete" || actionBusy) return;
    setActionBusy(true);
    setActionError(null);
    try {
      await airboardApi(`/boards/${action.board.id}`, {
        method: "DELETE",
        accessToken: auth.accessToken,
      });
      setBoards((current) => current.filter((board) => board.id !== action.board.id));
      setNotice("Canvas deleted.");
      setAction(null);
    } catch (caught) {
      setActionError(caught instanceof Error ? caught.message : "Could not delete this canvas.");
    } finally {
      setActionBusy(false);
    }
  };

  const createButton = readOnly ? null : (
    <Link className="button button-primary create-airboard-button" href="/app/boards/new?preflight=1">
      Create Airboard
    </Link>
  );
  // With nothing saved yet the page is one invitation to create.
  const firstRun = !loading && !loadFailed && boards.length === 0;

  return (
    <div className="airboards-home">
      {/* Mounted while empty: a status region added together with its text is often not read out. */}
      <p className="sr-only" role="status">{notice ?? ""}</p>
      {notice ? (
        <div className="library-notice">
          <span>{notice}</span>
          <button type="button" aria-label="Dismiss message" onClick={() => setNotice(null)}>
            ×
          </button>
        </div>
      ) : null}

      {/* Until the list arrives neither layout is right, so neither shows. */}
      {loading ? (
        <h1 className="sr-only">Airboards</h1>
      ) : firstRun ? (
        <section className="airboards-first-run">
          <h1>{readOnly ? "No Airboards yet" : "Create your first Airboard"}</h1>
          <p>
            {readOnly
              ? "Boards your team shares with you appear here."
              : "Type or say what you want to see, and Airboard draws it."}
          </p>
          {createButton}
        </section>
      ) : (
        <>
          <section className="app-page-heading inline">
            <h1>Airboards</h1>
            {createButton}
          </section>

          {/* Every board, most recently changed first. */}
          <div className="library-toolbar">
            <input
              type="search"
              aria-label="Search Airboards"
              placeholder="Search titles and what's on boards"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </div>
        </>
      )}

      {loading ? (
        <div className="empty-panel">Loading your Airboards…</div>
      ) : loadFailed ? (
        <div className="empty-panel" role="alert">
          <h2>Your Airboards didn&apos;t load</h2>
          <p>Airboard couldn&apos;t be reached. Your boards are safe. Reload to try again.</p>
          <button className="button button-primary" type="button" onClick={() => window.location.reload()}>
            Reload
          </button>
        </div>
      ) : firstRun ? null : visible.length ? (
        <div className="board-grid large">
          {visible.map((board) => (
            <article className="board-card library-board-card" key={board.id}>
              <Link className="board-card-link" href={`/app/boards/${board.id}`}>
                <BoardThumbnail board={board} />
                <strong>{board.title}</strong>
                <small>{boardCardDetail(board)}</small>
              </Link>
              {readOnly ? null : <div className="library-board-actions">
                <button
                  type="button"
                  aria-label={`Actions for ${board.title}`}
                  aria-haspopup="menu"
                  aria-expanded={openMenuId === board.id}
                  onClick={() => setOpenMenuId((current) => current === board.id ? null : board.id)}
                >
                  <svg
                    aria-hidden="true"
                    viewBox="0 0 20 4"
                    width="20"
                    height="4"
                  >
                    <circle cx="2" cy="2" r="2" />
                    <circle cx="10" cy="2" r="2" />
                    <circle cx="18" cy="2" r="2" />
                  </svg>
                </button>
                {openMenuId === board.id ? (
                  <div ref={boardMenuRef} className="library-board-menu" role="menu" aria-label={`Actions for ${board.title}`}>
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => {
                        setOpenMenuId(null);
                        setAction({ kind: "rename", board, title: board.title });
                        setActionError(null);
                      }}
                    >
                      Rename canvas
                    </button>
                    <button
                      type="button"
                      role="menuitem"
                      className="danger"
                      onClick={() => {
                        setOpenMenuId(null);
                        setAction({ kind: "delete", board });
                        setActionError(null);
                      }}
                    >
                      Delete canvas
                    </button>
                  </div>
                ) : null}
              </div>}
            </article>
          ))}
        </div>
      ) : (
        <div className="empty-panel">
          <h2>No matching Airboards</h2>
          <p>Try other words, or clear the search.</p>
        </div>
      )}

      {action ? (
        <div className="board-lifecycle-backdrop">
          <section
            ref={actionDialogRef}
            tabIndex={-1}
            className="board-lifecycle-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="library-board-action-title"
          >
            <span className="eyebrow">{action.kind === "rename" ? "Rename" : "Delete"}</span>
            <h2 id="library-board-action-title">
              {action.kind === "rename" ? "Rename canvas" : `Delete “${action.board.title}”?`}
            </h2>
            {action.kind === "rename" ? (
              <label>
                Canvas name
                <input
                  autoFocus
                  maxLength={240}
                  value={action.title}
                  onChange={(event) =>
                    setAction({ ...action, title: event.target.value })
                  }
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      void renameBoard();
                    } else if (event.key === "Escape") {
                      closeAction();
                    }
                  }}
                />
              </label>
            ) : (
              <p>
                This permanently deletes the canvas with its versions, images, share
                links and live-session history. It can&apos;t be undone.
              </p>
            )}
            {actionError ? <p className="board-lifecycle-error" role="alert">{actionError}</p> : null}
            <div className="board-lifecycle-actions">
              <button type="button" disabled={actionBusy} onClick={closeAction}>
                Cancel
              </button>
              <button
                type="button"
                className={action.kind === "delete" ? "danger" : "primary"}
                disabled={actionBusy}
                onClick={() => void (action.kind === "rename" ? renameBoard() : deleteBoard())}
              >
                {actionBusy
                  ? action.kind === "rename"
                    ? "Saving…"
                    : "Deleting…"
                  : action.kind === "rename"
                    ? "Save name"
                    : "Delete permanently"}
              </button>
            </div>
          </section>
        </div>
      ) : null}
    </div>
  );
}

