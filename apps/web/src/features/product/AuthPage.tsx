"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { useAirboardAuth } from "../../platform/auth";
import {
  fetchAuthProviderAvailability,
  safeAppPath,
  type AuthProviderAvailability,
} from "../../platform/config";

export function AuthPage({ mode }: { mode: "login" | "signup" }) {
  const auth = useAirboardAuth();
  const router = useRouter();
  const search = useSearchParams();
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [providers, setProviders] = useState<AuthProviderAvailability>({
    google: false,
    microsoft: false,
    emailMagicLink: true,
  });
  const next = safeAppPath(search.get("next"));
  const reason = search.get("reason");

  useEffect(() => {
    if (!auth.loading && auth.accessToken && auth.account) router.replace(next);
  }, [auth.accessToken, auth.account, auth.loading, next, router]);

  useEffect(() => {
    let active = true;
    void fetchAuthProviderAvailability().then((availability) => {
      if (active) setProviders(availability);
    });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (reason === "confirmation_link_expired") {
      setMessage("That confirmation link expired or was already used. Enter your email to receive a new secure link.");
    } else if (reason === "authentication_failed") {
      setMessage("That sign-in link could not be used. Enter your email to receive a fresh secure link.");
    }
  }, [reason]);

  const oauth = async (provider: "google" | "azure") => {
    setBusy(true);
    setMessage(null);
    try {
      sessionStorage.setItem("airboard.auth.next", next);
      await auth.signInWithOAuth(provider, next);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not start sign in.");
      setBusy(false);
    }
  };

  const magic = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setMessage(null);
    try {
      sessionStorage.setItem("airboard.auth.next", next);
      await auth.signInWithMagicLink(email, next);
      setMessage("A secure link is on its way. It is time-limited and can be used only once.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not send the sign-in link.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="auth-shell">
      <Link className="marketing-brand" href="/"><span className="brand-orbit" />Airboard</Link>
      <div className="auth-layout">
        <section className="auth-message">
          <p className="eyebrow">{mode === "signup" ? "Start the 3-day trial" : "Welcome back"}</p>
          <h1>{mode === "signup" ? "Make the idea visible." : "Continue your Airboard."}</h1>
          <p>
            Your trial begins only after your first successful standalone board or meeting preflight.
            No payment card is required.
          </p>
          <ul>
            <li>Standalone visual workspace</li>
            <li>Neon Google Meet camera overlay</li>
            <li>Pointer, voice and gesture controls</li>
          </ul>
        </section>
        <section className="auth-card">
          <h2>{mode === "signup" ? "Create your account" : "Sign in"}</h2>
          <p>{providers.google || providers.microsoft ? "Use your work identity or a secure email link." : "Use a secure email link."}</p>
          {providers.google ? (
            <button className="auth-provider" disabled={busy} onClick={() => void oauth("google")}>
              <span>G</span> Continue with Google
            </button>
          ) : null}
          {providers.microsoft ? (
            <button className="auth-provider" disabled={busy} onClick={() => void oauth("azure")}>
              <span className="microsoft-mark">■</span> Continue with Microsoft
            </button>
          ) : null}
          {providers.google || providers.microsoft ? <div className="auth-divider"><span>or</span></div> : null}
          <form onSubmit={magic}>
            <label htmlFor="auth-email">Work email</label>
            <input id="auth-email" type="email" required autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="you@company.com" />
            <button className="button button-primary" disabled={busy} type="submit">{reason ? "Email me a new secure link" : "Email me a sign-in link"}</button>
          </form>
          {message ? <p className="form-message" role="status">{message}</p> : null}
          {auth.error === "AUTH_NOT_CONFIGURED" ? (
            <p className="form-warning">Authentication must be configured before public signup. Local development uses a server-signed test account.</p>
          ) : null}
          <p className="auth-switch">
            {mode === "signup" ? "Already have an account?" : "New to Airboard?"}{" "}
            <Link href={mode === "signup" ? "/login" : "/signup"}>{mode === "signup" ? "Sign in" : "Start free"}</Link>
          </p>
          <small>By continuing, you accept the <Link href="/terms">Terms</Link> and acknowledge the <Link href="/privacy">Privacy Notice</Link>.</small>
        </section>
      </div>
    </div>
  );
}
