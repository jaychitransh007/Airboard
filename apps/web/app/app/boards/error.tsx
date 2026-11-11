"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect } from "react";
import { isImmersiveBoardPath } from "../../../src/features/product/productRouting";

/**
 * Keeps a canvas failure from white-screening a live meeting. The board's
 * unmount flushes any pending save, so reopening restores the latest saved
 * version rather than an empty canvas.
 */
export default function BoardError({ error }: { error: Error & { digest?: string } }) {
  useEffect(() => {
    console.error("Airboard canvas error", error);
  }, [error]);
  // On a board the app shell leaves the main landmark to the page; on the
  // library it already provides one.
  const Container = isImmersiveBoardPath(usePathname()) ? "main" : "div";
  return (
    <Container className="product-loading">
      <h1>The canvas hit an unexpected problem.</h1>
      <span role="alert">Airboard saves as you work, so reopening the board brings back your latest saved version.</span>
      <span className="product-loading-actions">
        <button className="button button-primary" type="button" onClick={() => window.location.reload()}>
          Reopen board
        </button>
        <Link className="button button-quiet" href="/app">
          Go to my boards
        </Link>
      </span>
      {error.digest ? <small>Reference: {error.digest}</small> : null}
    </Container>
  );
}
