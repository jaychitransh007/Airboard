"use client";

import {
  createGoogleMeetRuntime,
  describeGoogleMeetError,
  type GoogleMeetRuntime,
  type GoogleMeetSurface as GoogleMeetSurfaceKind,
} from "@airboard/integrations";
import { useEffect, useRef, useState } from "react";

type RuntimeState =
  | { status: "loading" }
  | { status: "ready"; runtime: GoogleMeetRuntime; correlationId: string }
  | { status: "error"; message: string; correlationId: string };

const CLOUD_PROJECT_NUMBER =
  process.env.NEXT_PUBLIC_GOOGLE_MEET_CLOUD_PROJECT_NUMBER?.trim() ?? "";

/**
 * Meet still requires configured side-panel/main-stage URLs for the installed
 * add-on. They are now lifecycle exits, not drawing surfaces: the Chrome
 * extension owns a hidden renderer and publishes Airboard only on the user's
 * outgoing camera.
 */
export function GoogleMeetSurface({ surface }: { surface: GoogleMeetSurfaceKind }) {
  const [runtimeState, setRuntimeState] = useState<RuntimeState>({ status: "loading" });
  const [closeError, setCloseError] = useState<string | null>(null);
  const closeRequestedRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    const correlationId = createCorrelationId();

    if (!CLOUD_PROJECT_NUMBER) {
      setRuntimeState({
        status: "error",
        message: "NEXT_PUBLIC_GOOGLE_MEET_CLOUD_PROJECT_NUMBER is not configured.",
        correlationId,
      });
      return () => {
        cancelled = true;
      };
    }

    void createGoogleMeetRuntime({ cloudProjectNumber: CLOUD_PROJECT_NUMBER, surface })
      .then((runtime) => {
        if (!cancelled) {
          setRuntimeState({ status: "ready", runtime, correlationId });
        }
      })
      .catch((error) => {
        if (!cancelled) {
          setRuntimeState({
            status: "error",
            message: describeGoogleMeetError(error),
            correlationId,
          });
        }
      });

    return () => {
      cancelled = true;
    };
  }, [surface]);

  useEffect(() => {
    if (runtimeState.status !== "ready" || closeRequestedRef.current) {
      return;
    }
    closeRequestedRef.current = true;
    let cancelled = false;
    const exitDedicatedSurface = async () => {
      try {
        if (surface === "main-stage") {
          // Clean up an activity created by an older Airboard revision.
          await runtimeState.runtime.endActivity().catch(() => undefined);
        }
        await runtimeState.runtime.closeAddon();
      } catch (error) {
        if (!cancelled) {
          setCloseError(describeGoogleMeetError(error));
        }
      }
    };
    void exitDedicatedSurface();
    return () => {
      cancelled = true;
    };
  }, [runtimeState, surface]);

  if (runtimeState.status === "loading") {
    return <MeetStatusPage title="Moving Airboard to your camera…" />;
  }
  if (runtimeState.status === "error") {
    return (
      <MeetStatusPage
        title="Airboard could not initialize in Google Meet"
        detail={runtimeState.message}
        correlationId={runtimeState.correlationId}
      />
    );
  }

  return (
    <MeetStatusPage
      title="Airboard is on your camera"
      detail={
        closeError
          ? `Meet could not close this legacy activity automatically: ${closeError}`
          : "This dedicated surface is closing. The extension keeps the neon canvas on your video."
      }
      {...(closeError ? { correlationId: runtimeState.correlationId } : {})}
    />
  );
}

function MeetStatusPage({
  title,
  detail,
  correlationId,
}: {
  title: string;
  detail?: string;
  correlationId?: string;
}) {
  return (
    <main className="meet-status-page">
      <h1>{title}</h1>
      {detail ? <p>{detail}</p> : null}
      {correlationId ? <small>Diagnostic ID: {correlationId}</small> : null}
    </main>
  );
}

function createCorrelationId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `meet-${Date.now().toString(36)}`;
}
