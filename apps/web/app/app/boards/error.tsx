"use client";

import Link from "next/link";
import { useEffect } from "react";

/**
 * Keeps a canvas failure from white-screening a live meeting. The board's
 * unmount flushes any pending save, so reopening restores the latest saved
 * version rather than an empty canvas.
 */
export default function BoardError({ error }: { error: Error & { digest?: string } }) {
  useEffect(() => {
    console.error("Airboard canvas error", error);
  }, [error]);
  return (
    <div className="product-loading" role="alert">
      <strong>The canvas hit an unexpected problem.</strong>
      <span>Airboard saves as you work, so reopening the board brings back your latest saved version.</span>
      <span className="product-loading-actions">
        <button className="button button-primary" type="button" onClick={() => window.location.reload()}>
          Reopen board
        </button>
        <Link className="button button-quiet" href="/app/boards">
          Go to my boards
        </Link>
      </span>
      {error.digest ? <small>Reference: {error.digest}</small> : null}
    </div>
  );
}
