"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { airboardApi } from "../../platform/api";
import {
  CHROME_EXTENSION_PUBLICLY_INSTALLABLE,
  CHROME_EXTENSION_VERSION,
  CHROME_WEB_STORE_URL,
} from "../../platform/distribution";
import { useAirboardAuth } from "../../platform/auth";
import {
  chromeMeetReadiness,
  type ChromeMeetExtensionState,
} from "./chromeMeetReadiness";

type Installation = {
  id: string;
  platform: string;
  status: string;
  version: string | null;
  external_installation_id: string | null;
  consented_at: string | null;
  last_seen_at: string | null;
  last_success_at: string | null;
  last_error_code: string | null;
};

type ExternalChrome = {
  runtime?: {
    sendMessage: (
      extensionId: string,
      message: unknown,
      callback: (response?: ChromeMeetExtensionState & { ok?: boolean; error?: string }) => void,
    ) => void;
    lastError?: { message?: string };
  };
};

export function IntegrationsPage() {
  const auth = useAirboardAuth();
  const router = useRouter();
  const search = useSearchParams();
  const [installations, setInstallations] = useState<Installation[]>([]);
  const [extensionState, setExtensionState] = useState<ChromeMeetExtensionState | null>(null);
  const [extensionReachable, setExtensionReachable] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const detectedExtensionId = search.get("extensionId");
  const uninstallRequested = search.get("uninstall") === "chrome_meet";
  const meet = installations.find((item) => item.platform === "chrome_meet" && item.status !== "revoked");
  const extensionId = detectedExtensionId || meet?.external_installation_id || null;

  const reload = useCallback(async () => {
    if (!auth.accessToken) return;
    try {
      const result = await airboardApi<{ installations: Installation[] }>("/integrations", {
        accessToken: auth.accessToken,
      });
      setInstallations(result.installations);
    } catch (error) {
      setStatus(error instanceof Error ? `Could not load integration status (${error.message}).` : "Could not load integration status.");
    }
  }, [auth.accessToken]);

  const readExtension = useCallback(async (id: string): Promise<ChromeMeetExtensionState | null> => {
    const chromeApi = (window as Window & { chrome?: ExternalChrome }).chrome;
    if (!chromeApi?.runtime?.sendMessage) return null;
    return new Promise((resolve) => {
      chromeApi.runtime!.sendMessage(id, { type: "AIRBOARD_GET_STATE" }, (response) => {
        if (chromeApi.runtime?.lastError || !response || response.error) resolve(null);
        else resolve(response);
      });
    });
  }, []);

  useEffect(() => { void reload(); }, [reload]);
  useEffect(() => {
    if (!extensionId) {
      setExtensionReachable(false);
      setExtensionState(null);
      return;
    }
    let active = true;
    const refresh = async () => {
      const next = await readExtension(extensionId);
      if (!active) return;
      setExtensionReachable(Boolean(next));
      setExtensionState(next);
    };
    void refresh();
    const timer = window.setInterval(() => void refresh(), 3_000);
    return () => { active = false; window.clearInterval(timer); };
  }, [extensionId, readExtension]);

  const linkExtension = async () => {
    if (!auth.accessToken || !detectedExtensionId) return;
    setBusy(true);
    setStatus(null);
    try {
      const link = await airboardApi<{ linkToken: string }>("/integrations/extension-link", {
        method: "POST",
        accessToken: auth.accessToken,
        body: JSON.stringify({ extensionId: detectedExtensionId, version: search.get("version") || "unknown" }),
      });
      const chromeApi = (window as Window & { chrome?: ExternalChrome }).chrome;
      if (!chromeApi?.runtime?.sendMessage) throw new Error("CHROME_EXTENSION_NOT_REACHABLE");
      await new Promise<void>((resolve, reject) => {
        chromeApi.runtime!.sendMessage(detectedExtensionId, { type: "AIRBOARD_LINK", linkToken: link.linkToken }, (response) => {
          const runtimeError = chromeApi.runtime?.lastError?.message;
          if (runtimeError || !response?.ok) reject(new Error(runtimeError || response?.error || "EXTENSION_LINK_FAILED"));
          else resolve();
        });
      });
      setStatus("Connected. Open the Airboard toolbar popup once to confirm live media use.");
      await reload();
      setExtensionState(await readExtension(detectedExtensionId));
      router.replace("/app/integrations?connected=chrome_meet", { scroll: false });
    } catch (error) {
      const code = error instanceof Error ? error.message : "EXTENSION_LINK_FAILED";
      setStatus(extensionLinkMessage(code));
    } finally {
      setBusy(false);
    }
  };

  const revokeInstallation = async () => {
    if (!auth.accessToken || !meet) return;
    setBusy(true);
    setStatus(null);
    try {
      await airboardApi(`/integrations/${meet.id}`, {
        method: "PATCH",
        accessToken: auth.accessToken,
        body: JSON.stringify({ revoked: true }),
      });
      setStatus("This Chrome installation has been revoked from your Airboard account.");
      router.replace("/app/integrations", { scroll: false });
      await reload();
    } catch (error) {
      setStatus(error instanceof Error ? `Could not revoke the installation (${error.message}).` : "Could not revoke the installation.");
    } finally {
      setBusy(false);
    }
  };

  const steps = useMemo(() => chromeMeetReadiness(extensionState, {
    detected: extensionReachable,
    serverLinked: Boolean(meet),
    serverConsented: Boolean(meet?.consented_at),
    serverVerified: Boolean(meet?.last_success_at),
  }), [extensionReachable, extensionState, meet]);
  const completeSteps = steps.filter((step) => step.complete).length;
  const isVerified = steps.at(-1)?.complete === true;
  const versionMismatch = Boolean(extensionState && meet?.version && meet.version !== CHROME_EXTENSION_VERSION);

  return (
    <div>
      <section className="app-page-heading">
        <p className="eyebrow">Connected surfaces</p>
        <h1>Integrations</h1>
        <p>Airboard belongs on your outgoing video—not in a second audience-facing Meet canvas.</p>
      </section>

      {detectedExtensionId ? (
        <section className="setup-banner extension-setup-banner">
          <div>
            <span className="setup-kicker">Extension detected · v{search.get("version") || "unknown"}</span>
            <strong>{extensionState?.linked ? "This Chrome profile is connected" : "Connect this Chrome profile"}</strong>
            <p>The installation receives a revocable, account-scoped credential. It never receives your password.</p>
          </div>
          {extensionState?.linked ? <span className="setup-complete">Connected ✓</span> : <button className="button button-primary" disabled={busy || !extensionReachable} onClick={() => void linkExtension()}>{busy ? "Connecting…" : extensionReachable ? "Connect extension" : "Extension not reachable"}</button>}
        </section>
      ) : null}
      {uninstallRequested && meet ? (
        <section className="setup-banner extension-setup-banner">
          <div><span className="setup-kicker">Chrome extension removed</span><strong>Finish disconnecting Airboard</strong><p>Revoke the installation credential and remove this browser from installation health.</p></div>
          <button className="button button-primary" disabled={busy} onClick={() => void revokeInstallation()}>{busy ? "Revoking…" : "Revoke installation"}</button>
        </section>
      ) : null}
      {status ? <p className="form-message" role="status">{status}</p> : null}

      <section className="meet-integration-console">
        <div className="integration-console-head">
          <div className={`integration-icon ${isVerified ? "ready" : ""}`}>◉</div>
          <div>
            <span className="integration-badge">{isVerified ? "Ready" : CHROME_EXTENSION_PUBLICLY_INSTALLABLE ? "Chrome extension" : "Private preview"}</span>
            <h2>Airboard for Google Meet</h2>
            <p>A private renderer composites neon diagrams into your outgoing camera. Meeting controls and account data stay outside Meet.</p>
          </div>
          <div className="integration-console-actions">
            {!extensionReachable && CHROME_WEB_STORE_URL ? <a className="button button-primary" href={CHROME_WEB_STORE_URL} target="_blank" rel="noreferrer">Add to Chrome</a> : null}
            {!extensionReachable && !CHROME_WEB_STORE_URL ? <Link className="button button-primary" href="/contact-sales">Request preview access</Link> : null}
            {extensionReachable ? <button className="button button-quiet" onClick={() => extensionId && void readExtension(extensionId).then(setExtensionState)}>Refresh status</button> : null}
          </div>
        </div>

        <div className="integration-progress" aria-label={`${completeSteps} of ${steps.length} Google Meet setup checks complete`}>
          <div><span style={{ width: `${(completeSteps / steps.length) * 100}%` }} /></div>
          <strong>{completeSteps} / {steps.length} ready</strong>
        </div>
        <ol className="integration-checklist">
          {steps.map((step, index) => (
            <li className={step.complete ? "complete" : index === completeSteps ? "current" : ""} key={step.id}>
              <span>{step.complete ? "✓" : index + 1}</span>
              <div><strong>{step.label}</strong><small>{step.detail}</small></div>
            </li>
          ))}
        </ol>
        {versionMismatch ? <p className="form-warning">This browser reports {meet?.version}; Airboard expects {CHROME_EXTENSION_VERSION}. Update the extension before relying on a meeting.</p> : null}
        {extensionState?.lastError || meet?.last_error_code ? <p className="form-warning">Diagnostic: {extensionState?.lastError || meet?.last_error_code}</p> : null}
        <div className="integration-footnote">
          <strong>No Meet activity required.</strong>
          <span>After installation and consent, open or refresh a meeting. Airboard engages the camera track automatically and verifies the outbound sender.</span>
        </div>
      </section>

      <div className="integration-list secondary-integrations">
        <IntegrationCard name="Airboard desktop" badge="Development build" description="A transparent, always-on-top, click-through native overlay for arbitrary desktop applications." state="preview" details="Signed, auto-updating installers remain a release gate." action={<Link className="button button-quiet" href="/contact-sales">Request desktop preview</Link>} />
        <IntegrationCard name="Zoom" badge="Controlled beta" description="Planned around Zoom Camera Mode so Airboard content can enter the outgoing camera through the supported API." state="preview" details="Marketplace registration and real-client verification required." action={<Link className="button button-quiet" href="/contact-sales">Join beta</Link>} />
        <IntegrationCard name="Microsoft Teams" badge="Design partner" description="Shared-stage collaboration first. Camera-overlay capability will be claimed only after client-specific validation." state="preview" details="Windows and macOS desktop pilot planned." action={<Link className="button button-quiet" href="/contact-sales">Become a partner</Link>} />
      </div>
    </div>
  );
}

function IntegrationCard({ name, badge, description, state, details, action }: { name: string; badge: string; description: string; state: string; details: string; action: React.ReactNode }) {
  return <article className="integration-card"><div className={`integration-icon ${state}`}>{name.slice(0, 1)}</div><div className="integration-copy"><div><h2>{name}</h2><span>{badge}</span></div><p>{description}</p><small><i className="status-dot preview" />{details}</small></div><div>{action}</div></article>;
}

function extensionLinkMessage(code: string): string {
  if (code.includes("Receiving end does not exist") || code === "CHROME_EXTENSION_NOT_REACHABLE") return "Chrome could not reach this installation. Reload the extension, then reopen this setup page from its toolbar popup.";
  if (code === "NETWORK_UNAVAILABLE") return "Airboard could not reach the account service. Check your connection and try again.";
  if (code.startsWith("LINK_EXCHANGE_")) return "The one-time connection expired. Start Connect Airboard again from the extension popup.";
  return `Airboard could not connect this installation (${code}).`;
}
