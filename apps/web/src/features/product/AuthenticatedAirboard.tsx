"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { BOARD_SCENE_VERSION, type BoardState } from "@airboard/core";
import { AirboardPrototype } from "../board/AirboardPrototype";
import type { BoardShareAccess, BoardVisibility } from "../board/ShareDialog";
import type { ViewLink, ViewLinkControls } from "../board/ViewLinksSection";
import { requestBoardSessionStart } from "../board/boardSync";
import { liveLinkFromBoardAddress, rememberedLiveSession, savedBoardLink } from "../board/shareLinks";
import { AirboardApiError, airboardApi } from "../../platform/api";
import { canEditBoards, useAirboardAuth } from "../../platform/auth";
import { AIRBOARD_API_URL } from "../../platform/config";
import { prepareDurableBoard } from "./boardPreparation";
import { PilotExtensionButton } from "./OneTapRequestButton";
import { ViewOnlyBoard } from "./ViewOnlyBoard";
import { useDocumentTitle } from "./useDocumentTitle";

const SAVE_RETRY_BASE_MS = 1_000;
const SAVE_RETRY_MAX_MS = 30_000;
// A live-session peer usually persists the same synced state within one
// debounce window, so recheck once before treating a version move as a
// genuine conflict between two editors.
const CONFLICT_RECHECK_MS = 2_000;

type SaveNotice =
  | { kind: "retrying"; message: string }
  | { kind: "failed"; message: string }
  | { kind: "conflict" };

/**
 * A signed-in person's board. Viewer and Billing members get the view-only
 * board: no live session, no saving, no tools.
 */
export function AuthenticatedAirboard({ boardId }: { boardId?: string }) {
  const auth = useAirboardAuth();
  if (auth.account && !canEditBoards(auth.account.organization.role)) return <ViewOnlyBoard boardId={boardId} />;
  return <EditableAirboard {...(boardId ? { boardId } : {})} />;
}

function EditableAirboard({ boardId }: { boardId?: string }) {
  const auth = useAirboardAuth();
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saveNotice, setSaveNotice] = useState<SaveNotice | null>(null);
  const [saveStatus, setSaveStatus] = useState<"saved" | "saving" | "error">("saved");
  const [board, setBoard] = useState<DurableBoard | null>(null);
  useDocumentTitle(board?.title);
  const versionRef = useRef(0);
  const saveRequestRef = useRef(0);
  const saveChainRef = useRef(Promise.resolve());
  const latestStateRef = useRef<BoardState | null>(null);
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const retryAttemptRef = useRef(0);
  const conflictRef = useRef(false);
  const allowUnloadRef = useRef(false);
  const saveBoardStateRef = useRef<((state: BoardState) => Promise<void>) | null>(null);
  const preparingRef = useRef<string | null>(null);
  const pendingSessionStartRef = useRef<Promise<Response> | null>(null);
  useEffect(() => {
    if (!auth.accessToken) return;
    // A second run while one is still preparing (a remount or token refresh)
    // would race the first to activate the trial and create a second board.
    const preparationKey = boardId ?? "new";
    if (preparingRef.current === preparationKey) return;
    preparingRef.current = preparationKey;
    const accessToken = auth.accessToken;
    // The live session doesn't depend on the board's contents, so a saved
    // board starts it now, alongside the board load, instead of after the
    // canvas mounts. An address that names a session to rejoin skips this.
    pendingSessionStartRef.current = null;
    if (boardId && !new URLSearchParams(window.location.search).get("boardSessionId") && !rememberedLiveSession(boardId)) {
      // People who join with the live link watch until the owner lets them edit.
      const pending = requestBoardSessionStart({ apiBaseUrl: AIRBOARD_API_URL, accessToken, boardId, title: "Airboard", allowParticipantDrawing: false });
      pending.catch(() => undefined);
      pendingSessionStartRef.current = pending;
    }
    const prepare = async () => {
      const { board: durable, created } = await prepareDurableBoard<DurableBoard>(boardId, {
        api: (path, init) => airboardApi(path, { ...init, accessToken }),
        accountReady: auth.accountReady,
        refreshAccount: auth.refreshAccount,
      });
      if (created) {
        // Rewrite the address in place before the canvas mounts. A router
        // navigation here raced the live session's own URL update and could
        // leave the page on /app/boards/new, where a reload makes another board.
        window.history.replaceState(window.history.state, "", `/app/boards/${durable.id}`);
      }
      versionRef.current = durable.latest_version ?? 0;
      setBoard(durable);
      setReady(true);
    };
    void prepare()
      .catch((caught) => {
        const code = caught instanceof Error ? caught.message : "AIRBOARD_PREPARE_FAILED";
        // Someone outside the board's workspace opened the owner's address with
        // its live session attached: join that session as a guest instead.
        const live = code === "BOARD_NOT_FOUND"
          ? liveLinkFromBoardAddress(window.location.origin, window.location.search)
          : null;
        if (live) window.location.replace(live);
        else setError(code);
      })
      .finally(() => {
        if (preparingRef.current === preparationKey) preparingRef.current = null;
      });
    // Preparation runs once per board (preparingRef guards it); the auth
    // helpers read refs, so a new function identity must not re-run it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auth.accessToken, boardId, router]);

  useEffect(() => () => {
    if (retryTimerRef.current) clearTimeout(retryTimerRef.current);
  }, []);

  // Closing or reloading while a save is in flight, failing, or waiting on a
  // conflict decision would drop the person's latest edits.
  useEffect(() => {
    if (saveStatus === "saved") return;
    const warn = (event: BeforeUnloadEvent) => {
      if (allowUnloadRef.current) return;
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [saveStatus]);

  const scheduleRetry = useCallback((caught: unknown) => {
    const code = caught instanceof AirboardApiError ? caught.code : "SAVE_FAILED";
    if (!retryableSaveFailure(code)) {
      setSaveNotice({ kind: "failed", message: saveFailureMessage(code) });
      return;
    }
    const attempt = retryAttemptRef.current++;
    const delayMs = Math.min(SAVE_RETRY_MAX_MS, SAVE_RETRY_BASE_MS * 2 ** attempt);
    setSaveNotice({
      kind: "retrying",
      message: `${saveFailureMessage(code)} Retrying in ${Math.round(delayMs / 1_000)}s — keep this tab open.`,
    });
    if (retryTimerRef.current) clearTimeout(retryTimerRef.current);
    retryTimerRef.current = setTimeout(() => {
      retryTimerRef.current = null;
      const latest = latestStateRef.current;
      if (latest) void saveBoardStateRef.current?.(latest).catch(() => undefined);
    }, delayMs);
  }, []);

  const reconcileVersionConflict = useCallback(
    async (durableBoardId: string, accessToken: string, attempted: BoardState) => {
      for (const delayMs of [0, CONFLICT_RECHECK_MS]) {
        if (delayMs) await new Promise((resolve) => setTimeout(resolve, delayMs));
        const { board: current } = await airboardApi<{ board: DurableBoard }>(
          `/boards/${durableBoardId}`,
          { accessToken },
        );
        const latest = latestStateRef.current ?? attempted;
        if (
          sameBoardContent(current.latest_state, attempted) ||
          sameBoardContent(current.latest_state, latest)
        ) {
          // Another session already stored this content; adopt its version.
          versionRef.current = current.latest_version;
          return;
        }
      }
      conflictRef.current = true;
      setSaveNotice({ kind: "conflict" });
      throw new AirboardApiError("BOARD_VERSION_CONFLICT", 409);
    },
    [],
  );

  const saveBoardState = useCallback((state: BoardState): Promise<void> => {
    if (!auth.accessToken || !board) {
      return Promise.reject(new Error("The saved canvas is not available."));
    }
    latestStateRef.current = state;
    if (retryTimerRef.current) {
      clearTimeout(retryTimerRef.current);
      retryTimerRef.current = null;
    }
    if (conflictRef.current) {
      // Hold edits locally until the person chooses which version wins.
      setSaveStatus("error");
      return Promise.reject(new AirboardApiError("BOARD_VERSION_CONFLICT", 409));
    }
    const accessToken = auth.accessToken;
    const durableBoardId = board.id;
    const requestId = ++saveRequestRef.current;
    setSaveStatus("saving");
    const operation = saveChainRef.current.catch(() => undefined).then(async () => {
      if (conflictRef.current) throw new AirboardApiError("BOARD_VERSION_CONFLICT", 409);
      try {
        const result = await airboardApi<{ board: { latest_version: number } }>(`/boards/${durableBoardId}`, {
          method: "PATCH",
          accessToken,
          body: JSON.stringify({ state, version: versionRef.current + 1 }),
        });
        versionRef.current = result.board.latest_version;
      } catch (caught) {
        if (!(caught instanceof AirboardApiError) || caught.code !== "BOARD_VERSION_CONFLICT") throw caught;
        await reconcileVersionConflict(durableBoardId, accessToken, state);
      }
    });
    saveChainRef.current = operation.catch(() => undefined);
    return operation.then(
      () => {
        retryAttemptRef.current = 0;
        if (saveRequestRef.current === requestId) {
          setSaveStatus("saved");
          setSaveNotice(null);
        }
      },
      (caught) => {
        if (saveRequestRef.current === requestId) {
          setSaveStatus("error");
          if (!conflictRef.current) scheduleRetry(caught);
        }
        throw caught;
      },
    );
  }, [auth.accessToken, board, reconcileVersionConflict, scheduleRetry]);

  useEffect(() => {
    saveBoardStateRef.current = saveBoardState;
  }, [saveBoardState]);

  const persist = useCallback((state: BoardState) => saveBoardState(state), [saveBoardState]);

  const keepMyVersion = useCallback(async () => {
    if (!auth.accessToken || !board) return;
    try {
      const { board: current } = await airboardApi<{ board: DurableBoard }>(`/boards/${board.id}`, {
        accessToken: auth.accessToken,
      });
      versionRef.current = current.latest_version;
    } catch {
      // The save below reports its own failure and retries.
    }
    conflictRef.current = false;
    setSaveNotice(null);
    const latest = latestStateRef.current;
    if (latest) void saveBoardState(latest).catch(() => undefined);
  }, [auth.accessToken, board, saveBoardState]);

  const loadLatest = useCallback(() => {
    allowUnloadRef.current = true;
    window.location.reload();
  }, []);

  const renameBoard = useCallback(async (title: string) => {
    if (!auth.accessToken || !board) throw new Error("The saved canvas is not available.");
    const result = await airboardApi<{ board: { title: string } }>(`/boards/${board.id}`, {
      method: "PATCH",
      accessToken: auth.accessToken,
      body: JSON.stringify({ title }),
    });
    setBoard((current) => current ? { ...current, title: result.board.title } : current);
  }, [auth.accessToken, board]);

  const changeVisibility = useCallback(async (visibility: "private" | "organization") => {
    if (!auth.accessToken || !board) throw new Error("The saved canvas is not available.");
    const result = await airboardApi<{ board: { visibility: BoardVisibility } }>(`/boards/${board.id}`, {
      method: "PATCH",
      accessToken: auth.accessToken,
      body: JSON.stringify({ visibility }),
    });
    setBoard((current) => current ? { ...current, visibility: result.board.visibility } : current);
  }, [auth.accessToken, board]);

  // Deletion is permanent, so there is nothing to save first.
  const deleteBoard = useCallback(async () => {
    if (!auth.accessToken || !board) throw new Error("The saved canvas is not available.");
    await airboardApi(`/boards/${board.id}`, {
      method: "DELETE",
      accessToken: auth.accessToken,
    });
    // Only once it is gone: a failed delete keeps the leave-page guard.
    allowUnloadRef.current = true;
    router.replace("/app?deleted=1");
  }, [auth.accessToken, board, router]);
  const accessToken = auth.accessToken;
  const durableBoardId = board?.id;
  // Stable across renders, so the Share dialog loads the links once per opening.
  const viewLinks = useMemo<ViewLinkControls | undefined>(() => {
    if (!accessToken || !durableBoardId) return undefined;
    const base = `/boards/${encodeURIComponent(durableBoardId)}/share-links`;
    return {
      list: async () => (await airboardApi<{ links: ViewLink[] }>(base, { accessToken })).links,
      create: (expiresInDays) =>
        airboardApi<{ link: ViewLink; url: string }>(base, { method: "POST", accessToken, body: JSON.stringify({ expiresInDays }) }),
      revoke: async (id) => {
        await airboardApi(`${base}/${encodeURIComponent(id)}`, { method: "DELETE", accessToken });
      },
    };
  }, [accessToken, durableBoardId]);
  if (error) return <BoardUnavailable code={error} />;
  if (!ready || !auth.accessToken || !auth.account || !board) return <main className="product-loading"><p role="status">Opening your Airboard…</p></main>;
  const shareAccess: BoardShareAccess = {
    visibility: board.visibility ?? "private",
    canChange: board.owner_profile_id === auth.account.profile.id,
    personal: auth.account.organization.kind === "personal",
    workspaceName: auth.account.organization.name,
    boardLink: savedBoardLink(window.location.origin, board.id),
    onChange: changeVisibility,
    ...(viewLinks ? { viewLinks } : {}),
  };
  return (
    <>
      <AirboardPrototype surface="standalone" accessToken={auth.accessToken} accountUserId={auth.account.profile.id} persistentBoardId={board.id} persistentWorkspaceId={board.workspace_id} pendingSessionStart={pendingSessionStartRef.current} boardTitle={board.title} persistentSaveStatus={saveStatus} initialBoardState={normalizeBoardState(board.latest_state, board.id)} onPersistentBoardChange={persist} onRenameBoard={renameBoard} onDeleteBoard={deleteBoard} shareAccess={shareAccess} {...(auth.account.policy ? { organizationPolicy: auth.account.policy } : {})} {...(auth.account.profile.preferences ? { initialPreferences: auth.account.profile.preferences } : {})} />
      {saveNotice ? (
        <div className="board-save-warning" role={saveNotice.kind === "conflict" ? "alert" : "status"}>
          {saveNotice.kind === "conflict" ? (
            <>
              <span>This board was changed in another tab or on another device. Your latest edits are not saved yet.</span>
              <span className="board-save-actions">
                <button type="button" onClick={() => void keepMyVersion()}>Keep my version</button>
                <button type="button" onClick={loadLatest}>Load latest</button>
              </span>
            </>
          ) : saveNotice.message}
        </div>
      ) : null}
    </>
  );
}

function BoardUnavailable({ code }: { code: string }) {
  if (code === "ACTIVE_ENTITLEMENT_REQUIRED") {
    return (
      <main className="product-loading">
        <h1>Your pilot access has ended.</h1>
        <span>Your saved boards are still in your library. Starting a new board needs an active pilot. Ask us and we&apos;ll extend it.</span>
        <span className="product-loading-actions">
          <PilotExtensionButton primary />
          <Link className="button button-quiet" href="/app">Go to my boards</Link>
        </span>
      </main>
    );
  }
  return (
    <main className="product-loading">
      <h1>Could not open this Airboard.</h1>
      <span>
        {code === "NETWORK_UNAVAILABLE"
          ? "Airboard can't be reached right now. Check your connection and try again."
          : code === "BOARD_NOT_FOUND"
            ? "This board doesn't exist or isn't shared with your workspace."
            : code === "BOARD_READ_ONLY_ROLE"
              ? "Your role in this workspace can view boards but not change them. Ask an admin if you need to edit."
            : "Something went wrong while preparing the canvas. Please try again."}
      </span>
      <span className="product-loading-actions">
        <button className="button button-primary" type="button" onClick={() => window.location.reload()}>Try again</button>
        <Link className="button button-quiet" href="/app">Go to my boards</Link>
      </span>
      <small>Reference: {code}</small>
    </main>
  );
}

function retryableSaveFailure(code: string): boolean {
  return code !== "BOARD_STATE_TOO_LARGE" && code !== "BOARD_NOT_FOUND" && code !== "BOARD_READ_ONLY_ROLE";
}

function saveFailureMessage(code: string): string {
  if (code === "BOARD_READ_ONLY_ROLE") return "Your role in this workspace can view boards but not change them, so these changes can't be saved.";
  if (code === "BOARD_STATE_TOO_LARGE") return "This board is too large to save. Remove some media or split it into another board.";
  if (code === "BOARD_NOT_FOUND") return "This board was deleted elsewhere, so these changes can't be saved.";
  if (code === "NETWORK_UNAVAILABLE") return "Can't reach Airboard. Your changes are safe in this tab.";
  if (code === "MAINTENANCE") return "Airboard is down for a short upgrade, so saving is paused. Please hold off on changes.";
  if (code === "AUTH_REQUIRED" || code === "HTTP_401") return "Your sign-in is refreshing. Your changes are safe in this tab.";
  return "Your latest changes aren't saved yet.";
}

type DurableBoard = {
  id: string;
  workspace_id: string;
  title: string;
  latest_state: unknown;
  latest_version: number;
  visibility?: BoardVisibility;
  owner_profile_id?: string;
};

function normalizeBoardState(value: unknown, boardId: string): BoardState {
  const candidate = value && typeof value === "object" ? value as Partial<BoardState> : {};
  return {
    boardId,
    sceneVersion: BOARD_SCENE_VERSION,
    elements: isRecord(candidate.elements) ? candidate.elements as BoardState["elements"] : {},
    strokes: isRecord(candidate.strokes) ? candidate.strokes as BoardState["strokes"] : {},
    activeStrokes: {},
    eraseActions: isRecord(candidate.eraseActions) ? candidate.eraseActions as BoardState["eraseActions"] : {},
    participants: {},
    cursors: {},
    lastSequence: Number.isSafeInteger(candidate.lastSequence) ? Number(candidate.lastSequence) : 0,
    ...(typeof candidate.clearedAt === "string" ? { clearedAt: candidate.clearedAt } : {}),
  };
}

function sameBoardContent(stored: unknown, local: BoardState): boolean {
  return boardContentKey(normalizeBoardState(stored, local.boardId)) === boardContentKey(local);
}

/** Postgres jsonb reorders object keys, so compare with sorted keys. */
function boardContentKey(state: BoardState): string {
  return stableStringify({
    elements: state.elements,
    strokes: state.strokes,
    eraseActions: state.eraseActions,
    clearedAt: state.clearedAt ?? null,
  });
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (isRecord(value)) {
    return `{${Object.keys(value)
      .filter((key) => value[key] !== undefined)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
