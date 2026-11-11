"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { airboardApi } from "../../platform/api";
import { useAirboardAuth } from "../../platform/auth";
import { FormStatus } from "./FormStatus";
import { WorkspaceAdminSection, WorkspaceSettings } from "./AdminPage";
import { isWorkspaceAdminSection, SETTINGS_SECTIONS, WORKSPACE_ADMIN_SECTIONS, WORKSPACE_SECTIONS } from "./pageTitles";

type Preferences = { overlayEnabled: boolean; neonTheme: boolean; videoEnabled: boolean; audioEnabled: boolean };
type DataRequest = { id: string; request_type: string; status: string; requested_at: string; execute_after: string | null; completed_at: string | null; error_code: string | null };
type AirboardSession = { id: string; provider: string; title: string | null; status: string; created_at: string; updated_at: string };

const DEFAULT_PREFERENCES: Preferences = { overlayEnabled: true, neonTheme: true, videoEnabled: true, audioEnabled: true };

export function SettingsPage({ section }: { section: string }) {
  const auth = useAirboardAuth();
  const [saved, setSaved] = useState<string | null>(null);
  const [preferences, setPreferences] = useState<Preferences>(DEFAULT_PREFERENCES);
  const [name, setName] = useState(auth.account?.profile.displayName ?? "");
  useEffect(() => {
    if (auth.account?.profile.preferences) setPreferences({ ...DEFAULT_PREFERENCES, ...auth.account.profile.preferences });
    if (auth.account?.profile.displayName) setName(auth.account.profile.displayName);
  }, [auth.account]);

  const saveProfile = async () => {
    if (!auth.accessToken || !auth.account) return;
    await airboardApi("/me/profile", { method: "PATCH", accessToken: auth.accessToken, body: JSON.stringify({ displayName: name, locale: auth.account.profile.locale, timezone: auth.account.profile.timezone }) });
    await auth.refreshAccount(); setSaved("Profile saved.");
  };
  const savePreferences = async () => {
    if (!auth.accessToken) return;
    await airboardApi("/me/preferences", { method: "PATCH", accessToken: auth.accessToken, body: JSON.stringify(preferences) });
    localStorage.setItem("airboard.preferences.v1", JSON.stringify(preferences));
    await auth.refreshAccount(); setSaved("Defaults saved to your account.");
  };

  // Members, policies, SSO and audit have nothing to manage in a workspace of one.
  const isAdmin = auth.account?.organization.kind !== "personal" && ["owner", "admin"].includes(auth.account?.organization.role ?? "");
  const workspaceSections = isAdmin ? [...WORKSPACE_SECTIONS, ...WORKSPACE_ADMIN_SECTIONS] : WORKSPACE_SECTIONS;
  const known = [...SETTINGS_SECTIONS, ...WORKSPACE_SECTIONS, ...WORKSPACE_ADMIN_SECTIONS].some(([id]) => id === section);
  const sectionLink = ([id, label]: readonly [string, string]) => <Link className={section === id ? "active" : ""} aria-current={section === id ? "page" : undefined} href={`/app/settings/${id}`} key={id}>{label}</Link>;

  // On a phone the sections are one scrolling row; keep the open one in view.
  const navRef = useRef<HTMLElement | null>(null);
  useEffect(() => {
    navRef.current?.querySelector<HTMLElement>('[aria-current="page"]')?.scrollIntoView?.({ block: "nearest", inline: "nearest" });
  }, [section, isAdmin]);

  return (
    <div className="settings-layout">
      <nav ref={navRef} aria-label="Settings">
        <h2>Settings</h2>
        <h3>Account</h3>
        {SETTINGS_SECTIONS.map(sectionLink)}
        <h3>Workspace</h3>
        {workspaceSections.map(sectionLink)}
      </nav>
      <section className="settings-panel">
        {section === "profile" ? <><p className="eyebrow">Personal account</p><h1>Profile</h1><label>Display name<input value={name} onChange={(event) => setName(event.target.value)} /></label><label>Email<input disabled value={auth.account?.profile.email ?? ""} /></label><label>Timezone<input disabled value={auth.account?.profile.timezone ?? "UTC"} /></label><button className="button button-primary" onClick={() => void saveProfile()}>Save profile</button></> : null}
        {section === "preferences" ? <><p className="eyebrow">Default experience</p><h1>Board preferences</h1><p>These defaults follow your account. Your browser asks before Airboard uses your camera or microphone.</p><Toggle label="Neon lightboard theme" detail="Use high-contrast glowing strokes over video and screens." value={preferences.neonTheme} set={(value) => setPreferences({ ...preferences, neonTheme: value })} /><Toggle label="Airboard video input" detail="Starts with every board: shows you behind the board and follows your hands. Turn off to keep the camera off." value={preferences.videoEnabled} set={(value) => setPreferences({ ...preferences, videoEnabled: value })} /><Toggle label="Airboard audio input" detail="Starts with every board, for Airo voice commands. Turn off to keep the microphone off." value={preferences.audioEnabled} set={(value) => setPreferences({ ...preferences, audioEnabled: value })} /><button className="button button-primary" onClick={() => void savePreferences()}>Save defaults</button></> : null}
        {section === "connected-accounts" ? <ConnectedAccounts /> : null}
        {section === "notifications" ? <NotificationSettings /> : null}
        {section === "privacy-data" ? <PrivacySettings /> : null}
        {section === "sessions" ? <SessionSettings /> : null}
        {section === "workspace" ? <WorkspaceSettings isAdmin={isAdmin} /> : null}
        {isWorkspaceAdminSection(section) ? (isAdmin ? <WorkspaceAdminSection section={section} /> : <><h1>Workspace settings</h1><p>Only the owners and admins of a team workspace can open this page.</p></>) : null}
        {known ? null : <><h1>Settings</h1><p>That settings page doesn&apos;t exist. Choose a section from the list.</p></>}
        <FormStatus message={saved} />
      </section>
    </div>
  );
}

function Toggle({ label, detail, value, set, disabled = false }: { label: string; detail: string; value: boolean; set: (value: boolean) => void; disabled?: boolean }) { return <label className="setting-toggle"><div><strong>{label}</strong><span>{detail}</span></div><input type="checkbox" checked={value} disabled={disabled} onChange={(event) => set(event.target.checked)} /></label>; }

function ConnectedAccounts() {
  const auth = useAirboardAuth();
  const identities = auth.session?.user.identities ?? [];
  return <><p className="eyebrow">Authentication</p><h1>Connected accounts</h1><p>Identity providers are managed by Supabase Auth; provider access tokens never enter Airboard board data.</p><div className="data-table" role="table" aria-label="Connected accounts"><div className="table-head" role="row"><span role="columnheader">Provider</span><span role="columnheader">Address</span><span role="columnheader">Status</span></div>{identities.length ? identities.map((identity) => <div key={identity.id} role="row"><span role="cell"><strong>{identity.provider}</strong></span><span role="cell">{String(identity.identity_data?.email ?? auth.account?.profile.email ?? "—")}</span><span role="cell">Connected</span></div>) : <div role="row"><span role="cell"><strong>Development identity</strong><small>Loopback only</small></span><span role="cell">{auth.account?.profile.email}</span><span role="cell">Active</span></div>}</div></>;
}

function NotificationSettings() {
  const auth = useAirboardAuth();
  const [preferences, setPreferences] = useState({ product: true, trial: true, security: true, billing: true });
  const [message, setMessage] = useState<string | null>(null);
  useEffect(() => setPreferences((current) => ({ ...current, ...auth.account?.profile.notificationPreferences })), [auth.account]);
  const save = async () => { if (!auth.accessToken) return; await airboardApi("/me/notifications", { method: "PATCH", accessToken: auth.accessToken, body: JSON.stringify(preferences) }); await auth.refreshAccount(); setMessage("Notification preferences saved."); };
  return <><p className="eyebrow">Messages</p><h1>Notifications</h1><Toggle label="Product guidance" detail="Occasional onboarding and feature guidance." value={preferences.product} set={(product) => setPreferences({ ...preferences, product })} /><Toggle label="Trial reminders" detail="Welcome, 24-hour and 6-hour trial reminders." value={preferences.trial} set={(trial) => setPreferences({ ...preferences, trial })} /><Toggle label="Security notices" detail="Required sign-in, privacy and security messages." value={preferences.security} set={() => undefined} disabled /><Toggle label="Billing notices" detail="Required subscription and payment messages." value={preferences.billing} set={() => undefined} disabled /><button className="button button-primary" onClick={() => void save()}>Save notifications</button><FormStatus message={message} /></>;
}

function PrivacySettings() {
  const auth = useAirboardAuth();
  const [requests, setRequests] = useState<DataRequest[]>([]);
  const [confirmation, setConfirmation] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const reload = async () => { if (!auth.accessToken) return; const result = await airboardApi<{ requests: DataRequest[] }>("/privacy/data-requests", { accessToken: auth.accessToken }); setRequests(result.requests); };
  // reload only reads the current token, so the token is the trigger.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { void reload(); }, [auth.accessToken]);
  const request = async (requestType: "export" | "delete_account") => { if (!auth.accessToken) return; const result = await airboardApi<{ id: string }>("/privacy/data-requests", { method: "POST", accessToken: auth.accessToken, body: JSON.stringify({ requestType, ...(requestType === "delete_account" ? { confirmation } : {}) }) }); setMessage(requestType === "export" ? `Export queued: ${result.id}` : "Deletion scheduled with a seven-day cancellation window."); setConfirmation(""); await reload(); };
  const cancel = async (id: string) => { if (!auth.accessToken) return; await airboardApi(`/privacy/data-requests/${id}`, { method: "DELETE", accessToken: auth.accessToken }); await reload(); };
  const download = async (id: string) => { if (!auth.accessToken) return; const result = await airboardApi<Record<string, unknown>>(`/privacy/data-requests/${id}/export`, { accessToken: auth.accessToken }); const url = URL.createObjectURL(new Blob([JSON.stringify(result, null, 2)], { type: "application/json" })); const anchor = document.createElement("a"); anchor.href = url; anchor.download = `airboard-data-${id}.json`; anchor.click(); URL.revokeObjectURL(url); };
  const createDiagnosticBundle = async () => {
    if (!auth.accessToken) return;
    await airboardApi("/consents", {
      method: "POST",
      accessToken: auth.accessToken,
      body: JSON.stringify({ consentType: "support_diagnostics", granted: true, documentVersion: "2026-07-25", source: "privacy_settings" }),
    });
    const result = await airboardApi<{ id: string; expiresAt: string | null }>("/support/diagnostics", {
      method: "POST",
      accessToken: auth.accessToken,
      body: JSON.stringify({
        includesContent: false,
        diagnostics: {
          appVersion: "web-pilot",
          platform: "standalone",
          browser: navigator.userAgent,
          operatingSystem: navigator.platform,
          permissionStates: {},
          capabilities: {
            mediaDevices: Boolean(navigator.mediaDevices),
            displayCapture: Boolean(navigator.mediaDevices?.getDisplayMedia),
          },
          errorCodes: [],
          traceIds: [],
          timings: {},
          featureFlags: {},
        },
      }),
    });
    setMessage(`Sanitized diagnostic bundle ${result.id} created${result.expiresAt ? `; it expires ${new Date(result.expiresAt).toLocaleString()}` : ""}.`);
  };
  return <><p className="eyebrow">Your information</p><h1>Privacy & data</h1><div className="privacy-card"><strong>Raw media is not stored by Airboard</strong><p>Camera and microphone data is processed live. Deepgram receives audio only while Airo transcription is active. OpenAI may receive bounded command text and board context only when deterministic command parsing cannot safely finish. Product analytics excludes board content, labels, transcripts and meeting URLs and is retained for 90 days; content-free voice stage and outcome metadata expires within 14 days.</p></div><div className="settings-action-row"><div><strong>Create a support diagnostic</strong><span>Share browser, capability, permission-state, timing and error metadata for seven days. Board content, transcript, meeting URLs and raw media are excluded.</span></div><button onClick={() => void createDiagnosticBundle()}>Create bundle</button></div><div className="settings-action-row"><div><strong>Export my data</strong><span>Create a portable JSON export of account, board, consent and integration data.</span></div><button onClick={() => void request("export")}>Request export</button></div><div className="settings-action-row danger"><div><strong>Close my account</strong><span>Type DELETE to schedule account removal. You can cancel for seven days.</span><input value={confirmation} onChange={(event) => setConfirmation(event.target.value)} placeholder="Type DELETE" /></div><button disabled={confirmation !== "DELETE"} onClick={() => void request("delete_account")}>Schedule deletion</button></div><FormStatus message={message} /><div className="data-table" role="table" aria-label="Data requests"><div className="table-head" role="row"><span role="columnheader">Request</span><span role="columnheader">Status</span><span role="columnheader">Action</span></div>{requests.map((item) => <div key={item.id} role="row"><span role="cell"><strong>{item.request_type.replaceAll("_", " ")}</strong><small>{new Date(item.requested_at).toLocaleString()}</small></span><span role="cell">{item.status}</span><span role="cell">{item.request_type === "export" && item.status === "completed" ? <button onClick={() => void download(item.id)}>Download</button> : item.status === "queued" ? <button onClick={() => void cancel(item.id)}>Cancel</button> : "—"}</span></div>)}</div></>;
}

function SessionSettings() {
  const auth = useAirboardAuth();
  const [sessions, setSessions] = useState<AirboardSession[]>([]);
  const reload = async () => { if (!auth.accessToken) return; const result = await airboardApi<{ sessions: AirboardSession[] }>("/me/sessions", { accessToken: auth.accessToken }); setSessions(result.sessions); };
  // reload only reads the current token, so the token is the trigger.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { void reload(); }, [auth.accessToken]);
  const end = async (id: string) => { if (!auth.accessToken) return; await airboardApi(`/me/sessions/${id}`, { method: "DELETE", accessToken: auth.accessToken }); await reload(); };
  return <><p className="eyebrow">Live access</p><h1>Sessions</h1><p>End stale collaboration sessions and revoke their realtime access.</p><div className="data-table" role="table" aria-label="Sessions"><div className="table-head" role="row"><span role="columnheader">Session</span><span role="columnheader">Status</span><span role="columnheader">Action</span></div>{sessions.length ? sessions.map((session) => <div key={session.id} role="row"><span role="cell"><strong>{session.title ?? "Airboard"}</strong><small>{session.provider} · {new Date(session.created_at).toLocaleString()}</small></span><span role="cell">{session.status}</span><span role="cell">{session.status !== "ended" ? <button onClick={() => void end(session.id)}>End</button> : "—"}</span></div>) : <div role="row"><span role="cell">No sessions yet.</span></div>}</div></>;
}
