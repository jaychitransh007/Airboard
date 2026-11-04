"use client";

import { useEffect, useState } from "react";
import { airboardApi } from "../../platform/api";
import { useAirboardAuth } from "../../platform/auth";
import { accessWindow, planName } from "./planLabels";

type CommercialConfig = {
  releaseStage: "controlled_pilot" | "paid_pilot";
  checkoutEnabled: boolean;
  billingPortalEnabled: boolean;
};

export function BillingPage() {
  const auth = useAirboardAuth();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [commercial, setCommercial] = useState<CommercialConfig | null>(null);
  useEffect(() => {
    void airboardApi<CommercialConfig>("/commercial/config")
      .then(setCommercial)
      .catch(() => setCommercial({
        releaseStage: "controlled_pilot",
        checkoutEnabled: false,
        billingPortalEnabled: false,
      }));
  }, []);
  const checkout = async (plan: "personal" | "team") => {
    if (!auth.accessToken || !commercial?.checkoutEnabled) return;
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
  const checkoutEnabled = commercial?.checkoutEnabled === true;
  return <div><section className="app-page-heading"><p className="eyebrow">Plan & billing</p><h1>{checkoutEnabled ? "Choose how Airboard grows with you." : "Airboard is free during the pilot."}</h1><p>{checkoutEnabled ? "Billing changes are handled securely by Stripe. Airboard mirrors only the entitlement needed for access." : "These are the prices we plan to charge after the pilot. You won't be asked to pay now—if you need more time, let us know."}</p></section><div className="current-plan"><div><span>Your plan</span><strong>{planName(auth.account?.entitlement?.plan)}</strong><small>{accessWindow(auth.account?.entitlement?.validUntil)}</small></div>{auth.account?.entitlement?.status === "active" && commercial?.billingPortalEnabled ? <button className="button button-quiet" onClick={() => void portal()}>{busy === "portal" ? "Opening…" : "Manage in Stripe"}</button> : null}</div><div className="pricing-grid app-pricing"><Plan name="Personal" price="$12" description="For one presenter." features={["Saved boards with image export", "Voice, typing, mouse and camera input", "Google Meet overlay (preview)", "Desktop overlay (preview)"]} action={checkoutEnabled ? () => void checkout("personal") : undefined} href={checkoutEnabled ? undefined : "/contact-sales"} actionLabel={checkoutEnabled ? "Choose Personal" : "Ask for more pilot time"} busy={busy === "personal"} /><Plan name="Team" price="$18" suffix="per member" description="For teams who diagram together." features={["Everything in Personal", "Shared team workspace", "Member management and policies", "Audit log and installation health"]} action={checkoutEnabled ? () => void checkout("team") : undefined} href={checkoutEnabled ? undefined : "/contact-sales"} actionLabel={checkoutEnabled ? "Choose Team" : "Discuss a team pilot"} busy={busy === "team"} featured /><Plan name="Enterprise" price="Custom" description="A guided evaluation with your security and procurement teams." features={["Guided evaluation", "SSO and SCIM", "Deleted-board recovery and audit export", "Security and legal review support"]} href="/contact-sales" actionLabel="Contact sales" /></div>{!checkoutEnabled ? <p className="form-message">Prices may change before launch, and nothing is charged during the pilot. We'll tell you before that changes.</p> : null}{error ? <p className="form-warning">{error === "BILLING_NOT_CONFIGURED" ? "Billing is not configured for this environment." : error}</p> : null}</div>;
}

function Plan({ name, price, suffix, description, features, action, actionLabel, href, busy, featured }: { name: string; price: string; suffix?: string; description: string; features: string[]; action?: (() => void) | undefined; actionLabel: string; href?: string | undefined; busy?: boolean; featured?: boolean }) { return <article className={`pricing-card ${featured ? "featured" : ""}`}>{featured ? <span className="feature-badge">Best for collaboration</span> : null}<h2>{name}</h2><p>{description}</p><div className="price"><strong>{price}</strong>{price.startsWith("$") ? <span>/month<br />{suffix}</span> : null}</div><ul>{features.map((item) => <li key={item}>{item}</li>)}</ul>{href ? <a className="button button-quiet" href={href}>{actionLabel}</a> : <button className="button button-primary" disabled={busy || !action} onClick={action}>{busy ? "Opening checkout…" : actionLabel}</button>}</article>; }
