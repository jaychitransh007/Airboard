"use client";

import { useEffect, useState } from "react";
import { AIRBOARD_API_URL } from "../../platform/config";
import { MarketingPage } from "./PublicShell";
import { PILOT_SUPPORT_EMAIL } from "./magicLinkRequest";

const SERVICE_NAMES: Record<string, string> = { web: "Website", api: "Boards and Airo", database: "Saved boards" };
const STATE_LABELS: Record<string, string> = { operational: "Working", ready: "Working", degraded: "Having problems", unreachable: "Not responding", checking: "Checking…", unknown: "Unknown" };

export function StatusPage() {
  const [status, setStatus] = useState<{ web: string; api: string; database: string }>({ web: "operational", api: "checking", database: "checking" });
  useEffect(() => { void fetch(new URL("/ready", AIRBOARD_API_URL), { cache: "no-store" }).then(async (response) => { const data = await response.json() as { ready?: boolean; dependencies?: { database?: string } }; setStatus({ web: "operational", api: response.ok && data.ready ? "operational" : "degraded", database: data.dependencies?.database ?? "unknown" }); }).catch(() => setStatus({ web: "operational", api: "unreachable", database: "unknown" })); }, []);
  return <MarketingPage eyebrow="Service status" title="Is Airboard working right now?" summary={`This page checks Airboard from your browser right now. We don't publish an incident history yet—if something isn't working, email ${PILOT_SUPPORT_EMAIL}.`}><div className="admin-readiness">{Object.entries(status).map(([service,value]) => <div key={service}><span className={`status-dot ${value === "operational" || value === "ready" ? "ready" : "preview"}`} /><strong>{SERVICE_NAMES[service] ?? service}</strong><em>{STATE_LABELS[value] ?? value}</em></div>)}</div><p>The Google Meet preview also depends on your Meet and Chrome extension versions.</p></MarketingPage>;
}
