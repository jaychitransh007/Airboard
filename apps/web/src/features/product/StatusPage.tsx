"use client";

import { useEffect, useState } from "react";
import { AIRBOARD_API_URL } from "../../platform/config";
import { MarketingPage } from "./PublicShell";
import { PILOT_SUPPORT_EMAIL } from "./magicLinkRequest";
import { fetchIncidents, INCIDENTS_ON_GITHUB, RESOLVED_WINDOW_DAYS, type Incident } from "./statusIncidents";

const SERVICE_NAMES: Record<string, string> = { web: "Website", api: "Boards and Airo", database: "Saved boards" };
const STATE_LABELS: Record<string, string> = { operational: "Working", ready: "Working", degraded: "Having problems", unreachable: "Not responding", unavailable: "Not responding", not_configured: "Not set up", checking: "Checking…", unknown: "Unknown" };

type IncidentState = { status: "loading" } | { status: "unavailable" } | { status: "ready"; incidents: Incident[] };

const when = (iso: string) =>
  new Date(iso).toLocaleString(undefined, { day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit", timeZoneName: "short" });

export function StatusPage() {
  const [status, setStatus] = useState<{ web: string; api: string; database: string }>({ web: "operational", api: "checking", database: "checking" });
  const [incidents, setIncidents] = useState<IncidentState>({ status: "loading" });
  useEffect(() => { void fetch(new URL("/ready", AIRBOARD_API_URL), { cache: "no-store" }).then(async (response) => { const data = await response.json() as { ready?: boolean; dependencies?: { database?: string } }; setStatus({ web: "operational", api: response.ok && data.ready ? "operational" : "degraded", database: data.dependencies?.database ?? "unknown" }); }).catch(() => setStatus({ web: "operational", api: "unreachable", database: "unknown" })); }, []);
  useEffect(() => {
    let active = true;
    fetchIncidents()
      .then((list) => active && setIncidents({ status: "ready", incidents: list }))
      .catch(() => active && setIncidents({ status: "unavailable" }));
    return () => { active = false; };
  }, []);

  return (
    <MarketingPage eyebrow="Service status" title="Is Airboard working right now?" summary={`This page checks Airboard from your browser and lists the incidents we've posted in the last ${RESOLVED_WINDOW_DAYS} days.`}>
      <section className="admin-readiness" aria-labelledby="status-now-title">
        <h2 id="status-now-title">Right now</h2>
        {Object.entries(status).map(([service, value]) => <div key={service}><span className={`status-dot ${value === "operational" || value === "ready" ? "ready" : "preview"}`} /><strong>{SERVICE_NAMES[service] ?? service}</strong><em>{STATE_LABELS[value] ?? value}</em></div>)}
      </section>
      <section className="admin-readiness status-incidents" aria-labelledby="status-incidents-title">
        <h2 id="status-incidents-title">Incidents</h2>
        {incidents.status === "loading" ? <p role="status">Loading incident updates…</p> : null}
        {incidents.status === "unavailable" ? (
          <p>Incident updates couldn&apos;t be loaded here. Read them on <a href={INCIDENTS_ON_GITHUB}>GitHub</a>.</p>
        ) : null}
        {incidents.status === "ready" && incidents.incidents.length === 0 ? <p>No incidents in the last {RESOLVED_WINDOW_DAYS} days.</p> : null}
        {incidents.status === "ready" && incidents.incidents.length > 0 ? (
          <ul>
            {incidents.incidents.map((incident) => (
              <li key={incident.number}>
                <article className={incident.resolvedAt ? "status-incident" : "status-incident ongoing"} aria-labelledby={`status-incident-${incident.number}`}>
                  <h3 id={`status-incident-${incident.number}`}>{incident.title}</h3>
                  <p className="status-incident-meta">
                    <span className={`status-dot ${incident.resolvedAt ? "ready" : "pending"}`} />
                    {incident.resolvedAt
                      ? <>Resolved {when(incident.resolvedAt)} · started {when(incident.startedAt)}</>
                      : <>Ongoing since {when(incident.startedAt)}</>}
                  </p>
                  {incident.summary ? <p className="status-incident-text">{incident.summary}</p> : null}
                  {incident.latestUpdate ? (
                    <p className="status-incident-text"><strong>Latest update, {when(incident.latestUpdate.postedAt)}:</strong> {incident.latestUpdate.body}</p>
                  ) : null}
                  <a href={incident.url}>All updates for “{incident.title}”</a>
                </article>
              </li>
            ))}
          </ul>
        ) : null}
      </section>
      <p>If this page doesn&apos;t load, incident updates are also on <a href={INCIDENTS_ON_GITHUB}>GitHub</a>. Need help? Email <a href={`mailto:${PILOT_SUPPORT_EMAIL}`}>{PILOT_SUPPORT_EMAIL}</a>.</p>
    </MarketingPage>
  );
}
