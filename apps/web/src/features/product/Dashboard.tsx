"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { airboardApi } from "../../platform/api";
import { useAirboardAuth } from "../../platform/auth";

type Board = { id: string; title: string; updated_at: string; latest_version: number };
type Installation = { id: string; platform: string; status: string; last_success_at: string | null };

export function Dashboard() {
  const auth = useAirboardAuth();
  const [boards, setBoards] = useState<Board[]>([]);
  const [installations, setInstallations] = useState<Installation[]>([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    if (!auth.accessToken) return;
    void Promise.all([
      airboardApi<{ boards: Board[] }>("/boards", { accessToken: auth.accessToken }),
      airboardApi<{ installations: Installation[] }>("/integrations", { accessToken: auth.accessToken }),
    ])
      .then(([boardResult, installationResult]) => {
        setBoards(boardResult.boards);
        setInstallations(installationResult.installations);
      })
      .finally(() => setLoading(false));
  }, [auth.accessToken]);

  return (
    <div className="dashboard-page">
      <section className="app-page-heading">
        <div><p className="eyebrow">Your visual workspace</p><h1>Good {dayPart()}, {firstName(auth.account?.profile.displayName)}.</h1><p>Start on Airboard or carry the same visual language into your next meeting.</p></div>
      </section>
      <section className="quick-start-grid">
        <Link className="quick-card primary" href="/app/boards/new?preflight=1"><span>＋</span><div><strong>New Airboard</strong><p>Create a persistent board and begin your trial at first value.</p></div></Link>
        <Link className="quick-card" href="/app/integrations?setup=chrome_meet"><span>◉</span><div><strong>Use in Google Meet</strong><p>Connect the extension, confirm media disclosure and run preflight.</p></div></Link>
        <Link className="quick-card" href="/download"><span>↗</span><div><strong>Desktop overlay</strong><p>Place a literal click-through Airboard above any desktop application.</p></div></Link>
      </section>
      <section className="dashboard-section">
        <div className="section-heading"><div><h2>Recent boards</h2><p>Your content—not your camera or microphone—is saved here.</p></div><Link href="/app/boards">View all</Link></div>
        {loading ? <div className="empty-panel">Loading your workspace…</div> : boards.length ? (
          <div className="board-grid">{boards.slice(0, 6).map((board) => <Link className="board-card" href={`/app/boards/${board.id}`} key={board.id}><div className="board-thumbnail"><span>{board.title.slice(0, 1).toUpperCase()}</span></div><strong>{board.title}</strong><small>Version {board.latest_version} · {relativeTime(board.updated_at)}</small></Link>)}</div>
        ) : <div className="empty-panel"><span className="empty-icon">◇</span><h3>No saved boards yet</h3><p>Create your first Airboard. The 72-hour trial starts only after the setup succeeds.</p><Link className="button button-primary" href="/app/boards/new?preflight=1">Create first board</Link></div>}
      </section>
      <section className="dashboard-section">
        <div className="section-heading"><div><h2>Integration health</h2><p>See whether Airboard is ready before a real meeting.</p></div><Link href="/app/integrations">Manage</Link></div>
        <div className="health-row">
          <div><span className={installationStatus(installations, "chrome_meet")} /><div><strong>Google Meet overlay</strong><small>{installationText(installations, "chrome_meet")}</small></div></div>
          <div><span className="status-dot preview" /><div><strong>Zoom Camera Mode</strong><small>Controlled beta</small></div></div>
          <div><span className="status-dot preview" /><div><strong>Microsoft Teams</strong><small>Design-partner pilot</small></div></div>
        </div>
      </section>
    </div>
  );
}

function dayPart() { const hour = new Date().getHours(); return hour < 12 ? "morning" : hour < 18 ? "afternoon" : "evening"; }
function firstName(name?: string) { return name?.trim().split(/\s+/)[0] || "there"; }
function relativeTime(value: string) { const days = Math.floor((Date.now() - new Date(value).getTime()) / 86_400_000); return days <= 0 ? "today" : days === 1 ? "yesterday" : `${days} days ago`; }
function installationStatus(items: Installation[], platform: string) { return `status-dot ${items.find((item) => item.platform === platform)?.status === "connected" ? "ready" : "pending"}`; }
function installationText(items: Installation[], platform: string) { const item = items.find((candidate) => candidate.platform === platform); return item?.status === "connected" ? "Connected and policy checked" : "Not connected"; }
