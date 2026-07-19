"use client";

import { useState } from "react";
import Link from "next/link";
import { airboardApi } from "../../platform/api";
import { useAirboardAuth } from "../../platform/auth";
import { MarketingPage } from "./PublicShell";

export function SupportPage() {
  const auth = useAirboardAuth(); const [subject, setSubject] = useState(""); const [message, setMessage] = useState(""); const [result, setResult] = useState<string | null>(null); const [busy, setBusy] = useState(false);
  const submit = async (event: React.FormEvent) => { event.preventDefault(); if (!auth.accessToken) return; setBusy(true); try { const response = await airboardApi<{ id: string }>("/support/requests", { method: "POST", accessToken: auth.accessToken, body: JSON.stringify({ category: "product", subject, message }) }); setResult(`Support request ${response.id} is open.`); setSubject(""); setMessage(""); } catch (caught) { setResult(caught instanceof Error ? caught.message : "SUPPORT_REQUEST_FAILED"); } finally { setBusy(false); } };
  return <MarketingPage eyebrow="Airboard support" title="Diagnose the capability, not the conversation." summary="Support uses versions, permission state, error codes and trace IDs. Do not submit meeting URLs, transcripts or board content.">{auth.accessToken ? <form className="auth-card" onSubmit={submit}><label>Subject<input required value={subject} onChange={(event) => setSubject(event.target.value)} /></label><label>What happened?<textarea required minLength={10} rows={6} value={message} onChange={(event) => setMessage(event.target.value)} placeholder="Include platform, app/extension version, browser or OS, steps and any visible error code." /></label><button className="button button-primary" disabled={busy}>{busy ? "Creating…" : "Create support request"}</button>{result ? <p className="form-message">{result}</p> : null}</form> : <div className="content-cta"><h2>Sign in to create a traceable request.</h2><p>Your organization and request ID help support investigate without asking for conversation content.</p><Link className="button button-primary" href="/login?next=/support">Sign in</Link></div>}</MarketingPage>;
}
