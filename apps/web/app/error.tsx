"use client";

import Link from "next/link";
import { useEffect } from "react";

/** Last-resort boundary for any route below the root layout. */
export default function RouteError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("Airboard route error", error);
  }, [error]);
  return (
    <main className="product-loading" id="main-content" tabIndex={-1}>
      <h1>Something went wrong on this page.</h1>
      <span role="alert">Try again. If it keeps happening, contact support and include the reference below.</span>
      <span className="product-loading-actions">
        <button className="button button-primary" type="button" onClick={reset}>
          Try again
        </button>
        <Link className="button button-quiet" href="/">
          Go to the home page
        </Link>
      </span>
      {error.digest ? <small>Reference: {error.digest}</small> : null}
    </main>
  );
}
