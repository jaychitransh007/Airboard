"use client";

import { useEffect, useState } from "react";

export type ViewLink = { id: string; createdAt: string; expiresAt: string | null };
export type ViewLinkLifetime = 7 | 30 | null;

/** Making and turning off view-only links for a saved board (its owner only). */
export type ViewLinkControls = {
  list: () => Promise<ViewLink[]>;
  create: (expiresInDays: ViewLinkLifetime) => Promise<{ link: ViewLink; url: string }>;
  revoke: (id: string) => Promise<void>;
};

const LIFETIMES: Array<{ value: string; label: string; days: ViewLinkLifetime }> = [
  { value: "7", label: "7 days", days: 7 },
  { value: "30", label: "30 days", days: 30 },
  { value: "never", label: "Until I turn it off", days: null },
];

const formatDate = (iso: string) =>
  new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });

export function ViewLinksSection({ controls, canCreate }: { controls: ViewLinkControls; canCreate: boolean }) {
  const [links, setLinks] = useState<ViewLink[] | null>(null);
  const [lifetime, setLifetime] = useState("7");
  const [created, setCreated] = useState<{ id: string; url: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  useEffect(() => {
    if (!canCreate) return;
    let active = true;
    controls.list()
      .then((list) => active && setLinks(list))
      .catch(() => active && setProblem("Your view-only links could not be loaded. Check your connection and reopen Share."));
    return () => { active = false; };
  }, [canCreate, controls]);

  const create = async () => {
    setBusy(true);
    setProblem(null);
    try {
      const days = LIFETIMES.find((option) => option.value === lifetime)?.days ?? 7;
      const result = await controls.create(days);
      setCreated({ id: result.link.id, url: result.url });
      setLinks((current) => [result.link, ...(current ?? [])]);
      setStatus("View-only link created. Copy it now; Airboard shows each link only once.");
    } catch (caught) {
      const code = caught instanceof Error ? caught.message : "";
      setProblem(
        /SHARE_LINK_LIMIT/.test(code)
          ? "This board already has 20 links. Turn one off to make another."
          : /EXTERNAL_GUESTS_DISABLED/.test(code)
            ? "Your workspace admin turned off sharing with people outside the workspace."
            : /BOARD_READ_ONLY_ROLE/.test(code)
              ? "Your role in this workspace can view boards but not share them."
              : "The link was not created. Check your connection and try again.",
      );
    } finally {
      setBusy(false);
    }
  };

  const copy = async () => {
    if (!created) return;
    try {
      await navigator.clipboard.writeText(created.url);
      setStatus("View-only link copied.");
    } catch {
      setStatus("Your browser blocked copying. Select the link and copy it yourself.");
    }
  };

  const revoke = async (id: string) => {
    setBusy(true);
    setProblem(null);
    try {
      await controls.revoke(id);
      setLinks((current) => (current ?? []).filter((link) => link.id !== id));
      if (created?.id === id) setCreated(null);
      setStatus("Link turned off. Anyone who opens it now sees that it no longer works.");
    } catch {
      setProblem("The link is still on. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="share-dialog-section" aria-labelledby="share-view-title">
      <h3 id="share-view-title">Anyone with the link can view</h3>
      {!canCreate ? (
        <p className="share-dialog-note">Only the person who made this board can create view-only links.</p>
      ) : (
        <>
          <p>People open the saved board without an account. They can look around and zoom, but not edit.</p>
          <div className="share-dialog-row">
            <label className="share-dialog-lifetime">
              <span>Link lasts</span>
              <select value={lifetime} disabled={busy} onChange={(event) => setLifetime(event.target.value)}>
                {LIFETIMES.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
              </select>
            </label>
            <button type="button" disabled={busy} onClick={() => void create()}>Create view-only link</button>
          </div>
          {created ? (
            <div className="share-dialog-row">
              <input
                className="share-dialog-link"
                readOnly
                value={created.url}
                aria-label="View-only link"
                onFocus={(event) => event.currentTarget.select()}
              />
              <button type="button" onClick={() => void copy()}>Copy link</button>
            </div>
          ) : null}
          {links?.length ? (
            <ul className="share-dialog-links" aria-label="Active view-only links">
              {links.map((link) => (
                <li key={link.id}>
                  <span>
                    Made {formatDate(link.createdAt)} · {link.expiresAt ? `ends ${formatDate(link.expiresAt)}` : "no end date"}
                  </span>
                  <button type="button" disabled={busy} onClick={() => void revoke(link.id)}>Turn off</button>
                </li>
              ))}
            </ul>
          ) : null}
          <p className="share-dialog-note" role="status">{status ?? ""}</p>
          <p className="share-dialog-note board-lifecycle-error" role="alert">{problem ?? ""}</p>
        </>
      )}
    </section>
  );
}
