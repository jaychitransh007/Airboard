"use client";

import { useEffect, useState } from "react";
import { AIRBOARD_API_URL } from "../../platform/config";
import { AirboardPrototype } from "./AirboardPrototype";

type TestAirboardHarnessProps = {
  surface: "standalone" | "meet-side-panel" | "meet-main-stage";
  meetingProvider?: "google_meet";
  providerMeetingId?: string;
  embeddedMediaCapture?: boolean;
  headlessMeetOverlay?: boolean;
  desktopOverlay?: boolean;
};

/**
 * Browser-test-only authenticated mount.
 *
 * Production board sessions require a verified Supabase, installation, or
 * signed development identity. The E2E API deliberately runs in loopback
 * development mode, so this harness obtains the same short-lived signed
 * credential a local developer uses instead of weakening the session route.
 */
export function TestAirboardHarness(props: TestAirboardHarnessProps) {
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void fetch(new URL("/auth/development", AIRBOARD_API_URL), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    })
      .then(async (response) => {
        if (!response.ok) throw new Error(`DEVELOPMENT_AUTH_${response.status}`);
        return response.json() as Promise<{ accessToken?: string }>;
      })
      .then((result) => {
        if (!result.accessToken) throw new Error("DEVELOPMENT_AUTH_TOKEN_MISSING");
        if (active) setAccessToken(result.accessToken);
      })
      .catch((caught) => {
        if (active) {
          setError(caught instanceof Error ? caught.message : "DEVELOPMENT_AUTH_FAILED");
        }
      });
    return () => {
      active = false;
    };
  }, []);

  if (error) {
    return <main data-testid="test-harness-error">Test harness failed: {error}</main>;
  }
  if (!accessToken) {
    return <main data-testid="test-harness-loading">Preparing signed test identity…</main>;
  }
  return <AirboardPrototype {...props} accessToken={accessToken} accountUserId="local-owner" />;
}
