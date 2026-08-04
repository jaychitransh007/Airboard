export type HeadlessMeetSpeechEngine =
  | "loading"
  | "realtime"
  | "browser-fallback"
  | "unavailable";

export type HeadlessMeetVoiceStartState = {
  headlessMeetOverlay: boolean;
  bridgeReady: boolean;
  authenticationReady: boolean;
  credential: string | null;
  speechSupported: boolean;
  speechEngine: HeadlessMeetSpeechEngine;
  hasActiveSession: boolean;
  requestedCredential: string | null;
};

/**
 * The Meet engine has no voice controls, so it starts automatically. Keep the
 * decision pure and credential-aware: hydration must never consume the single
 * start attempt before the extension has delivered its installation token.
 */
export function shouldStartHeadlessMeetVoice(
  state: HeadlessMeetVoiceStartState,
): boolean {
  return (
    state.headlessMeetOverlay &&
    state.bridgeReady &&
    state.authenticationReady &&
    Boolean(state.credential) &&
    state.speechSupported &&
    state.speechEngine === "realtime" &&
    !state.hasActiveSession &&
    state.requestedCredential !== state.credential
  );
}

export function headlessMeetVoiceRetryDelayMs(failedAttempts: number): number {
  const boundedAttempts = Math.max(0, Math.min(5, Math.floor(failedAttempts)));
  return Math.min(30_000, 1_000 * 2 ** boundedAttempts);
}

export function shouldRetryHeadlessMeetVoiceAfterEnd(
  headlessMeetOverlay: boolean,
  reason: "stopped" | "aborted" | "error" | "closed",
): boolean {
  return (
    headlessMeetOverlay &&
    (reason === "error" || reason === "closed" || reason === "stopped")
  );
}

/**
 * A successful `available: false` response is a durable configuration decision
 * and is handled before this helper is called. For request failures, retry only
 * statuses that can reasonably recover without an operator changing the
 * deployment; network/parse failures have no reliable status and remain
 * retryable.
 */
export function shouldRetryHeadlessMeetSpeechConfig(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  const statusMatch = message.match(/\((\d{3})\)/);
  if (!statusMatch) {
    return true;
  }
  const status = Number(statusMatch[1]);
  return status === 408 || status === 425 || status === 429 || status >= 500;
}
