"use client";

import { useEffect } from "react";

/**
 * Replaces the root layout when it fails, so it cannot rely on globals.css or
 * providers; styles stay inline.
 */
export default function GlobalError({ error }: { error: Error & { digest?: string } }) {
  useEffect(() => {
    console.error("Airboard root error", error);
  }, [error]);
  return (
    <html lang="en">
      <body
        style={{
          display: "grid",
          placeContent: "center",
          gap: 12,
          minHeight: "100vh",
          margin: 0,
          padding: 30,
          background: "#f7f5fb",
          color: "#4b4760",
          fontFamily: "system-ui, -apple-system, Segoe UI, sans-serif",
          textAlign: "center",
        }}
      >
        <strong style={{ color: "#17142b", fontSize: 21 }}>Airboard couldn't load.</strong>
        <span>Reload the page to try again. Your saved boards are not affected.</span>
        <span>
          <button
            type="button"
            onClick={() => window.location.reload()}
            style={{
              minHeight: 40,
              padding: "8px 18px",
              border: 0,
              borderRadius: 10,
              background: "#6d4ee6",
              color: "#fff",
              font: "inherit",
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            Reload
          </button>
        </span>
        {error.digest ? <small>Reference: {error.digest}</small> : null}
      </body>
    </html>
  );
}
