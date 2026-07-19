"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { airboardApi } from "../../platform/api";
import { useAirboardAuth } from "../../platform/auth";

const USE_CASES = [
  { id: "System design", glyph: "⌘", detail: "Map services, APIs and decisions" },
  { id: "Teaching", glyph: "✦", detail: "Make a difficult idea feel intuitive" },
  { id: "Consulting", glyph: "↗", detail: "Think visibly with clients" },
  { id: "Sales demos", glyph: "◇", detail: "Turn a pitch into a shared story" },
  { id: "Workshops", glyph: "∞", detail: "Keep a room in the same flow" },
  { id: "Personal thinking", glyph: "∿", detail: "Let rough thoughts find structure" },
] as const;

export function OnboardingFlow() {
  const auth = useAirboardAuth();
  const router = useRouter();
  const [step, setStep] = useState(1);
  const [accountType, setAccountType] = useState<"personal" | "team">("personal");
  const [useCase, setUseCase] = useState("System design");
  const [organizationName, setOrganizationName] = useState("");
  const [companySizeBand, setCompanySizeBand] = useState("11-50");
  const [jobRole, setJobRole] = useState("Engineering");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const complete = async () => {
    if (!auth.accessToken || !auth.account) return;
    setBusy(true);
    setError(null);
    try {
      if (accountType === "team") {
        await airboardApi("/organization", {
          method: "PATCH",
          accessToken: auth.accessToken,
          body: JSON.stringify({ name: organizationName || `${auth.account.profile.displayName}'s team`, kind: "team", companySizeBand }),
        });
      }
      await airboardApi("/me/profile", {
        method: "PATCH",
        accessToken: auth.accessToken,
        body: JSON.stringify({
          displayName: auth.account.profile.displayName,
          locale: auth.account.profile.locale || navigator.language || "en",
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
          onboardingCompleted: true,
        }),
      });
      await auth.refreshAccount();
      router.replace("/app");

      // Product analytics must never be capable of blocking account setup.
      void airboardApi("/analytics/events", {
        method: "POST",
        accessToken: auth.accessToken,
        body: JSON.stringify({
          eventId: crypto.randomUUID(),
          eventName: "onboarding.use_case_selected",
          occurredAt: new Date().toISOString(),
          properties: { accountType, useCase, jobRole, ...(accountType === "team" ? { companySizeBand } : {}) },
        }),
      }).catch(() => undefined);
    } catch (caught) {
      setError(onboardingErrorMessage(caught));
      setBusy(false);
    }
  };

  return (
    <div className="onboarding-shell">
      <div className="onboarding-ambient" aria-hidden="true"><span /><span /><span /></div>
      <header>
        <span className="marketing-brand"><span className="brand-orbit" />Airboard</span>
        <div className="onboarding-status"><span>Workspace setup</span><strong>0{step} / 02</strong></div>
      </header>
      <div className="onboarding-progress" role="progressbar" aria-label="Workspace setup" aria-valuemin={1} aria-valuemax={2} aria-valuenow={step}><span style={{ width: `${(step / 2) * 100}%` }} /></div>
      <main className={`onboarding-card onboarding-step-${step}`}>
        <aside className="onboarding-rail" aria-label="Setup progress">
          <p className="eyebrow">Ideas in motion</p>
          <div className="onboarding-idea-mark" aria-hidden="true">
            <span className="idea-node node-one">?</span>
            <i />
            <span className="idea-node node-two">✦</span>
            <i />
            <span className="idea-node node-three">✓</span>
          </div>
          <div className="onboarding-rail-copy">
            <strong>Shape the starting point.</strong>
            <p>Two quick choices. Every Airboard surface stays available.</p>
          </div>
          <ol className="onboarding-step-list">
            <li className={step >= 1 ? "active" : ""}><span>01</span><div><strong>Workspace</strong><small>Who you think with</small></div></li>
            <li className={step >= 2 ? "active" : ""}><span>02</span><div><strong>First flow</strong><small>What you make clearer</small></div></li>
          </ol>
        </aside>
        <section className="onboarding-stage">
          {step === 1 ? (
            <>
              <div className="onboarding-heading">
                <p className="eyebrow">Your workspace</p>
                <h1>Who will ideas flow between?</h1>
                <p>This personalizes the home space. It never limits where your Airboard account works.</p>
              </div>
              <div className="selection-grid two account-selection">
                <button className={accountType === "personal" ? "selected" : ""} onClick={() => setAccountType("personal")}>
                  <span className="choice-icon" aria-hidden="true">◌</span><strong>Just me</strong><span>A private visual studio for thinking, presenting, and drawing over any screen.</span><i aria-hidden="true">↗</i>
                </button>
                <button className={accountType === "team" ? "selected" : ""} onClick={() => setAccountType("team")}>
                  <span className="choice-icon" aria-hidden="true">◎</span><strong>With a team</strong><span>A shared flow space with collaboration, policy, and administration built in.</span><i aria-hidden="true">↗</i>
                </button>
              </div>
              {accountType === "team" ? (
                <div className="onboarding-fields">
                  <label><span>Organization name</span><input required value={organizationName} onChange={(event) => setOrganizationName(event.target.value)} placeholder="Acme" /></label>
                  <label><span>Company size</span><span className="select-shell"><select value={companySizeBand} onChange={(event) => setCompanySizeBand(event.target.value)}><option>1-10</option><option>11-50</option><option>51-200</option><option>201-1000</option><option>1000+</option></select></span></label>
                </div>
              ) : null}
            </>
          ) : null}
          {step === 2 ? (
            <>
              <div className="onboarding-heading">
                <p className="eyebrow">First outcome</p>
                <h1>What do you want to make clearer?</h1>
                <p>Choose a starting rhythm. We use it for suggestions and aggregate planning—never to inspect board content.</p>
              </div>
              <div className="use-case-grid">
                {USE_CASES.map((item) => (
                  <button className={useCase === item.id ? "selected" : ""} key={item.id} onClick={() => setUseCase(item.id)}>
                    <span className="use-case-glyph" aria-hidden="true">{item.glyph}</span>
                    <span><strong>{item.id}</strong><small>{item.detail}</small></span>
                    <i aria-hidden="true">✓</i>
                  </button>
                ))}
              </div>
              <label className="onboarding-field"><span>Your role</span><span className="select-shell"><select value={jobRole} onChange={(event) => setJobRole(event.target.value)}><option>Engineering</option><option>Product</option><option>Education</option><option>Sales</option><option>Consulting</option><option>Operations</option><option>Executive</option><option>Other</option></select></span></label>
              <div className="onboarding-access-panel">
                <div><span className="access-pulse" aria-hidden="true" /><p><strong>One account. Every surface.</strong><small>Start wherever the idea appears.</small></p></div>
                <ul aria-label="Included Airboard surfaces"><li><span>◇</span>Airboard</li><li><span>↗</span>Desktop</li><li><span>◉</span>Meetings</li></ul>
              </div>
            </>
          ) : null}
          {error ? <p className="form-warning" role="alert">{error}</p> : null}
          <footer>
            <button className="button button-quiet" disabled={step === 1 || busy} onClick={() => setStep(1)}><span aria-hidden="true">←</span> Back</button>
            {step === 1 ? <button className="button button-primary" disabled={accountType === "team" && !organizationName.trim()} onClick={() => setStep(2)}>Continue <span aria-hidden="true">→</span></button> : <button className="button button-primary" disabled={busy} onClick={() => void complete()}>{busy ? "Preparing your workspace…" : <>Open Airboard <span aria-hidden="true">↗</span></>}</button>}
          </footer>
        </section>
      </main>
    </div>
  );
}

function onboardingErrorMessage(caught: unknown): string {
  const code = caught instanceof Error ? caught.message : "ONBOARDING_SAVE_FAILED";
  if (code === "NETWORK_UNAVAILABLE") return "Airboard could not reach the account service. Check your connection and try again—your choices are still here.";
  if (code === "PROFILE_UPDATE_FAILED") return "Airboard could not finish preparing your profile. Please try again.";
  return `Airboard could not finish account setup (${code}). Please try again.`;
}
