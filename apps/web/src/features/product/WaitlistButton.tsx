"use client";

import { useEffect, useState } from "react";
import { airboardApi } from "../../platform/api";
import { useAirboardAuth } from "../../platform/auth";
import { waitlistRequest, waitlistStorageKey, type WaitlistSurface } from "./surfaceWaitlist";

export function WaitlistButton({ surface, primary = false }: { surface: WaitlistSurface; primary?: boolean }) {
  const auth = useAirboardAuth();
  const [state, setState] = useState<"idle" | "saving" | "joined" | "error">("idle");

  useEffect(() => {
    try {
      if (window.localStorage.getItem(waitlistStorageKey(surface)) === "joined") setState("joined");
    } catch {
      // Remembering is a convenience; asking again is harmless.
    }
  }, [surface]);

  const join = async () => {
    if (!auth.accessToken || state === "saving" || state === "joined") return;
    setState("saving");
    try {
      await airboardApi("/support/requests", {
        method: "POST",
        accessToken: auth.accessToken,
        body: JSON.stringify(waitlistRequest(surface)),
      });
      try {
        window.localStorage.setItem(waitlistStorageKey(surface), "joined");
      } catch {
        // See above.
      }
      setState("joined");
    } catch {
      setState("error");
    }
  };

  if (state === "joined") {
    return <span className="waitlist-joined" role="status">✓ We&apos;ll let you know</span>;
  }
  return (
    <span className="waitlist-action">
      <button
        type="button"
        className={`button ${primary ? "button-primary" : "button-quiet"}`}
        disabled={state === "saving"}
        onClick={() => void join()}
      >
        {state === "saving" ? "Saving…" : "Notify me"}
      </button>
      {state === "error" ? <small role="alert">That didn&apos;t save. Try again.</small> : null}
    </span>
  );
}
