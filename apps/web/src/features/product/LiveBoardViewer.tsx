"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { applyBoardEvent, type BoardState } from "@airboard/core";
import { startBoardSync, type BoardSyncHandle } from "../board/boardSync";
import { AIRBOARD_API_URL } from "../../platform/config";
import { BoardViewer } from "../share/BoardViewer";

const NO_IMAGES = [] as const;

/**
 * A live board its host has set to "Can view": the board as it changes, to
 * pan and zoom, with no tools. When the host lets people edit, the page swaps
 * in the full board.
 */
export function LiveBoardViewer({
  sessionId,
  joinToken,
  displayName,
  accessToken,
  accountUserId,
  onEditingAllowed,
  onJoinFailed,
}: {
  sessionId: string;
  joinToken: string;
  displayName: string;
  accessToken?: string;
  accountUserId?: string;
  onEditingAllowed: () => void;
  onJoinFailed: (message: string) => void;
}) {
  const [state, setState] = useState<BoardState | null>(null);
  const callbacksRef = useRef({ onEditingAllowed, onJoinFailed });
  callbacksRef.current = { onEditingAllowed, onJoinFailed };

  useEffect(() => {
    let handle: BoardSyncHandle | null = null;
    let cancelled = false;
    startBoardSync(
      {
        apiBaseUrl: AIRBOARD_API_URL,
        boardSessionId: sessionId,
        ownerUserId: accountUserId ?? "guest",
        joinToken,
        displayName,
        ...(accessToken ? { accessToken } : {}),
      },
      {
        onRemoteEvent: (event) => {
          if (cancelled) return;
          if (event.type === "permission.changed" && event.allowParticipantDrawing) {
            callbacksRef.current.onEditingAllowed();
            return;
          }
          setState((current) => (current ? applyBoardEvent(current, event) : current));
        },
        onSessionPermission: (allow) => {
          if (!cancelled && allow) callbacksRef.current.onEditingAllowed();
        },
      },
    )
      .then((result) => {
        if (cancelled) {
          result.handle.stop();
          return;
        }
        handle = result.handle;
        if (result.handle.allowParticipantDrawing) {
          callbacksRef.current.onEditingAllowed();
          return;
        }
        setState(result.initialState);
      })
      .catch((caught: unknown) => {
        if (!cancelled) callbacksRef.current.onJoinFailed(caught instanceof Error ? caught.message : String(caught));
      });
    return () => {
      cancelled = true;
      handle?.stop();
    };
  }, [accessToken, accountUserId, displayName, joinToken, sessionId]);

  if (!state) return <main className="product-loading"><p role="status">Joining the live board…</p></main>;
  return (
    <BoardViewer
      title="Live board"
      state={state}
      images={NO_IMAGES}
      notice="The host has set this live board to view only. You can edit if they let people edit."
      actions={<Link className="button" href="/">Leave</Link>}
    />
  );
}
