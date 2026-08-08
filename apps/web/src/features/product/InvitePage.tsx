"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { airboardApi } from "../../platform/api";
import { useAirboardAuth } from "../../platform/auth";

type Invitation = { role: string; expiresAt: string; emailHint: string; organization: { name?: string } | null };

export function InvitePage({ token }: { token: string }) {
  const auth = useAirboardAuth();
  const router = useRouter();
  const [invitation, setInvitation] = useState<Invitation | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    void airboardApi<{ invitation: Invitation }>(`/invitations/${encodeURIComponent(token)}`)
      .then((result) => setInvitation(result.invitation))
      .catch((caught) => setError(caught instanceof Error ? caught.message : "INVITATION_NOT_FOUND"));
  }, [token]);
  const accept = async () => {
    if (!auth.accessToken) return;
    setBusy(true); setError(null);
    try {
      await airboardApi(`/invitations/${encodeURIComponent(token)}/accept`, { method: "POST", accessToken: auth.accessToken });
      await auth.refreshAccount();
      router.replace("/app");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "INVITATION_ACCEPT_FAILED"); setBusy(false);
    }
  };
  return <div className="auth-shell"><Link className="marketing-brand" href="/"><span className="brand-orbit" />Airboard</Link><main className="onboarding-card">{error && !invitation ? <><p className="eyebrow">Invitation unavailable</p><h1>This invitation cannot be used.</h1><p>It may have expired, been revoked, or already been accepted.</p><Link className="button button-primary" href="/app">Open Airboard</Link></> : invitation ? <><p className="eyebrow">Workspace invitation</p><h1>Join {invitation.organization?.name ?? "an Airboard workspace"}</h1><p>You were invited as <strong>{invitation.role}</strong> for {invitation.emailHint}. The invitation expires {new Date(invitation.expiresAt).toLocaleString()}.</p>{auth.accessToken ? <button className="button button-primary" disabled={busy} onClick={() => void accept()}>{busy ? "Joining…" : "Accept invitation"}</button> : <Link className="button button-primary" href={`/login?next=${encodeURIComponent(`/invite/${token}`)}`}>Sign in to accept</Link>}{error ? <p className="form-warning">{error === "INVITATION_EMAIL_MISMATCH" ? "Sign in with the email address that received this invitation." : error}</p> : null}</> : <div className="product-loading">Checking invitation…</div>}</main></div>;
}
