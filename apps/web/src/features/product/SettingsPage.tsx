"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { airboardApi } from "../../platform/api";
import { useAirboardAuth } from "../../platform/auth";

type Preferences = { overlayEnabled: boolean; neonTheme: boolean; videoEnabled: boolean; audioEnabled: boolean; personOcclusion: boolean };
type DataRequest = { id: string; request_type: string; status: string; requested_at: string; execute_after: string | null; completed_at: string | null; error_code: string | null };
type AirboardSession = { id: string; provider: string; title: string | null; status: string; created_at: string; updated_at: string };

const DEFAULT_PREFERENCES: Preferences = { overlayEnabled: true, neonTheme: true, videoEnabled: true, audioEnabled: true, personOcclusion: true };

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
    await auth.refreshAccount(); setSaved("Defaults saved to your account and connected installations.");
  };

  return (
    <div className="settings-layout">
      <aside><h2>Settings</h2>{[["profile","Profile"],["preferences","Preferences"],["connected-accounts","Connected accounts"],["notifications","Notifications"],["privacy-data","Privacy & data"],["sessions","Sessions"]].map(([id,label]) => <Link className={section === id ? "active" : ""} href={`/app/settings/${id}`} key={id}>{label}</Link>)}</aside>
      <section className="settings-panel">
        {section === "profile" ? <><p className="eyebrow">Personal account</p><h1>Profile</h1><label>Display name<input value={name} onChange={(event) => setName(event.target.value)} /></label><label>Email<input disabled value={auth.account?.profile.email ?? ""} /></label><label>Timezone<input disabled value={auth.account?.profile.timezone ?? "UTC"} /></label><button className="button button-primary" onClick={() => void saveProfile()}>Save profile</button></> : null}
        {section === "preferences" ? <><p className="eyebrow">Default experience</p><h1>Meeting and canvas preferences</h1><p>These defaults follow your account. Media capture still requires affirmative confirmation on the first installation.</p><Toggle label="Enable Airboard overlay" detail="Composite the diagram into supported meeting cameras." value={preferences.overlayEnabled} set={(value) => setPreferences({ ...preferences, overlayEnabled: value })} /><Toggle label="Neon lightboard theme" detail="Use high-contrast glowing strokes over video and screens." value={preferences.neonTheme} set={(value) => setPreferences({ ...preferences, neonTheme: value })} /><Toggle label="Airboard video input" detail="Use the meeting camera for gesture alignment and occlusion." value={preferences.videoEnabled} set={(value) => setPreferences({ ...preferences, videoEnabled: value })} /><Toggle label="Airboard audio input" detail="Use the microphone for Airo commands when policy allows." value={preferences.audioEnabled} set={(value) => setPreferences({ ...preferences, audioEnabled: value })} /><Toggle label="Keep presenter in front" detail="On-device person segmentation places diagram ink behind you." value={preferences.personOcclusion} set={(value) => setPreferences({ ...preferences, personOcclusion: value })} /><button className="button button-primary" onClick={() => void savePreferences()}>Save defaults</button></> : null}
        {section === "connected-accounts" ? <ConnectedAccounts /> : null}
        {section === "notifications" ? <NotificationSettings /> : null}
        {section === "privacy-data" ? <PrivacySettings /> : null}
        {section === "sessions" ? <SessionSettings /> : null}
        {saved ? <p className="form-message">{saved}</p> : null}
      </section>
    </div>
  );
}

function Toggle({ label, detail, value, set, disabled = false }: { label: string; detail: string; value: boolean; set: (value: boolean) => void; disabled?: boolean }) { return <label className="setting-toggle"><div><strong>{label}</strong><span>{detail}</span></div><input type="checkbox" checked={value} disabled={disabled} onChange={(event) => set(event.target.checked)} /></label>; }

function ConnectedAccounts() {
  const auth = useAirboardAuth();
  const identities = auth.session?.user.identities ?? [];
  return <><p className="eyebrow">Authentication</p><h1>Connected accounts</h1><p>Identity providers are managed by Supabase Auth; provider access tokens never enter Airboard board data.</p><div className="data-table"><div className="table-head"><span>Provider</span><span>Address</span><span>Status</span></div>{identities.length ? identities.map((identity) => <div key={identity.id}><span><strong>{identity.provider}</strong></span><span>{String(identity.identity_data?.email ?? auth.account?.profile.email ?? "—")}</span><span>Connected</span></div>) : <div><span><strong>Development identity</strong><small>Loopback only</small></span><span>{auth.account?.profile.email}</span><span>Active</span></div>}</div></>;
}

function NotificationSettings() {
  const auth = useAirboardAuth();
  const [preferences, setPreferences] = useState({ product: true, trial: true, security: true, billing: true });
  const [message, setMessage] = useState<string | null>(null);
  useEffect(() => setPreferences((current) => ({ ...current, ...auth.account?.profile.notificationPreferences })), [auth.account]);
  const save = async () => { if (!auth.accessToken) return; await airboardApi("/me/notifications", { method: "PATCH", accessToken: auth.accessToken, body: JSON.stringify(preferences) }); await auth.refreshAccount(); setMessage("Notification preferences saved."); };
  return <><p className="eyebrow">Messages</p><h1>Notifications</h1><Toggle label="Product guidance" detail="Occasional onboarding and feature guidance." value={preferences.product} set={(product) => setPreferences({ ...preferences, product })} /><Toggle label="Trial reminders" detail="Welcome, 24-hour and 6-hour trial reminders." value={preferences.trial} set={(trial) => setPreferences({ ...preferences, trial })} /><Toggle label="Security notices" detail="Required sign-in, privacy and security messages." value={preferences.security} set={() => undefined} disabled /><Toggle label="Billing notices" detail="Required subscription and payment messages." value={preferences.billing} set={() => undefined} disabled /><button className="button button-primary" onClick={() => void save()}>Save notifications</button>{message ? <p className="form-message">{message}</p> : null}</>;
}

function PrivacySettings() {
  const auth = useAirboardAuth();
  const [requests, setRequests] = useState<DataRequest[]>([]);
  const [confirmation, setConfirmation] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const reload = async () => { if (!auth.accessToken) return; const result = await airboardApi<{ requests: DataRequest[] }>("/privacy/data-requests", { accessToken: auth.accessToken }); setRequests(result.requests); };
  useEffect(() => { void reload(); }, [auth.accessToken]);
  const request = async (requestType: "export" | "delete_account") => { if (!auth.accessToken) return; const result = await airboardApi<{ id: string }>("/privacy/data-requests", { method: "POST", accessToken: auth.accessToken, body: JSON.stringify({ requestType, ...(requestType === "delete_account" ? { confirmation } : {}) }) }); setMessage(requestType === "export" ? `Export queued: ${result.id}` : "Deletion scheduled with a seven-day cancellation window."); setConfirmation(""); await reload(); };
  const cancel = async (id: string) => { if (!auth.accessToken) return; await airboardApi(`/privacy/data-requests/${id}`, { method: "DELETE", accessToken: auth.accessToken }); await reload(); };
  const download = async (id: string) => { if (!auth.accessToken) return; const result = await airboardApi<Record<string, unknown>>(`/privacy/data-requests/${id}/export`, { accessToken: auth.accessToken }); const url = URL.createObjectURL(new Blob([JSON.stringify(result, null, 2)], { type: "application/json" })); const anchor = document.createElement("a"); anchor.href = url; anchor.download = `airboard-data-${id}.json`; anchor.click(); URL.revokeObjectURL(url); };
  return <><p className="eyebrow">Your information</p><h1>Privacy & data</h1><div className="privacy-card"><strong>Raw media is not stored</strong><p>Camera and microphone data is processed live. Product analytics excludes board content, labels, transcripts and meeting URLs.</p></div><div className="settings-action-row"><div><strong>Export my data</strong><span>Create a portable JSON export of account, board, consent and integration data.</span></div><button onClick={() => void request("export")}>Request export</button></div><div className="settings-action-row danger"><div><strong>Close my account</strong><span>Type DELETE to schedule account removal. You can cancel for seven days.</span><input value={confirmation} onChange={(event) => setConfirmation(event.target.value)} placeholder="Type DELETE" /></div><button disabled={confirmation !== "DELETE"} onClick={() => void request("delete_account")}>Schedule deletion</button></div>{message ? <p className="form-message">{message}</p> : null}<div className="data-table"><div className="table-head"><span>Request</span><span>Status</span><span>Action</span></div>{requests.map((item) => <div key={item.id}><span><strong>{item.request_type.replaceAll("_", " ")}</strong><small>{new Date(item.requested_at).toLocaleString()}</small></span><span>{item.status}</span><span>{item.request_type === "export" && item.status === "completed" ? <button onClick={() => void download(item.id)}>Download</button> : item.status === "queued" ? <button onClick={() => void cancel(item.id)}>Cancel</button> : "—"}</span></div>)}</div></>;
}

function SessionSettings() {
  const auth = useAirboardAuth();
  const [sessions, setSessions] = useState<AirboardSession[]>([]);
  const reload = async () => { if (!auth.accessToken) return; const result = await airboardApi<{ sessions: AirboardSession[] }>("/me/sessions", { accessToken: auth.accessToken }); setSessions(result.sessions); };
  useEffect(() => { void reload(); }, [auth.accessToken]);
  const end = async (id: string) => { if (!auth.accessToken) return; await airboardApi(`/me/sessions/${id}`, { method: "DELETE", accessToken: auth.accessToken }); await reload(); };
  return <><p className="eyebrow">Live access</p><h1>Sessions</h1><p>End stale collaboration sessions and revoke their realtime access.</p><div className="data-table"><div className="table-head"><span>Session</span><span>Status</span><span>Action</span></div>{sessions.length ? sessions.map((session) => <div key={session.id}><span><strong>{session.title ?? "Airboard"}</strong><small>{session.provider} · {new Date(session.created_at).toLocaleString()}</small></span><span>{session.status}</span><span>{session.status !== "ended" ? <button onClick={() => void end(session.id)}>End</button> : "—"}</span></div>) : <div><span>No sessions yet.</span></div>}</div></>;
}
