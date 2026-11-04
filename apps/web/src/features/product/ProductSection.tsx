"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { AirboardApiError, airboardApi } from "../../platform/api";
import { useAirboardAuth } from "../../platform/auth";
import { BOARD_TEMPLATES, type BoardTemplate } from "../board/boardTemplates";

type Board = { id: string; title: string; updated_at: string; latest_version: number; visibility: string };
type Activity = { event_id: string; event_name: string; properties: Record<string, unknown>; occurred_at: string };

export function ProductSection({ section }: { section: string }) {
  if (section === "templates") return <Templates />;
  if (section === "activity") return <ActivityView />;
  if (section === "shared") return <BoardCollection title="Shared with me" description="Organization and link-visible boards available in this workspace." scope="shared" />;
  if (section === "trash") return <BoardCollection title="Trash" description="Deleted boards remain recoverable until your retention workflow removes them." scope="trash" />;
  return <div className="empty-panel"><h3>Surface unavailable</h3><Link href="/app">Return to Airboard</Link></div>;
}

function Templates() {
  const auth = useAirboardAuth(); const router = useRouter(); const [busy, setBusy] = useState<string | null>(null); const [error, setError] = useState<string | null>(null);
  const create = async (template: BoardTemplate) => { if (!auth.accessToken) return; setBusy(template.id); setError(null); try { const result = await airboardApi<{ board: Board }>("/boards", { method: "POST", accessToken: auth.accessToken, body: JSON.stringify({ title: template.title }) }); router.push(`/app/boards/${result.board.id}?template=${template.id}`); } catch (caught) { setBusy(null); setError(caught instanceof AirboardApiError && caught.code === "ACTIVE_ENTITLEMENT_REQUIRED" ? "Your pilot access has ended, so new boards can't be created. Your saved boards are still in your library." : "Could not create the board. Check your connection and try again."); } };
  return <div><section className="app-page-heading"><p className="eyebrow">Reusable starts</p><h1>Templates</h1><p>Start from a ready-made diagram, then change anything by typing, speaking or double-clicking.</p></section>{error ? <p className="form-warning" role="alert">{error}{error.startsWith("Your pilot") ? <> <Link href="/support">Request more pilot time</Link></> : null}</p> : null}<div className="board-grid large">{BOARD_TEMPLATES.map((template) => <button className="board-card" key={template.id} disabled={Boolean(busy)} onClick={() => void create(template)}><div className="board-thumbnail"><span>{template.title[0]}</span></div><strong>{template.title}</strong><small>{busy === template.id ? "Creating…" : template.description}</small></button>)}</div></div>;
}

function ActivityView() {
  const auth = useAirboardAuth(); const [events, setEvents] = useState<Activity[]>([]);
  useEffect(() => { if (auth.accessToken) void airboardApi<{ events: Activity[] }>("/activity", { accessToken: auth.accessToken }).then((result) => setEvents(result.events)); }, [auth.accessToken]);
  return <div><section className="app-page-heading"><p className="eyebrow">Content-safe telemetry</p><h1>Activity</h1><p>Successful setups, sessions and commercial lifecycle events. Board text, raw media, transcripts and meeting URLs are excluded.</p></section><div className="data-table audit"><div className="table-head"><span>Event</span><span>Context</span><span>Time</span></div>{events.length ? events.map((event) => <div key={event.event_id}><span><strong>{event.event_name.replaceAll(".", " ")}</strong></span><span>{Object.entries(event.properties).map(([key,value]) => `${key}: ${String(value)}`).join(" · ") || "—"}</span><span>{new Date(event.occurred_at).toLocaleString()}</span></div>) : <div><span>No activity yet.</span></div>}</div></div>;
}

function BoardCollection({ title, description, scope }: { title: string; description: string; scope: "shared" | "trash" }) {
  const auth = useAirboardAuth();
  const [boards, setBoards] = useState<Board[]>([]);
  const [loading, setLoading] = useState(true);

  const reload = async () => {
    if (!auth.accessToken) return;
    try {
      const result = await airboardApi<{ boards: Board[] }>(`/boards?scope=${scope}`, {
        accessToken: auth.accessToken,
      });
      setBoards(result.boards);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void reload();
  }, [auth.accessToken, scope]);

  const restore = async (id: string) => {
    if (!auth.accessToken) return;
    await airboardApi(`/boards/${id}/restore`, {
      method: "POST",
      accessToken: auth.accessToken,
    });
    await reload();
  };

  const isTrash = scope === "trash";

  return (
    <div>
      <section className={`app-page-heading${isTrash ? " inline" : ""}`}>
        <div>
          <p className="eyebrow">Workspace</p>
          <h1>{title}</h1>
          <p>{description}</p>
        </div>
        {isTrash ? (
          <Link className="button button-quiet" href="/app/boards">
            ← Back to Boards
          </Link>
        ) : null}
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
              {isTrash ? (
                <button className="button button-quiet" onClick={() => void restore(board.id)}>
                  Restore
                </button>
              ) : (
                <Link href={`/app/boards/${board.id}`}>Open</Link>
              )}
            </article>
          ))}
        </div>
      ) : (
        <div className="empty-panel">
          <h3>Nothing here</h3>
          <p>
            {isTrash
              ? "Deleted boards will appear here."
              : "Share a board with your organization to see it here."}
          </p>
          {isTrash ? (
            <Link className="button button-primary" href="/app/boards">
              View your Airboards
            </Link>
          ) : null}
        </div>
      )}
    </div>
  );
}
