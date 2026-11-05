"use client";

import { useEffect, useRef, useState } from "react";
import { useModalFocus } from "../../platform/modalFocus";
import { LIVE_LINK_HOURS, type LiveStartFailure } from "./shareLinks";

export type BoardVisibility = "private" | "organization" | "link";

/** Durable-board access, present only when the board is saved to a workspace. */
export type BoardShareAccess = {
  visibility: BoardVisibility;
  /** Only the owner decides who can open the board. */
  canChange: boolean;
  /** Personal workspaces have nobody else to share with. */
  personal: boolean;
  workspaceName: string;
  boardLink: string;
  onChange: (visibility: "private" | "organization") => Promise<void>;
};

type CopyTarget = "live" | "board";

export function ShareDialog({
  boardTitle,
  liveLink,
  liveUnavailable,
  access,
  onDownloadPng,
  onCopyImage,
  onClose,
}: {
  boardTitle: string;
  /** Null until the live session connects (or when it could not). */
  liveLink: string | null;
  /** Why the live session could not start, so no link is coming; null while it may. */
  liveUnavailable: LiveStartFailure | null;
  access?: BoardShareAccess;
  onDownloadPng: () => void;
  onCopyImage: () => void;
  onClose: () => void;
}) {
  const [copied, setCopied] = useState<CopyTarget | null>(null);
  const [copyError, setCopyError] = useState<string | null>(null);
  const [visibilityStatus, setVisibilityStatus] = useState<"idle" | "saving" | "error">("idle");
  const firstActionRef = useRef<HTMLButtonElement | null>(null);
  const copiedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    firstActionRef.current?.focus();
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      window.removeEventListener("keydown", closeOnEscape);
      if (copiedTimerRef.current) clearTimeout(copiedTimerRef.current);
    };
  }, [onClose]);
  // The effect above already put focus on "Copy live link"; this adds the
  // Tab trap and hands focus back to the Share button on close.
  const dialogRef = useRef<HTMLElement | null>(null);
  useModalFocus(dialogRef, true);

  const copy = async (target: CopyTarget, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopyError(null);
      setCopied(target);
      if (copiedTimerRef.current) clearTimeout(copiedTimerRef.current);
      copiedTimerRef.current = setTimeout(() => setCopied(null), 2_400);
    } catch {
      setCopyError("Your browser blocked copying. Select the link below and copy it yourself.");
    }
  };

  const changeVisibility = async (next: "private" | "organization") => {
    if (!access || !access.canChange || visibilityStatus === "saving") return;
    if ((access.visibility === "private") === (next === "private")) return;
    setVisibilityStatus("saving");
    try {
      await access.onChange(next);
      setVisibilityStatus("idle");
    } catch {
      setVisibilityStatus("error");
    }
  };

  const shared = access ? access.visibility !== "private" : false;

  return (
    <div
      className="board-lifecycle-backdrop"
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        ref={dialogRef}
        tabIndex={-1}
        className="board-lifecycle-dialog share-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="share-dialog-title"
      >
        <header className="share-dialog-header">
          <div>
            <span className="eyebrow">Share</span>
            <h2 id="share-dialog-title">Share “{boardTitle}”</h2>
          </div>
          <button type="button" className="share-dialog-close" aria-label="Close" onClick={onClose}>
            ×
          </button>
        </header>

        <section className="share-dialog-section" aria-labelledby="share-live-title">
          <h3 id="share-live-title">Edit together now</h3>
          <p>
            Anyone with this link can join and edit with you, no account needed. It works for{" "}
            {LIVE_LINK_HOURS} hours.
          </p>
          <div className="share-dialog-row">
            <button
              ref={firstActionRef}
              type="button"
              className="share-dialog-primary"
              disabled={!liveLink}
              onClick={() => liveLink && void copy("live", liveLink)}
            >
              {copied === "live"
                ? "Link copied"
                : liveLink
                  ? "Copy live link"
                  : liveUnavailable
                    ? "Live link unavailable"
                    : "Connecting…"}
            </button>
          </div>
          {!liveLink && liveUnavailable === "pilot_ended" ? (
            <p className="share-dialog-note">
              Your free pilot has ended, so you can&apos;t start live sessions. This board still
              saves, and you can still download a picture.{" "}
              <a href="/app/billing">Ask for more pilot time</a>
            </p>
          ) : null}
          {!liveLink && liveUnavailable === "maintenance" ? (
            <p className="share-dialog-note">
              Airboard is down for a short upgrade, so live links are paused for a few minutes.
              You can still download a picture.
            </p>
          ) : null}
          {!liveLink && liveUnavailable === "offline" ? (
            <p className="share-dialog-note">
              The board could not reach the live server, so nobody can join right now. Your work
              is still saved; reload to try again.
            </p>
          ) : null}
          {copyError && liveLink ? (
            <>
              <p className="share-dialog-note" role="alert">{copyError}</p>
              <input
                className="share-dialog-link"
                readOnly
                value={liveLink}
                aria-label="Live link"
                onFocus={(event) => event.currentTarget.select()}
              />
            </>
          ) : null}
        </section>

        {access ? (
          <section className="share-dialog-section" aria-labelledby="share-access-title">
            <h3 id="share-access-title">Who can open this board later</h3>
            {access.personal ? (
              <p>
                Boards in your personal workspace stay private to you.{" "}
                {liveUnavailable === "pilot_ended" || liveUnavailable === "maintenance"
                  ? "Download a picture to send to others."
                  : "Use the live link to work with others, or download a picture to send."}
              </p>
            ) : (
              <>
                <div className="share-dialog-choices" role="radiogroup" aria-label="Board access">
                  <label className={!shared ? "selected" : undefined}>
                    <input
                      type="radio"
                      name="board-access"
                      checked={!shared}
                      disabled={!access.canChange || visibilityStatus === "saving"}
                      onChange={() => void changeVisibility("private")}
                    />
                    <span>
                      <strong>Only you</strong>
                      <small>Nobody else sees it in their board library.</small>
                    </span>
                  </label>
                  <label className={shared ? "selected" : undefined}>
                    <input
                      type="radio"
                      name="board-access"
                      checked={shared}
                      disabled={!access.canChange || visibilityStatus === "saving"}
                      onChange={() => void changeVisibility("organization")}
                    />
                    <span>
                      <strong>Everyone in {access.workspaceName}</strong>
                      <small>Members find it under Shared and can edit it.</small>
                    </span>
                  </label>
                </div>
                {!access.canChange ? (
                  <p className="share-dialog-note">Only the person who made this board can change who opens it.</p>
                ) : null}
                {visibilityStatus === "saving" ? (
                  <p className="share-dialog-note" role="status">Saving…</p>
                ) : null}
                {visibilityStatus === "error" ? (
                  <p className="share-dialog-note board-lifecycle-error" role="alert">
                    Access did not change. Check your connection and try again.
                  </p>
                ) : null}
                {shared ? (
                  <div className="share-dialog-row">
                    <button type="button" onClick={() => void copy("board", access.boardLink)}>
                      {copied === "board" ? "Link copied" : "Copy board link"}
                    </button>
                    <span className="share-dialog-hint">For workspace members</span>
                  </div>
                ) : null}
              </>
            )}
          </section>
        ) : null}

        <section className="share-dialog-section" aria-labelledby="share-picture-title">
          <h3 id="share-picture-title">Send a picture</h3>
          <div className="share-dialog-row">
            <button type="button" onClick={onDownloadPng}>Download PNG</button>
            <button type="button" onClick={onCopyImage}>Copy image</button>
            <span className="share-dialog-hint">Drop it into chat, email or slides</span>
          </div>
        </section>
      </section>
    </div>
  );
}
