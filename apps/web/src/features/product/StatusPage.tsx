"use client";

import { useEffect, useState } from "react";
import { AIRBOARD_API_URL } from "../../platform/config";
import { MarketingPage } from "./PublicShell";

export function StatusPage() {
  const [status, setStatus] = useState<{ web: string; api: string; database: string }>({ web: "operational", api: "checking", database: "checking" });
  useEffect(() => { void fetch(new URL("/ready", AIRBOARD_API_URL), { cache: "no-store" }).then(async (response) => { const data = await response.json() as { ready?: boolean; dependencies?: { database?: string } }; setStatus({ web: "operational", api: response.ok && data.ready ? "operational" : "degraded", database: data.dependencies?.database ?? "unknown" }); }).catch(() => setStatus({ web: "operational", api: "unreachable", database: "unknown" })); }, []);
  return <MarketingPage eyebrow="Point-in-time pilot readiness" title="Airboard environment check" summary="This browser makes a current control-plane readiness request without exposing tenant data. It is not an uptime history, incident feed or SLA."><div className="admin-readiness">{Object.entries(status).map(([service,value]) => <div key={service}><span className={`status-dot ${value === "operational" || value === "ready" ? "ready" : "preview"}`} /><strong>{service}</strong><em>{value}</em></div>)}</div><p>Google Meet preview availability also depends on the Meet client and installed extension version. Pilot incidents are handled through the support path until a staffed public status process exists.</p></MarketingPage>;
}
