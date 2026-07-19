"use client";

import { useEffect, useState } from "react";
import { AIRBOARD_API_URL } from "../../platform/config";
import { MarketingPage } from "./PublicShell";

export function StatusPage() {
  const [status, setStatus] = useState<{ web: string; api: string; database: string }>({ web: "operational", api: "checking", database: "checking" });
  useEffect(() => { void fetch(new URL("/ready", AIRBOARD_API_URL), { cache: "no-store" }).then(async (response) => { const data = await response.json() as { ready?: boolean; dependencies?: { database?: string } }; setStatus({ web: "operational", api: response.ok && data.ready ? "operational" : "degraded", database: data.dependencies?.database ?? "unknown" }); }).catch(() => setStatus({ web: "operational", api: "unreachable", database: "unknown" })); }, []);
  return <MarketingPage eyebrow="Live service health" title="Airboard status" summary="This view checks the deployed control plane without exposing tenant data."><div className="admin-readiness">{Object.entries(status).map(([service,value]) => <div key={service}><span className={`status-dot ${value === "operational" || value === "ready" ? "ready" : "preview"}`} /><strong>{service}</strong><em>{value}</em></div>)}</div><p>Meeting-platform availability also depends on Google Meet and the installed client version. Incidents and maintenance notices should be published here as the release moves beyond pilot.</p></MarketingPage>;
}
