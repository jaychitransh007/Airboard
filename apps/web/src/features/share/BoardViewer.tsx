"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, type ReactNode } from "react";
import type { BoardState } from "@airboard/core";
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
import { sharedBoardBounds, sharedBoardText, type ImageSource } from "./sharedBoard";

const ZOOM_STEP = 1.25;

export type ImageLoader = (url: string, signal: AbortSignal) => Promise<CanvasImageSource>;

/**
 * A saved board to look at, pan and zoom, never edit: boards opened through a
 * view-only link, and boards opened by members whose role is view-only.
 */
export function BoardViewer({
  title,
  state,
  images,
  loadImage = decodeImage,
  actions,
  notice,
}: {
  title: string;
  state: BoardState;
  images: readonly ImageSource[];
  loadImage?: ImageLoader;
  /** Shown at the end of the bar, e.g. a link back or a sign-up button. */
  actions: ReactNode;
  /** A line under the bar explaining why the board is view-only. */
  notice?: ReactNode;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const viewRef = useRef<BoardViewport>(IDENTITY_VIEWPORT);
  const imagesRef = useRef<Record<string, CanvasImageSource>>({});
  const dragRef = useRef<{ pointerId: number; x: number; y: number } | null>(null);

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
    if (!canvas) return;
    renderBoard(canvas, state, {
      background: "white",
      view: viewRef.current,
      hideCursors: true,
      resolvedImages: imagesRef.current,
    });
  }, [state]);

  const fit = useCallback(() => {
    const bounds = sharedBoardBounds(state);
    viewRef.current = bounds ? fitViewportToBounds(bounds, limits()) : IDENTITY_VIEWPORT;
    draw();
  }, [state, draw, limits]);

  const zoom = (factor: number) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    viewRef.current = zoomViewport(viewRef.current, factor, { x: canvas.clientWidth / 2, y: canvas.clientHeight / 2 }, limits());
    draw();
  };

  // Frame the board once it arrives, and again when the window changes size.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    fit();
    const observer = new ResizeObserver(() => fit());
    observer.observe(canvas);
    return () => observer.disconnect();
  }, [fit]);

  // Pictures redraw the board as each one decodes.
  useEffect(() => {
    const controller = new AbortController();
    for (const { url, aliases } of images) {
      void loadImage(url, controller.signal).then((image) => {
        if (controller.signal.aborted) return;
        for (const alias of aliases) imagesRef.current[alias] = image;
        draw();
      }).catch(() => undefined);
    }
    return () => controller.abort();
  }, [images, loadImage, draw]);

  // Scrolling zooms around the pointer; the listener must be non-passive to keep the page still.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const rect = canvas.getBoundingClientRect();
      const factor = Math.exp(-event.deltaY * 0.0015);
      viewRef.current = zoomViewport(viewRef.current, factor, { x: event.clientX - rect.left, y: event.clientY - rect.top }, limits());
      draw();
    };
    canvas.addEventListener("wheel", onWheel, { passive: false });
    return () => canvas.removeEventListener("wheel", onWheel);
  }, [draw, limits]);

  const text = sharedBoardText(state);
  return (
    <main className={`shared-board${notice ? " shared-board-with-notice" : ""}`} id="main-content" tabIndex={-1}>
      <header className="shared-board-bar">
        <Link className="marketing-brand" href="/">Airboard</Link>
        <div className="shared-board-title">
          <h1>{title}</h1>
          <span className="shared-board-badge">View only</span>
        </div>
        <div className="shared-board-zoom" role="group" aria-label="Zoom">
          <button type="button" aria-label="Zoom out" onClick={() => zoom(1 / ZOOM_STEP)}>−</button>
          <button type="button" onClick={fit}>Fit</button>
          <button type="button" aria-label="Zoom in" onClick={() => zoom(ZOOM_STEP)}>+</button>
        </div>
        {actions}
      </header>
      {notice ? <p className="shared-board-notice" role="note">{notice}</p> : null}
      <canvas
        ref={canvasRef}
        className="shared-board-canvas"
        role="img"
        aria-label={`Board “${title}”. Drag to move around; scroll or use the zoom buttons to zoom.`}
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

export function decodeImage(url: string, signal: AbortSignal): Promise<HTMLImageElement> {
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
