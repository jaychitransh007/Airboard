"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { renderBoard } from "@airboard/drawing-engine";
import {
  DEFAULT_VIEWPORT_LIMITS,
  IDENTITY_VIEWPORT,
  fitViewportToBounds,
  panViewport,
  zoomViewport,
  type BoardViewport,
  type ViewportLimits,
} from "../board/boardViewport";
import {
  fetchSharedBoard,
  sharedBoardBounds,
  sharedBoardText,
  sharedImageSources,
  type SharedBoard,
} from "./sharedBoard";

type LoadState = { status: "loading" } | { status: "unavailable" } | { status: "offline" } | { status: "ready"; board: SharedBoard };

const ZOOM_STEP = 1.25;

/** A saved board opened through a view-only link: look, pan and zoom, never edit. */
export function SharedBoardView({ token }: { token: string }) {
  const [load, setLoad] = useState<LoadState>({ status: "loading" });
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const viewRef = useRef<BoardViewport>(IDENTITY_VIEWPORT);
  const imagesRef = useRef<Record<string, CanvasImageSource>>({});
  const dragRef = useRef<{ pointerId: number; x: number; y: number } | null>(null);
  const board = load.status === "ready" ? load.board : null;

  useEffect(() => {
    let active = true;
    fetchSharedBoard(token)
      .then((shared) => active && setLoad(shared ? { status: "ready", board: shared } : { status: "unavailable" }))
      .catch(() => active && setLoad({ status: "offline" }));
    return () => { active = false; };
  }, [token]);

  const limits = useCallback((): ViewportLimits => {
    const canvas = canvasRef.current;
    return {
      ...DEFAULT_VIEWPORT_LIMITS,
      canvasWidth: canvas?.clientWidth ?? 1,
      canvasHeight: canvas?.clientHeight ?? 1,
    };
  }, []);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas || !board) return;
    renderBoard(canvas, board.state, {
      background: "white",
      view: viewRef.current,
      hideCursors: true,
      resolvedImages: imagesRef.current,
    });
  }, [board]);

  const fit = useCallback(() => {
    if (!board) return;
    const bounds = sharedBoardBounds(board.state);
    viewRef.current = bounds ? fitViewportToBounds(bounds, limits()) : IDENTITY_VIEWPORT;
    draw();
  }, [board, draw, limits]);

  const zoom = (factor: number) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    viewRef.current = zoomViewport(viewRef.current, factor, { x: canvas.clientWidth / 2, y: canvas.clientHeight / 2 }, limits());
    draw();
  };

  // Frame the board once it arrives, and again when the window changes size.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !board) return;
    fit();
    const observer = new ResizeObserver(() => fit());
    observer.observe(canvas);
    return () => observer.disconnect();
  }, [board, fit]);

  // Pictures load through the link and redraw the board as each one decodes.
  useEffect(() => {
    if (!board) return;
    const controller = new AbortController();
    for (const { url, aliases } of sharedImageSources(board.state, token)) {
      void decodeImage(url, controller.signal).then((image) => {
        if (controller.signal.aborted) return;
        for (const alias of aliases) imagesRef.current[alias] = image;
        draw();
      }).catch(() => undefined);
    }
    return () => controller.abort();
  }, [board, draw, token]);

  // Scrolling zooms around the pointer; the listener must be non-passive to keep the page still.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !board) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const rect = canvas.getBoundingClientRect();
      const factor = Math.exp(-event.deltaY * 0.0015);
      viewRef.current = zoomViewport(viewRef.current, factor, { x: event.clientX - rect.left, y: event.clientY - rect.top }, limits());
      draw();
    };
    canvas.addEventListener("wheel", onWheel, { passive: false });
    return () => canvas.removeEventListener("wheel", onWheel);
  }, [board, draw, limits]);

  if (load.status !== "ready" || !board) {
    return (
      <main className="shared-board shared-board-message" id="main-content" tabIndex={-1}>
        <Link className="marketing-brand" href="/">Airboard</Link>
        {load.status === "loading" ? <p role="status">Opening the board…</p> : null}
        {load.status === "unavailable" ? (
          <section>
            <h1>This link no longer works</h1>
            <p>It may have expired, or the person who shared the board turned it off. Ask them for a new link.</p>
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

  const text = sharedBoardText(board.state);
  return (
    <main className="shared-board" id="main-content" tabIndex={-1}>
      <header className="shared-board-bar">
        <Link className="marketing-brand" href="/">Airboard</Link>
        <div className="shared-board-title">
          <h1>{board.title}</h1>
          <span className="shared-board-badge">View only</span>
        </div>
        <div className="shared-board-zoom" role="group" aria-label="Zoom">
          <button type="button" aria-label="Zoom out" onClick={() => zoom(1 / ZOOM_STEP)}>−</button>
          <button type="button" onClick={fit}>Fit</button>
          <button type="button" aria-label="Zoom in" onClick={() => zoom(ZOOM_STEP)}>+</button>
        </div>
        <Link className="button button-primary" href="/signup">Try Airboard</Link>
      </header>
      <canvas
        ref={canvasRef}
        className="shared-board-canvas"
        role="img"
        aria-label={`Board “${board.title}”. Drag to move around; scroll or use the zoom buttons to zoom.`}
        aria-describedby="shared-board-text"
        onPointerDown={(event) => {
          dragRef.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY };
          event.currentTarget.setPointerCapture(event.pointerId);
        }}
        onPointerMove={(event) => {
          const drag = dragRef.current;
          if (!drag || drag.pointerId !== event.pointerId) return;
          viewRef.current = panViewport(viewRef.current, event.clientX - drag.x, event.clientY - drag.y, limits());
          dragRef.current = { ...drag, x: event.clientX, y: event.clientY };
          draw();
        }}
        onPointerUp={() => { dragRef.current = null; }}
        onPointerCancel={() => { dragRef.current = null; }}
      />
      <section id="shared-board-text" className="sr-only">
        <h2>Text on this board</h2>
        {text.length ? <ul>{text.map((line) => <li key={line}>{line}</li>)}</ul> : <p>The board has no text.</p>}
      </section>
    </main>
  );
}

function decodeImage(url: string, signal: AbortSignal): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.decoding = "async";
    const abort = () => { image.src = ""; reject(new DOMException("Aborted", "AbortError")); };
    signal.addEventListener("abort", abort, { once: true });
    image.onload = () => { signal.removeEventListener("abort", abort); resolve(image); };
    image.onerror = () => { signal.removeEventListener("abort", abort); reject(new Error("IMAGE_LOAD_FAILED")); };
    image.src = url;
  });
}
