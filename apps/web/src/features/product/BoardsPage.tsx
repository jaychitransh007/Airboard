"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { airboardApi } from "../../platform/api";
import { useAirboardAuth } from "../../platform/auth";
import { validateBoardTitle } from "../board/boardLifecycle";

type Board = {
  id: string;
  title: string;
  updated_at: string;
  latest_version: number;
  visibility: string;
};

type BoardAction =
  | { kind: "rename"; board: Board; title: string }
  | { kind: "delete"; board: Board }
  | null;

export function BoardsPage() {
  const auth = useAirboardAuth();
  const [boards, setBoards] = useState<Board[]>([]);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const [action, setAction] = useState<BoardAction>(null);
  const [actionBusy, setActionBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [recentlyDeleted, setRecentlyDeleted] = useState<Board | null>(null);

  useEffect(() => {
    if (!auth.accessToken) return;
    void airboardApi<{ boards: Board[] }>("/boards", { accessToken: auth.accessToken })
      .then((result) => setBoards(result.boards))
      .finally(() => setLoading(false));
    if (new URLSearchParams(window.location.search).get("deleted") === "1") {
      setNotice("Canvas moved to Trash. You can restore it from Trash.");
      window.history.replaceState({}, "", window.location.pathname);
    }
  }, [auth.accessToken]);

  const visible = useMemo(
    () => boards.filter((board) => board.title.toLowerCase().includes(query.toLowerCase())),
    [boards, query],
  );

  const closeAction = () => {
    if (actionBusy) return;
    setAction(null);
    setActionError(null);
  };

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
      setRecentlyDeleted(action.board);
      setNotice("Canvas moved to Trash.");
      setAction(null);
    } catch (caught) {
      setActionError(
        caught instanceof Error ? caught.message : "Could not move this canvas to Trash.",
      );
    } finally {
      setActionBusy(false);
    }
  };

  const restoreBoard = async () => {
    if (!auth.accessToken || !recentlyDeleted || actionBusy) return;
    setActionBusy(true);
    try {
      const result = await airboardApi<{ board: Board }>(
        `/boards/${recentlyDeleted.id}/restore`,
        { method: "POST", accessToken: auth.accessToken },
      );
      setBoards((current) => [{ ...recentlyDeleted, ...result.board }, ...current]);
      setRecentlyDeleted(null);
      setNotice("Canvas restored.");
    } catch (caught) {
      setNotice(caught instanceof Error ? caught.message : "Could not restore this canvas.");
    } finally {
      setActionBusy(false);
    }
  };

  return (
    <div>
      <section className="app-page-heading inline">
        <div>
          <p className="eyebrow">Library</p>
          <h1>Boards</h1>
          <p>Persistent diagrams, screen annotations and meeting artifacts.</p>
        </div>
        <Link className="button button-primary" href="/app/boards/new?preflight=1">
          New Airboard
        </Link>
      </section>

      {notice ? (
        <div className="library-notice" role="status">
          <span>{notice}</span>
          {recentlyDeleted ? (
            <button type="button" disabled={actionBusy} onClick={() => void restoreBoard()}>
              Restore
            </button>
          ) : null}
          <button type="button" aria-label="Dismiss message" onClick={() => setNotice(null)}>
            ×
          </button>
        </div>
      ) : null}

      <div className="library-toolbar">
        <input
          type="search"
          placeholder="Search boards"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        <div>
          <button className="selected">Updated</button>
          <Link href="/app/trash">Trash</Link>
        </div>
      </div>

      {loading ? (
        <div className="empty-panel">Loading boards…</div>
      ) : visible.length ? (
        <div className="board-grid large">
          {visible.map((board) => (
            <article className="board-card library-board-card" key={board.id}>
              <Link className="board-card-link" href={`/app/boards/${board.id}`}>
                <div className="board-thumbnail">
                  <span>{board.title[0]?.toUpperCase()}</span>
                </div>
                <strong>{board.title}</strong>
                <small>
                  {board.visibility} · version {board.latest_version}
                </small>
              </Link>
              <div className="library-board-actions">
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
                  <div className="library-board-menu" role="menu">
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
                      Move to Trash
                    </button>
                  </div>
                ) : null}
              </div>
            </article>
          ))}
        </div>
      ) : (
        <div className="empty-panel">
          <h3>No matching boards</h3>
          <p>Create a board or clear the search.</p>
        </div>
      )}

      {action ? (
        <div className="board-lifecycle-backdrop">
          <section
            className="board-lifecycle-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="library-board-action-title"
          >
            <span className="eyebrow">{action.kind === "rename" ? "Rename" : "Move to Trash"}</span>
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
                This canvas can be restored from Trash until your workspace retention policy
                permanently purges it.
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
                  ? "Saving…"
                  : action.kind === "rename"
                    ? "Save name"
                    : "Move to Trash"}
              </button>
            </div>
          </section>
        </div>
      ) : null}
    </div>
  );
}
