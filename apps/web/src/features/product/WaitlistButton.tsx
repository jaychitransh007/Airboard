"use client";

import { OneTapRequestButton } from "./OneTapRequestButton";
import { waitlistRequest, waitlistStorageKey, type WaitlistSurface } from "./supportRequests";

export function WaitlistButton({ surface, primary = false }: { surface: WaitlistSurface; primary?: boolean }) {
  return (
    <OneTapRequestButton
      request={waitlistRequest(surface)}
      storageKey={waitlistStorageKey(surface)}
      label="Notify me"
      doneLabel="We'll let you know"
      primary={primary}
    />
  );
}
