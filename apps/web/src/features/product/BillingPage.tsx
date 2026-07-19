"use client";

import { useState } from "react";
import { airboardApi } from "../../platform/api";
import { useAirboardAuth } from "../../platform/auth";

export function BillingPage() {
  const auth = useAirboardAuth();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const checkout = async (plan: "personal" | "team") => {
    if (!auth.accessToken) return;
    setBusy(plan); setError(null);
    try {
      const result = await airboardApi<{ checkoutUrl: string }>("/billing/checkout", { method: "POST", accessToken: auth.accessToken, body: JSON.stringify({ plan, seats: plan === "team" ? 5 : 1 }) });
      window.location.assign(result.checkoutUrl);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "CHECKOUT_FAILED"); setBusy(null); }
  };
  const portal = async () => {
    if (!auth.accessToken) return;
    setBusy("portal"); setError(null);
    try { const result = await airboardApi<{ portalUrl: string }>("/billing/portal", { method: "POST", accessToken: auth.accessToken }); window.location.assign(result.portalUrl); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "PORTAL_FAILED"); setBusy(null); }
  };
  return <div><section className="app-page-heading"><p className="eyebrow">Plan & billing</p><h1>Choose how Airboard grows with you.</h1><p>Billing changes are handled securely by Stripe. Airboard mirrors only the entitlement needed for access.</p></section><div className="current-plan"><div><span>Current access</span><strong>{auth.account?.entitlement?.plan ?? "Trial ready"}</strong><small>{auth.account?.entitlement?.validUntil ? `Valid until ${new Date(auth.account.entitlement.validUntil).toLocaleString()}` : "Your 72-hour trial begins at first value."}</small></div>{auth.account?.entitlement?.status === "active" ? <button className="button button-quiet" onClick={() => void portal()}>{busy === "portal" ? "Opening…" : "Manage in Stripe"}</button> : null}</div><div className="pricing-grid app-pricing"><Plan name="Personal" price="$12" description="For individual presenters and visual thinkers." features={["Standalone boards", "Google Meet overlay", "Desktop click-through overlay", "Standard voice and gesture use"]} action={() => void checkout("personal")} busy={busy === "personal"} /><Plan name="Team" price="$18" suffix="per member" description="For shared visual workflows and administration." features={["Everything in Personal", "Shared workspace", "Members and organization policy", "Audit and installation health"]} action={() => void checkout("team")} busy={busy === "team"} featured /><Plan name="Enterprise" price="Custom" description="For controlled deployment and procurement." features={["SAML/OIDC configuration and SCIM 2.0 provisioning", "Custom retention and audit export", "DPA, security review and SLA", "Managed platform rollout"]} href="/contact-sales" /></div>{error ? <p className="form-warning">{error === "BILLING_NOT_CONFIGURED" ? "Stripe production credentials and price IDs must be configured before checkout can open." : error}</p> : null}</div>;
}

function Plan({ name, price, suffix, description, features, action, href, busy, featured }: { name: string; price: string; suffix?: string; description: string; features: string[]; action?: () => void; href?: string; busy?: boolean; featured?: boolean }) { return <article className={`pricing-card ${featured ? "featured" : ""}`}>{featured ? <span className="feature-badge">Best for collaboration</span> : null}<h2>{name}</h2><p>{description}</p><div className="price"><strong>{price}</strong>{price.startsWith("$") ? <span>/month<br />{suffix}</span> : null}</div><ul>{features.map((item) => <li key={item}>{item}</li>)}</ul>{href ? <a className="button button-quiet" href={href}>Contact sales</a> : <button className="button button-primary" disabled={busy} onClick={action}>{busy ? "Opening checkout…" : `Choose ${name}`}</button>}</article>; }
