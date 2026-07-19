"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { airboardApi } from "../../platform/api";
import { useAirboardAuth } from "../../platform/auth";

type Board = { id: string; title: string; updated_at: string; latest_version: number; visibility: string };

export function BoardsPage() {
  const auth = useAirboardAuth();
  const [boards, setBoards] = useState<Board[]>([]);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    if (!auth.accessToken) return;
    void airboardApi<{ boards: Board[] }>("/boards", { accessToken: auth.accessToken })
      .then((result) => setBoards(result.boards))
      .finally(() => setLoading(false));
  }, [auth.accessToken]);
  const visible = boards.filter((board) => board.title.toLowerCase().includes(query.toLowerCase()));
  return (
    <div>
      <section className="app-page-heading inline"><div><p className="eyebrow">Library</p><h1>Boards</h1><p>Persistent diagrams, screen annotations and meeting artifacts.</p></div><Link className="button button-primary" href="/app/boards/new?preflight=1">New Airboard</Link></section>
      <div className="library-toolbar"><input type="search" placeholder="Search boards" value={query} onChange={(event) => setQuery(event.target.value)} /><div><button className="selected">Updated</button><Link href="/app/trash">Trash</Link></div></div>
      {loading ? <div className="empty-panel">Loading boards…</div> : visible.length ? <div className="board-grid large">{visible.map((board) => <Link className="board-card" href={`/app/boards/${board.id}`} key={board.id}><div className="board-thumbnail"><span>{board.title[0]?.toUpperCase()}</span></div><strong>{board.title}</strong><small>{board.visibility} · version {board.latest_version}</small></Link>)}</div> : <div className="empty-panel"><h3>No matching boards</h3><p>Create a board or clear the search.</p></div>}
    </div>
  );
}
