"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { BoardViewer } from "./BoardViewer";
import { fetchSharedBoard, sharedImageSources, type SharedBoard } from "./sharedBoard";

type LoadState = { status: "loading" } | { status: "unavailable" } | { status: "offline" } | { status: "ready"; board: SharedBoard };

/** A saved board opened through a view-only link: look, pan and zoom, never edit. */
export function SharedBoardView({ token }: { token: string }) {
  const [load, setLoad] = useState<LoadState>({ status: "loading" });
  const board = load.status === "ready" ? load.board : null;
  // Pictures load through the link instead of the members-only asset route.
  const images = useMemo(() => (board ? sharedImageSources(board.state, token) : []), [board, token]);

  useEffect(() => {
    let active = true;
    fetchSharedBoard(token)
      .then((shared) => active && setLoad(shared ? { status: "ready", board: shared } : { status: "unavailable" }))
      .catch(() => active && setLoad({ status: "offline" }));
    return () => { active = false; };
  }, [token]);

  if (load.status !== "ready" || !board) {
    return (
      <main className="shared-board shared-board-message" id="main-content" tabIndex={-1}>
        <Link className="marketing-brand" href="/">Airboard</Link>
        {load.status === "loading" ? <p role="status">Opening the board…</p> : null}
        {load.status === "unavailable" ? (
          <section>
            <h1>This link no longer works</h1>
            <p>It may have expired, or the board&apos;s workspace turned it off. Ask the person who shared it for a new link.</p>
          </section>
        ) : null}
        {load.status === "offline" ? (
          <section>
            <h1>The board could not be opened</h1>
            <p>Airboard could not be reached. Check your connection and reload the page.</p>
          </section>
        ) : null}
      </main>
    );
  }

  return (
    <BoardViewer
      title={board.title}
      state={board.state}
      images={images}
      actions={<Link className="button button-primary" href="/signup">Try Airboard</Link>}
    />
  );
}
