"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect } from "react";
import { useAirboardAuth } from "../../platform/auth";
import { safeAppPath } from "../../platform/config";
import { authCallbackFailure } from "./authCallbackState";

export function AuthCallback() {
  const auth = useAirboardAuth();
  const router = useRouter();
  const search = useSearchParams();
  const providerFailure = authCallbackFailure(search);

  useEffect(() => {
    if (!providerFailure && !auth.loading && auth.accessToken && auth.account) {
      const next = safeAppPath(
        search.get("next") || sessionStorage.getItem("airboard.auth.next"),
      );
      sessionStorage.removeItem("airboard.auth.next");
      router.replace(next);
    }
  }, [auth.accessToken, auth.account, auth.loading, providerFailure, router, search]);

  if (providerFailure) return <CallbackFailure {...providerFailure} />;

  if (!auth.loading && !auth.accessToken) {
    return (
      <CallbackFailure
        title="This sign-in could not be completed."
        detail="No active confirmation was found. Request a new secure email link and try again."
        actionHref="/login?reason=authentication_failed"
        actionLabel="Request a new link"
      />
    );
  }

  if (!auth.loading && auth.accessToken && !auth.account && auth.error) {
    return (
      <div className="auth-callback-shell">
        <Link className="marketing-brand" href="/"><span className="brand-orbit" />Airboard</Link>
        <main className="auth-callback-card">
          <p className="eyebrow">Account setup interrupted</p>
          <h1>Your email is confirmed.</h1>
          <p>Airboard could not finish preparing your workspace. Your confirmation is safe; retry the account setup.</p>
          <button className="button button-primary" onClick={() => void auth.refreshAccount()}>Try account setup again</button>
        </main>
      </div>
    );
  }

  return <div className="product-loading">Securing your Airboard account…</div>;
}

function CallbackFailure({ title, detail, actionHref, actionLabel }: {
  title: string;
  detail: string;
  actionHref: string;
  actionLabel: string;
}) {
  return (
    <div className="auth-callback-shell">
      <Link className="marketing-brand" href="/"><span className="brand-orbit" />Airboard</Link>
      <main className="auth-callback-card" role="alert">
        <p className="eyebrow">Confirmation link unavailable</p>
        <h1>{title}</h1>
        <p>{detail}</p>
        <div className="hero-actions">
          <Link className="button button-primary" href={actionHref}>{actionLabel}</Link>
          <Link className="button button-quiet" href="/support">Get help</Link>
        </div>
      </main>
    </div>
  );
}
