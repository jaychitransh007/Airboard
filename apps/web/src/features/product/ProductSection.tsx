"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { airboardApi } from "../../platform/api";
import { useAirboardAuth } from "../../platform/auth";

type Board = { id: string; title: string; updated_at: string; latest_version: number; visibility: string };
type Activity = { event_id: string; event_name: string; properties: Record<string, unknown>; occurred_at: string };
const TEMPLATES = [
  ["System architecture", "Services, data stores, boundaries and flows"],
  ["Teaching canvas", "Concept, examples, checks and summary"],
  ["Workshop map", "Questions, ideas, decisions and owners"],
  ["Sales narrative", "Problem, change, solution and proof"],
] as const;

export function ProductSection({ section }: { section: string }) {
  if (section === "templates") return <Templates />;
  if (section === "activity") return <ActivityView />;
  if (section === "shared") return <BoardCollection title="Shared with me" description="Organization and link-visible boards available in this workspace." scope="shared" />;
  if (section === "trash") return <BoardCollection title="Trash" description="Deleted boards remain recoverable until your retention workflow removes them." scope="trash" />;
  return <div className="empty-panel"><h3>Surface unavailable</h3><Link href="/app">Return to Airboard</Link></div>;
}

function Templates() {
  const auth = useAirboardAuth(); const router = useRouter(); const [busy, setBusy] = useState<string | null>(null);
  const create = async (title: string) => { if (!auth.accessToken) return; setBusy(title); const result = await airboardApi<{ board: Board }>("/boards", { method: "POST", accessToken: auth.accessToken, body: JSON.stringify({ title }) }); router.push(`/app/boards/${result.board.id}`); };
  return <div><section className="app-page-heading"><p className="eyebrow">Reusable starts</p><h1>Templates</h1><p>Create an organization-owned board with a clear facilitation structure.</p></section><div className="board-grid large">{TEMPLATES.map(([title,description]) => <button className="board-card" key={title} disabled={Boolean(busy)} onClick={() => void create(title)}><div className="board-thumbnail"><span>{title[0]}</span></div><strong>{title}</strong><small>{busy === title ? "Creating…" : description}</small></button>)}</div></div>;
}

function ActivityView() {
  const auth = useAirboardAuth(); const [events, setEvents] = useState<Activity[]>([]);
  useEffect(() => { if (auth.accessToken) void airboardApi<{ events: Activity[] }>("/activity", { accessToken: auth.accessToken }).then((result) => setEvents(result.events)); }, [auth.accessToken]);
  return <div><section className="app-page-heading"><p className="eyebrow">Content-safe telemetry</p><h1>Activity</h1><p>Successful setups, sessions and commercial lifecycle events. Board text, raw media, transcripts and meeting URLs are excluded.</p></section><div className="data-table audit"><div className="table-head"><span>Event</span><span>Context</span><span>Time</span></div>{events.length ? events.map((event) => <div key={event.event_id}><span><strong>{event.event_name.replaceAll(".", " ")}</strong></span><span>{Object.entries(event.properties).map(([key,value]) => `${key}: ${String(value)}`).join(" · ") || "—"}</span><span>{new Date(event.occurred_at).toLocaleString()}</span></div>) : <div><span>No activity yet.</span></div>}</div></div>;
}

function BoardCollection({ title, description, scope }: { title: string; description: string; scope: "shared" | "trash" }) {
  const auth = useAirboardAuth(); const [boards, setBoards] = useState<Board[]>([]);
  const reload = async () => { if (!auth.accessToken) return; const result = await airboardApi<{ boards: Board[] }>(`/boards?scope=${scope}`, { accessToken: auth.accessToken }); setBoards(result.boards); };
  useEffect(() => { void reload(); }, [auth.accessToken, scope]);
  const restore = async (id: string) => { if (!auth.accessToken) return; await airboardApi(`/boards/${id}/restore`, { method: "POST", accessToken: auth.accessToken }); await reload(); };
  return <div><section className="app-page-heading"><p className="eyebrow">Workspace</p><h1>{title}</h1><p>{description}</p></section>{boards.length ? <div className="board-grid large">{boards.map((board) => <article className="board-card" key={board.id}><div className="board-thumbnail"><span>{board.title[0]}</span></div><strong>{board.title}</strong><small>{new Date(board.updated_at).toLocaleString()}</small>{scope === "trash" ? <button onClick={() => void restore(board.id)}>Restore</button> : <Link href={`/app/boards/${board.id}`}>Open</Link>}</article>)}</div> : <div className="empty-panel"><h3>Nothing here</h3><p>{scope === "trash" ? "Deleted boards will appear here." : "Share a board with your organization to see it here."}</p></div>}</div>;
}
