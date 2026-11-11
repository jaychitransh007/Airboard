"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { airboardApi } from "../../platform/api";
import { useAirboardAuth } from "../../platform/auth";

type Board = { id: string; title: string; updated_at: string; latest_version: number; visibility: string };
type Activity = { event_id: string; event_name: string; properties: Record<string, unknown>; occurred_at: string };

export function ProductSection({ section }: { section: string }) {
  if (section === "activity") return <ActivityView />;
  if (section === "shared") return <SharedBoards />;
  return <div className="empty-panel"><h1>Page not found</h1><p>This part of Airboard doesn&apos;t exist.</p><Link href="/app">Return to Airboard</Link></div>;
}

function ActivityView() {
  const auth = useAirboardAuth(); const [events, setEvents] = useState<Activity[]>([]);
  useEffect(() => { if (auth.accessToken) void airboardApi<{ events: Activity[] }>("/activity", { accessToken: auth.accessToken }).then((result) => setEvents(result.events)); }, [auth.accessToken]);
  return <div><section className="app-page-heading"><p className="eyebrow">Content-safe telemetry</p><h1>Activity</h1><p>Successful setups, sessions and commercial lifecycle events. Board text, raw media, transcripts and meeting URLs are excluded.</p></section><div className="data-table audit" role="table" aria-label="Activity"><div className="table-head" role="row"><span role="columnheader">Event</span><span role="columnheader">Context</span><span role="columnheader">Time</span></div>{events.length ? events.map((event) => <div key={event.event_id} role="row"><span role="cell"><strong>{event.event_name.replaceAll(".", " ")}</strong></span><span role="cell">{Object.entries(event.properties).map(([key,value]) => `${key}: ${String(value)}`).join(" · ") || "—"}</span><span role="cell">{new Date(event.occurred_at).toLocaleString()}</span></div>) : <div role="row"><span role="cell">No activity yet.</span></div>}</div></div>;
}

/** Boards others in the workspace opened up to everyone. */
function SharedBoards() {
  const auth = useAirboardAuth();
  const [boards, setBoards] = useState<Board[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!auth.accessToken) return;
    void airboardApi<{ boards: Board[] }>("/boards?scope=shared", { accessToken: auth.accessToken })
      .then((result) => setBoards(result.boards))
      .finally(() => setLoading(false));
  }, [auth.accessToken]);

  return (
    <div>
      <section className="app-page-heading">
        <div>
          <p className="eyebrow">Workspace</p>
          <h1>Shared</h1>
          <p>Boards anyone in this workspace can open and edit.</p>
        </div>
      </section>

      {loading ? (
        <div className="empty-panel">Loading boards…</div>
      ) : boards.length ? (
        <div className="board-grid large">
          {boards.map((board) => (
            <article className="board-card" key={board.id}>
              <div className="board-thumbnail">
                <span>{board.title[0]}</span>
              </div>
              <strong>{board.title}</strong>
              <small>{new Date(board.updated_at).toLocaleString()}</small>
              <Link href={`/app/boards/${board.id}`}>Open</Link>
            </article>
          ))}
        </div>
      ) : (
        <div className="empty-panel">
          <h3>Nothing here</h3>
          <p>Share a board with your organization to see it here.</p>
        </div>
      )}
    </div>
  );
}
