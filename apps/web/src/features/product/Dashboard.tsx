"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { airboardApi } from "../../platform/api";
import { useAirboardAuth } from "../../platform/auth";
import { CHROME_EXTENSION_PUBLICLY_INSTALLABLE } from "../../platform/distribution";
import { BoardThumbnail } from "./BoardThumbnail";
import { boardCardDetail, type LibraryBoard } from "./boardLibrary";

type Board = LibraryBoard & { id: string; latest_version: number };
type Installation = { id: string; platform: string; status: string; last_success_at: string | null };

export function Dashboard() {
  const auth = useAirboardAuth();
  const [boards, setBoards] = useState<Board[]>([]);
  const [installations, setInstallations] = useState<Installation[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  useEffect(() => {
    if (!auth.accessToken) return;
    void Promise.all([
      airboardApi<{ boards: Board[] }>("/boards?preview=1", { accessToken: auth.accessToken }),
      airboardApi<{ installations: Installation[] }>("/integrations", { accessToken: auth.accessToken }),
    ])
      .then(([boardResult, installationResult]) => {
        setBoards(boardResult.boards);
        setInstallations(installationResult.installations);
        setLoadFailed(false);
      })
      // A failed load must not look like an empty account.
      .catch(() => setLoadFailed(true))
      .finally(() => setLoading(false));
  }, [auth.accessToken]);
  // Until the Meet extension is in the Chrome Web Store, health rows for
  // surfaces nobody can install are noise; they show once one can be used.
  const meetInstallable = CHROME_EXTENSION_PUBLICLY_INSTALLABLE;
  const meetConnected = installations.some((item) => item.platform === "chrome_meet" && item.status !== "revoked");

  return (
    <div className="dashboard-page">
      <section className="app-page-heading">
        <div><p className="eyebrow">Your visual workspace</p><h1>Good {dayPart()}, {firstName(auth.account?.profile.displayName)}.</h1><p>Start on Airboard or carry the same visual language into your next meeting.</p></div>
      </section>
      <section className="quick-start-grid">
        <Link className="quick-card primary" href="/app/boards/new?preflight=1"><span>＋</span><div><strong>New Airboard</strong><p>Start a board—type or say what you want to see.</p></div></Link>
        <Link className="quick-card" href="/app/integrations"><span>◉</span><div><strong>Use in Google Meet</strong><p>{meetInstallable || meetConnected ? "Put your diagram on your camera video." : "Coming soon. Share your board tab in any meeting today."}</p></div></Link>
        <Link className="quick-card" href="/app/integrations"><span>↗</span><div><strong>Desktop overlay</strong><p>Coming soon: draw over any app on your screen.</p></div></Link>
      </section>
      <section className="dashboard-section">
        <div className="section-heading"><div><h2>Recent boards</h2><p>Your content—not your camera or microphone—is saved here.</p></div><Link href="/app/boards">View all</Link></div>
        {loading ? <div className="empty-panel">Loading your workspace…</div> : loadFailed ? <div className="empty-panel" role="alert"><h3>Your boards didn't load</h3><p>Airboard couldn't be reached. Your boards are safe — reload to try again.</p><button className="button button-primary" type="button" onClick={() => window.location.reload()}>Reload</button></div> : boards.length ? (
          <div className="board-grid">{boards.slice(0, 6).map((board) => <Link className="board-card" href={`/app/boards/${board.id}`} key={board.id}><BoardThumbnail board={board} /><strong>{board.title}</strong><small>{boardCardDetail(board)}</small></Link>)}</div>
        ) : <div className="empty-panel"><span className="empty-icon">◇</span><h3>No saved boards yet</h3><p>Create your first Airboard—your free one-month pilot starts when it opens.</p><Link className="button button-primary" href="/app/boards/new?preflight=1">Create first board</Link></div>}
      </section>
      {meetInstallable || meetConnected ? <section className="dashboard-section">
        <div className="section-heading"><div><h2>Integration health</h2><p>See whether Airboard is ready before a real meeting.</p></div><Link href="/app/integrations">Manage</Link></div>
        <div className="health-row">
          <div><span className={installationStatus(installations, "chrome_meet")} /><div><strong>Google Meet overlay</strong><small>{installationText(installations, "chrome_meet")}</small></div></div>
          <div><span className="status-dot preview" /><div><strong>Zoom</strong><small>Coming soon</small></div></div>
          <div><span className="status-dot preview" /><div><strong>Microsoft Teams</strong><small>Coming soon</small></div></div>
        </div>
      </section> : null}
    </div>
  );
}

function dayPart() { const hour = new Date().getHours(); return hour < 12 ? "morning" : hour < 18 ? "afternoon" : "evening"; }
function firstName(name?: string) { return name?.trim().split(/\s+/)[0] || "there"; }
function installationStatus(items: Installation[], platform: string) { return `status-dot ${items.find((item) => item.platform === platform)?.status === "connected" ? "ready" : "pending"}`; }
function installationText(items: Installation[], platform: string) { const item = items.find((candidate) => candidate.platform === platform); return item?.status === "connected" ? "Connected and policy checked" : "Not connected"; }
