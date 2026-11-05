"use client";

import { useEffect, useState } from "react";
import { airboardApi } from "../../platform/api";
import { useAirboardAuth } from "../../platform/auth";
import { pilotExtensionRequest, pilotExtensionStorageKey, type SupportRequestBody } from "./supportRequests";

/**
 * Files a support request in one tap and remembers, per browser, that this
 * person already asked, so the button reads as done when they come back.
 */
export function OneTapRequestButton({
  request,
  storageKey,
  label,
  doneLabel,
  primary = false,
}: {
  request: SupportRequestBody;
  storageKey: string;
  label: string;
  doneLabel: string;
  primary?: boolean;
}) {
  const auth = useAirboardAuth();
  const [state, setState] = useState<"idle" | "saving" | "done" | "error">("idle");

  useEffect(() => {
    try {
      setState(window.localStorage.getItem(storageKey) ? "done" : "idle");
    } catch {
      // Remembering is a convenience; asking again is harmless.
    }
  }, [storageKey]);

  const send = async () => {
    if (!auth.accessToken || state === "saving" || state === "done") return;
    setState("saving");
    try {
      await airboardApi("/support/requests", {
        method: "POST",
        accessToken: auth.accessToken,
        body: JSON.stringify(request),
      });
      try {
        window.localStorage.setItem(storageKey, "done");
      } catch {
        // See above.
      }
      setState("done");
    } catch {
      setState("error");
    }
  };

  if (state === "done") {
    return <span className="one-tap-request-done" role="status">✓ {doneLabel}</span>;
  }
  return (
    <span className="one-tap-request">
      <button
        type="button"
        className={`button ${primary ? "button-primary" : "button-quiet"}`}
        disabled={state === "saving"}
        onClick={() => void send()}
      >
        {state === "saving" ? "Sending…" : label}
      </button>
      {state === "error" ? <small role="alert">That didn&apos;t send. Try again.</small> : null}
    </span>
  );
}

/** Asks the pilot team to extend an ended pilot. */
export function PilotExtensionButton({ primary = false }: { primary?: boolean }) {
  const auth = useAirboardAuth();
  return (
    <OneTapRequestButton
      request={pilotExtensionRequest()}
      storageKey={pilotExtensionStorageKey(auth.account?.entitlement?.validUntil)}
      label="Ask for more pilot time"
      doneLabel="Asked. We'll be in touch."
      primary={primary}
    />
  );
}
