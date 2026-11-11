"use client";

import { useState } from "react";
import Link from "next/link";
import { AirboardPrototype } from "../board/AirboardPrototype";
import { guestDisplayName, LIVE_LINK_HOURS, liveJoinFailure } from "../board/shareLinks";
import { useAirboardAuth } from "../../platform/auth";
import { LiveBoardViewer } from "./LiveBoardViewer";
import { MaintenanceBanner } from "./MaintenanceBanner";

type JoinFailure = ReturnType<typeof liveJoinFailure>;

/**
 * Opens a live board from a Share link. Guests need no account: the link's
 * join token admits them to the host's running session, and the host's saved
 * board keeps their edits. Signed-in people join under their own name and keep
 * Airo's voice and AI features. The host decides in Share whether people can
 * edit or only watch; this page follows that choice as it changes.
 */
export function LiveBoardJoin({ sessionId, joinToken }: { sessionId: string; joinToken: string | null }) {
  const auth = useAirboardAuth();
  const [failure, setFailure] = useState<JoinFailure | null>(joinToken ? null : "expired");
  const [mode, setMode] = useState<"view" | "edit">("view");

  if (failure) return <LiveJoinProblem failure={failure} />;
  if (auth.loading || !joinToken) return <div className="product-loading">Joining the live board…</div>;
  const displayName = guestDisplayName(auth.account?.profile.displayName);
  if (mode === "view") {
    return (
      <div className="canvas-route">
        <MaintenanceBanner />
        <LiveBoardViewer
          sessionId={sessionId}
          joinToken={joinToken}
          displayName={displayName}
          {...(auth.accessToken ? { accessToken: auth.accessToken } : {})}
          {...(auth.account ? { accountUserId: auth.account.profile.id } : {})}
          onEditingAllowed={() => setMode("edit")}
          onJoinFailed={(message) => setFailure(liveJoinFailure(message))}
        />
      </div>
    );
  }
  return (
    <div className="canvas-route">
      <MaintenanceBanner />
      <AirboardPrototype
        surface="standalone"
        initialBoardSessionId={sessionId}
        liveGuest
        boardTitle="Live board"
        participantName={displayName}
        {...(auth.accessToken ? { accessToken: auth.accessToken } : {})}
        {...(auth.account ? { accountUserId: auth.account.profile.id } : {})}
        // A signed-in guest's own camera and voice settings apply here too.
        {...(auth.account?.policy ? { organizationPolicy: auth.account.policy } : {})}
        {...(auth.account?.profile.preferences ? { initialPreferences: auth.account.profile.preferences } : {})}
        onLiveJoinFailed={(message) => setFailure(liveJoinFailure(message))}
        onGuestEditingChange={(allowed) => {
          if (!allowed) setMode("view");
        }}
      />
    </div>
  );
}

function LiveJoinProblem({ failure }: { failure: JoinFailure }) {
  const copy = {
    expired: {
      title: "This live link has expired",
      body: `Live links work for ${LIVE_LINK_HOURS} hours. Ask the person who shared it to copy a fresh one from Share.`,
    },
    replaced: {
      title: "This live link was replaced",
      body: "The person who shared it made a new link. Ask them for the new one.",
    },
    ended: {
      title: "This live session has ended",
      body: "Ask the person who shared it to open their board and send a fresh live link from Share.",
    },
    members_only: {
      title: "Only this workspace's members can join",
      body: "The board's workspace has turned off guests. Sign in with the account your workspace invited, then open the link again.",
    },
    maintenance: {
      title: "Airboard is down for a short upgrade",
      body: "Live boards are paused for a few minutes. Try this link again shortly.",
    },
    offline: {
      title: "We couldn't reach the live board",
      body: "Check your connection, then try again.",
    },
  }[failure];
  const retryable = failure === "offline" || failure === "maintenance";
  return (
    <main className="product-loading">
      <h1>{copy.title}</h1>
      <span role="alert">{copy.body}</span>
      <span className="product-loading-actions">
        {retryable ? (
          <button type="button" className="button button-primary" onClick={() => window.location.reload()}>
            Try again
          </button>
        ) : null}
        <Link className={`button ${retryable ? "button-quiet" : "button-primary"}`} href="/">
          Go to Airboard
        </Link>
      </span>
    </main>
  );
}
