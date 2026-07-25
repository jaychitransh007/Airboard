"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { BoardState } from "@airboard/core";
import { AirboardPrototype } from "../board/AirboardPrototype";
import { airboardApi } from "../../platform/api";
import { useAirboardAuth } from "../../platform/auth";

export function AuthenticatedAirboard({ boardId }: { boardId?: string }) {
  const auth = useAirboardAuth();
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saveWarning, setSaveWarning] = useState<string | null>(null);
  const [saveStatus, setSaveStatus] = useState<"saved" | "saving" | "error">("saved");
  const [board, setBoard] = useState<DurableBoard | null>(null);
  const versionRef = useRef(0);
  const saveRequestRef = useRef(0);
  const saveChainRef = useRef(Promise.resolve());
  useEffect(() => {
    if (!auth.accessToken) return;
    const prepare = async () => {
      // A standalone board preflight proves the canvas can render. Activation
      // is idempotent and begins here rather than at account creation.
      const preflight = await airboardApi<{ passed: boolean }>("/integrations/preflight", {
        method: "POST",
        accessToken: auth.accessToken,
        body: JSON.stringify({
          platform: "standalone",
          checks: { canvas: true, firstAction: true },
          activateTrial: true,
          eventId: crypto.randomUUID(),
        }),
      });
      if (!preflight.passed) throw new Error("STANDALONE_PREFLIGHT_FAILED");
      await airboardApi("/trial/activate", {
        method: "POST",
        accessToken: auth.accessToken,
        body: JSON.stringify({ source: "standalone_preflight" }),
      });
      let durable: DurableBoard;
      if (!boardId) {
        const created = await airboardApi<{ board: DurableBoard }>("/boards", {
          method: "POST",
          accessToken: auth.accessToken,
          body: JSON.stringify({ title: "Untitled Airboard" }),
        });
        const loaded = await airboardApi<{ board: DurableBoard }>(`/boards/${created.board.id}`, {
          accessToken: auth.accessToken,
        });
        durable = loaded.board;
        router.replace(`/app/boards/${durable.id}`);
      } else {
        const loaded = await airboardApi<{ board: DurableBoard }>(`/boards/${boardId}`, {
          accessToken: auth.accessToken,
        });
        durable = loaded.board;
      }
      versionRef.current = durable.latest_version ?? 0;
      setBoard(durable);
      await auth.refreshAccount();
      setReady(true);
    };
    void prepare().catch((caught) => setError(caught instanceof Error ? caught.message : "AIRBOARD_PREPARE_FAILED"));
  }, [auth.accessToken, boardId, router]);

  const saveBoardState = useCallback((state: BoardState): Promise<void> => {
    if (!auth.accessToken || !board) {
      return Promise.reject(new Error("The saved canvas is not available."));
    }
    const requestId = ++saveRequestRef.current;
    setSaveStatus("saving");
    const operation = saveChainRef.current.catch(() => undefined).then(async () => {
      setSaveWarning(null);
      const version = versionRef.current + 1;
      const result = await airboardApi<{ board: { latest_version: number } }>(`/boards/${board.id}`, {
        method: "PATCH",
        accessToken: auth.accessToken,
        body: JSON.stringify({ state, version }),
      });
      versionRef.current = result.board.latest_version;
      if (saveRequestRef.current === requestId) {
        setSaveStatus("saved");
      }
    });
    saveChainRef.current = operation.catch(() => undefined);
    return operation.catch((caught) => {
      if (saveRequestRef.current === requestId) {
        setSaveStatus("error");
      }
      setSaveWarning(caught instanceof Error ? `Save interrupted: ${caught.message}` : "Save interrupted. Airboard will retry after your next change.");
      throw caught;
    });
  }, [auth.accessToken, board]);

  const persist = useCallback((state: BoardState) => {
    void saveBoardState(state).catch(() => undefined);
  }, [saveBoardState]);

  const renameBoard = useCallback(async (title: string) => {
    if (!auth.accessToken || !board) throw new Error("The saved canvas is not available.");
    const result = await airboardApi<{ board: { title: string } }>(`/boards/${board.id}`, {
      method: "PATCH",
      accessToken: auth.accessToken,
      body: JSON.stringify({ title }),
    });
    setBoard((current) => current ? { ...current, title: result.board.title } : current);
  }, [auth.accessToken, board]);

  const deleteBoard = useCallback(async (latestState: BoardState) => {
    if (!auth.accessToken || !board) throw new Error("The saved canvas is not available.");
    await saveBoardState(latestState);
    await airboardApi(`/boards/${board.id}`, {
      method: "DELETE",
      accessToken: auth.accessToken,
    });
    router.replace("/app/boards?deleted=1");
  }, [auth.accessToken, board, router, saveBoardState]);
  if (error) return <div className="product-loading"><strong>Could not prepare this Airboard.</strong><span>{error}</span></div>;
  if (!ready || !auth.accessToken || !auth.account || !board) return <div className="product-loading">Running a private canvas preflight…</div>;
  return <><AirboardPrototype surface="standalone" accessToken={auth.accessToken} accountUserId={auth.account.profile.id} persistentBoardId={board.id} persistentWorkspaceId={board.workspace_id} boardTitle={board.title} persistentSaveStatus={saveStatus} initialBoardState={normalizeBoardState(board.latest_state, board.id)} onPersistentBoardChange={persist} onRenameBoard={renameBoard} onDeleteBoard={deleteBoard} {...(auth.account.profile.preferences ? { initialPreferences: auth.account.profile.preferences } : {})} />{saveWarning ? <div className="board-save-warning" role="status">{saveWarning}</div> : null}</>;
}

type DurableBoard = {
  id: string;
  workspace_id: string;
  title: string;
  latest_state: unknown;
  latest_version: number;
};

function normalizeBoardState(value: unknown, boardId: string): BoardState {
  const candidate = value && typeof value === "object" ? value as Partial<BoardState> : {};
  return {
    boardId,
    strokes: isRecord(candidate.strokes) ? candidate.strokes as BoardState["strokes"] : {},
    activeStrokes: {},
    eraseActions: isRecord(candidate.eraseActions) ? candidate.eraseActions as BoardState["eraseActions"] : {},
    participants: {},
    cursors: {},
    lastSequence: Number.isSafeInteger(candidate.lastSequence) ? Number(candidate.lastSequence) : 0,
    ...(typeof candidate.clearedAt === "string" ? { clearedAt: candidate.clearedAt } : {}),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
