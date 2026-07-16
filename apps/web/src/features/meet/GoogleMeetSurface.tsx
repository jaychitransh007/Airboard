"use client";

import {
  createGoogleMeetRuntime,
  describeGoogleMeetError,
  probeMediaCaptureCapability,
  serializeGoogleMeetActivityData,
  type GoogleMeetActivityData,
  type GoogleMeetRuntime,
  type GoogleMeetSurface as GoogleMeetSurfaceKind,
} from "@airboard/integrations";
import { useCallback, useEffect, useState } from "react";
import { AirboardPrototype } from "../board/AirboardPrototype";
import { resolveMeetActivityState } from "./meetActivityState";

type RuntimeState =
  | { status: "loading" }
  | {
      status: "ready";
      runtime: GoogleMeetRuntime;
      activity: GoogleMeetActivityData | null;
      correlationId: string;
    }
  | { status: "error"; message: string; correlationId: string };

const CLOUD_PROJECT_NUMBER =
  process.env.NEXT_PUBLIC_GOOGLE_MEET_CLOUD_PROJECT_NUMBER?.trim() ?? "";

export function GoogleMeetSurface({ surface }: { surface: GoogleMeetSurfaceKind }) {
  const [runtimeState, setRuntimeState] = useState<RuntimeState>({ status: "loading" });
  const [boardSessionId, setBoardSessionId] = useState<string | null>(null);
  const [activityStarted, setActivityStarted] = useState(false);
  const [activityError, setActivityError] = useState<string | null>(null);
  // Whether Meet delegates camera/microphone permission to this frame decides
  // if gesture/voice run embedded or in the companion window. Probed after
  // mount so server rendering and hydration agree.
  const [embeddedMediaCapture, setEmbeddedMediaCapture] = useState(false);

  useEffect(() => {
    setEmbeddedMediaCapture(probeMediaCaptureCapability() === "embedded");
  }, []);

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

    void createGoogleMeetRuntime({
      cloudProjectNumber: CLOUD_PROJECT_NUMBER,
      surface,
    })
      .then(async (runtime) => {
        const startingState = await runtime.readActivityStartingState();
        const { activity, staleActivityNotice } = resolveMeetActivityState({
          surface,
          additionalData: startingState?.additionalData,
        });
        if (!cancelled) {
          setRuntimeState({ status: "ready", runtime, activity, correlationId });
          setBoardSessionId(activity?.boardSessionId ?? null);
          setActivityStarted(Boolean(activity));
          setActivityError(staleActivityNotice);
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

  const handleBoardSessionReady = useCallback(
    (session: { boardSessionId: string }) => {
      setBoardSessionId(session.boardSessionId);
    },
    [],
  );

  const startMeetActivity = useCallback(async () => {
    if (runtimeState.status !== "ready" || !boardSessionId || activityStarted) {
      return;
    }
    setActivityError(null);
    try {
      await runtimeState.runtime.startActivity({
        mainStageUrl: new URL("/meet/main-stage", window.location.origin).toString(),
        additionalData: serializeGoogleMeetActivityData({ boardSessionId }),
      });
      setActivityStarted(true);
    } catch (error) {
      setActivityError(describeGoogleMeetError(error));
    }
  }, [activityStarted, boardSessionId, runtimeState]);

  if (runtimeState.status === "loading") {
    return <MeetStatusPage title="Connecting to Google Meet…" />;
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
    <div className={`meet-surface-shell meet-surface-${surface}`}>
      <AirboardPrototype
        surface={surface === "side-panel" ? "meet-side-panel" : "meet-main-stage"}
        meetingProvider="google_meet"
        providerMeetingId={runtimeState.runtime.meetingInfo.meetingId}
        initialBoardSessionId={runtimeState.activity?.boardSessionId ?? null}
        onBoardSessionReady={handleBoardSessionReady}
        embeddedMediaCapture={embeddedMediaCapture}
      />
      {surface === "side-panel" ? (
        <footer className="meet-activity-footer" aria-live="polite">
          <div>
            <strong>{activityStarted ? "Activity open" : "Ready for the meeting"}</strong>
            <span>
              {activityStarted
                ? "The shared board is running in Meet."
                : "Open Airboard in the main stage for participants."}
            </span>
          </div>
          <button
            type="button"
            className="primary"
            disabled={!boardSessionId || activityStarted}
            onClick={() => void startMeetActivity()}
          >
            {activityStarted
              ? "Meet activity ready"
              : boardSessionId
                ? "Start Airboard activity"
                : "Preparing board…"}
          </button>
        </footer>
      ) : null}
      {activityError ? (
        <p className="meet-activity-error" role="alert">
          {activityError}
        </p>
      ) : null}
    </div>
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
