"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { AirboardApiError, airboardApi } from "../../platform/api";
import { useAirboardAuth } from "../../platform/auth";
import { AIRBOARD_API_URL } from "../../platform/config";
import { BoardViewer, decodeImage } from "../share/BoardViewer";
import { boardImageSources, sharedBoardState } from "../share/sharedBoard";

type SavedBoard = { id: string; title: string; latest_state: unknown };

const READ_ONLY_NOTICE = "Your role in this workspace lets you view boards, not change them. Ask an admin if you need to edit.";

/**
 * A saved board for a Viewer or Billing member: the board as last saved, to
 * pan and zoom. The API refuses their edits, so no editor or live session opens.
 */
export function ViewOnlyBoard({ boardId }: { boardId?: string | undefined }) {
  const auth = useAirboardAuth();
  const accessToken = auth.accessToken;
  const [board, setBoard] = useState<SavedBoard | null>(null);
  const [failure, setFailure] = useState<string | null>(null);

  useEffect(() => {
    if (!accessToken || !boardId) return;
    let active = true;
    airboardApi<{ board: SavedBoard }>(`/boards/${encodeURIComponent(boardId)}`, { accessToken })
      .then((result) => active && setBoard(result.board))
      .catch((caught) => active && setFailure(caught instanceof AirboardApiError ? caught.code : "BOARD_LOAD_FAILED"));
    return () => { active = false; };
  }, [accessToken, boardId]);

  const state = useMemo(() => (board ? { ...sharedBoardState(board.latest_state), boardId: board.id } : null), [board]);
  const images = useMemo(() => (board && state
    ? boardImageSources(state, (assetId) =>
      `${AIRBOARD_API_URL}/boards/${encodeURIComponent(board.id)}/assets/${assetId}/content`)
    : []), [board, state]);
  // Board pictures are members-only, so they load with the person's sign-in.
  const loadImage = useCallback(async (url: string, signal: AbortSignal) => {
    const response = await fetch(url, { headers: { Authorization: `Bearer ${accessToken ?? ""}` }, signal });
    if (!response.ok) throw new Error("BOARD_ASSET_DOWNLOAD_FAILED");
    const objectUrl = URL.createObjectURL(await response.blob());
    try {
      return await decodeImage(objectUrl, signal);
    } finally {
      URL.revokeObjectURL(objectUrl);
    }
  }, [accessToken]);

  if (!boardId || failure) {
    return (
      <div className="product-loading" role={failure ? "alert" : undefined}>
        <strong>{boardId ? "Could not open this Airboard." : "Your role can't create boards."}</strong>
        <span>
          {!boardId
            ? READ_ONLY_NOTICE
            : failure === "BOARD_NOT_FOUND"
              ? "This board doesn't exist or isn't shared with your workspace."
              : "Something went wrong while opening the board. Please try again."}
        </span>
        <span className="product-loading-actions">
          <Link className="button button-primary" href="/app/boards">Go to my boards</Link>
        </span>
      </div>
    );
  }
  if (!board || !state) return <div className="product-loading">Opening your Airboard…</div>;
  return (
    <BoardViewer
      title={board.title}
      state={state}
      images={images}
      loadImage={loadImage}
      notice={READ_ONLY_NOTICE}
      actions={<Link className="button" href="/app/boards">Back to boards</Link>}
    />
  );
}
