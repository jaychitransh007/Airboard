"use client";

import { useState } from "react";
import Link from "next/link";
import { AirboardPrototype } from "../board/AirboardPrototype";
import { guestDisplayName, LIVE_LINK_HOURS, liveJoinFailure } from "../board/shareLinks";
import { useAirboardAuth } from "../../platform/auth";
import { MaintenanceBanner } from "./MaintenanceBanner";

type JoinFailure = ReturnType<typeof liveJoinFailure>;

/**
 * Opens a live board from a Share link. Guests need no account: the link's
 * join token admits them to the host's running session, and the host's saved
 * board keeps their edits. Signed-in people join under their own name and keep
 * Airo's voice and AI features.
 */
export function LiveBoardJoin({ sessionId, joinToken }: { sessionId: string; joinToken: string | null }) {
  const auth = useAirboardAuth();
  const [failure, setFailure] = useState<JoinFailure | null>(joinToken ? null : "expired");

  if (failure) return <LiveJoinProblem failure={failure} />;
  if (auth.loading) return <div className="product-loading">Joining the live board…</div>;
  return (
    <div className="canvas-route">
      <MaintenanceBanner />
      <AirboardPrototype
        surface="standalone"
        initialBoardSessionId={sessionId}
        liveGuest
        boardTitle="Live board"
        participantName={guestDisplayName(auth.account?.profile.displayName)}
        {...(auth.accessToken ? { accessToken: auth.accessToken } : {})}
        {...(auth.account ? { accountUserId: auth.account.profile.id } : {})}
        onLiveJoinFailed={(message) => setFailure(liveJoinFailure(message))}
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
    ended: {
      title: "This live session has ended",
      body: "Ask the person who shared it to open their board and send a fresh live link from Share.",
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
    <div className="product-loading" role="alert">
      <strong>{copy.title}</strong>
      <span>{copy.body}</span>
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
    </div>
  );
}
