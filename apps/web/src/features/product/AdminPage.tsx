"use client";

import { useEffect, useState } from "react";
import { airboardApi } from "../../platform/api";
import { useAirboardAuth } from "../../platform/auth";
import { FormStatus } from "./FormStatus";

/** A team workspace's admin pages, shown inside Settings to owners and admins. */
export function WorkspaceAdminSection({ section }: { section: string }) {
  if (section === "members") return <MembersAdmin />;
  if (section === "policies") return <PoliciesAdmin />;
  return <AuditAdmin />;
}

type Organization = { organization_id: string; organizations: { name?: string } | null };
const WORKSPACE_KIND_LABEL = { personal: "Personal workspace", team: "Team workspace", enterprise: "Enterprise workspace" } as const;

/** Which workspace you're in, switching between yours, and a team's numbers for its admins. */
export function WorkspaceSettings({ isAdmin }: { isAdmin: boolean }) {
  const auth = useAirboardAuth();
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [usage, setUsage] = useState<{ members: number; boards: number; sessions30d: number } | null>(null);
  const [switching, setSwitching] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  useEffect(() => {
    if (!auth.accessToken) return;
    void airboardApi<{ organizations: Organization[] }>("/me/organizations", { accessToken: auth.accessToken })
      .then((result) => setOrganizations(result.organizations))
      .catch(() => undefined);
  }, [auth.accessToken]);
  useEffect(() => {
    if (!auth.accessToken || !isAdmin) return;
    void airboardApi<{ usage: { members: number; boards: number; sessions30d: number } }>("/organization/usage", { accessToken: auth.accessToken })
      .then((result) => setUsage(result.usage))
      .catch(() => undefined);
  }, [auth.accessToken, isAdmin]);
  const selectOrganization = async (organizationId: string) => {
    if (!auth.accessToken || organizationId === auth.account?.organization.id) return;
    setSwitching(true);
    setMessage(null);
    try {
      await airboardApi(`/me/organizations/${organizationId}/select`, { method: "POST", accessToken: auth.accessToken });
      await auth.refreshAccount();
      window.location.assign("/app");
    } catch {
      setSwitching(false);
      setMessage("Could not switch workspace. Try again.");
    }
  };
  const organization = auth.account?.organization;
  return <>
    <p className="eyebrow">{organization ? WORKSPACE_KIND_LABEL[organization.kind] : "Workspace"}</p>
    <h1>{organization?.name ?? "Your workspace"}</h1>
    <p>Your Airboards, members and plan belong to this workspace.</p>
    {organizations.length > 1 ? <label>Switch workspace<select disabled={switching} value={organization?.id ?? ""} onChange={(event) => void selectOrganization(event.target.value)}>{organizations.map((membership) => <option value={membership.organization_id} key={membership.organization_id}>{membership.organizations?.name ?? "Airboard workspace"}</option>)}</select></label> : null}
    {isAdmin && usage ? <div className="metric-grid"><Metric label="Members" value={String(usage.members)} detail="Active access" /><Metric label="Boards" value={String(usage.boards)} detail="Saved workspace content" /><Metric label="Sessions" value={String(usage.sessions30d)} detail="Last 30 days" /></div> : null}
    <FormStatus tone="warning" message={message} />
  </>;
}

type Member = { id: string; role: string; status: string; profiles?: { display_name?: string; email?: string } };
type Invitation = { id: string; email: string; role: string; expires_at: string; accepted_at: string | null; revoked_at: string | null };
function MembersAdmin() {
  const auth = useAirboardAuth();
  const [members, setMembers] = useState<Member[]>([]);
  const [invitations, setInvitations] = useState<Invitation[]>([]);
  const [email, setEmail] = useState(""); const [role, setRole] = useState("member"); const [message, setMessage] = useState<string | null>(null);
  // Shown once: the API keeps only a hash of the invitation token.
  const [inviteLink, setInviteLink] = useState<{ email: string; url: string } | null>(null);
  const reload = async () => { if (!auth.accessToken) return; const [memberResult, invitationResult] = await Promise.all([airboardApi<{ members: Member[] }>("/organization/members", { accessToken: auth.accessToken }), airboardApi<{ invitations: Invitation[] }>("/organization/invitations", { accessToken: auth.accessToken })]); setMembers(memberResult.members); setInvitations(invitationResult.invitations); };
  // reload only reads the current token, so the token is the trigger.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { void reload(); }, [auth.accessToken]);
  const invite = async () => { if (!auth.accessToken) return; const result = await airboardApi<{ invitationId: string; inviteUrl?: string }>("/organization/invitations", { method: "POST", accessToken: auth.accessToken, body: JSON.stringify({ email, role }) }); setInviteLink(result.inviteUrl ? { email, url: result.inviteUrl } : null); setMessage(result.inviteUrl ? `Invitation created. Send ${email} this link; they join by signing in as ${email}.` : `Invitation queued (${result.invitationId}).`); setEmail(""); await reload(); };
  const copyInviteLink = async () => { if (!inviteLink) return; try { await navigator.clipboard.writeText(inviteLink.url); setMessage(`Invite link for ${inviteLink.email} copied.`); } catch { setMessage("Copy failed. Select the link and copy it."); } };
  const update = async (id: string, change: Record<string, string>) => { if (!auth.accessToken) return; await airboardApi(`/organization/members/${id}`, { method: "PATCH", accessToken: auth.accessToken, body: JSON.stringify(change) }); await reload(); };
  const revoke = async (id: string) => { if (!auth.accessToken) return; await airboardApi(`/organization/invitations/${id}`, { method: "DELETE", accessToken: auth.accessToken }); await reload(); };
  return <div><section className="app-page-heading"><p className="eyebrow">People and access</p><h1>Members</h1><p>Invite, assign roles and suspend access without sharing provider credentials.</p></section><div className="invite-row"><input type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="teammate@company.com" aria-label="Email to invite" /><select value={role} onChange={(event) => setRole(event.target.value)} aria-label="Invite as"><option value="member">Member</option><option value="viewer">Viewer</option><option value="billing">Billing</option><option value="admin">Admin</option></select><button className="button button-primary" disabled={!email} onClick={() => void invite()}>Invite</button></div><FormStatus message={message} />{inviteLink ? <div className="invite-row invite-link-row"><input readOnly value={inviteLink.url} aria-label={`Invite link for ${inviteLink.email}`} onFocus={(event) => event.currentTarget.select()} /><button className="button" onClick={() => void copyInviteLink()}>Copy invite link</button></div> : null}<div className="data-table" role="table" aria-label="Members"><div className="table-head" role="row"><span role="columnheader">Member</span><span role="columnheader">Role</span><span role="columnheader">Status</span></div>{members.map((member) => <div key={member.id} role="row"><span role="cell"><strong>{member.profiles?.display_name ?? "Member"}</strong><small>{member.profiles?.email}</small></span><span role="cell"><select value={member.role} aria-label={`Role for ${member.profiles?.display_name ?? member.profiles?.email ?? "member"}`} onChange={(event) => void update(member.id, { role: event.target.value })}><option value="owner">Owner</option><option value="admin">Admin</option><option value="billing">Billing</option><option value="member">Member</option><option value="viewer">Viewer</option></select></span><span role="cell"><button onClick={() => void update(member.id, { status: member.status === "active" ? "suspended" : "active" })} aria-label={`${member.status}, ${member.status === "active" ? "suspend" : "reactivate"} ${member.profiles?.display_name ?? member.profiles?.email ?? "member"}`}>{member.status}</button></span></div>)}</div>{invitations.some((item) => !item.accepted_at && !item.revoked_at) ? <><h2>Pending invitations</h2><div className="data-table" role="table" aria-label="Pending invitations"><div className="table-head" role="row"><span role="columnheader">Email</span><span role="columnheader">Role</span><span role="columnheader">Action</span></div>{invitations.filter((item) => !item.accepted_at && !item.revoked_at).map((item) => <div key={item.id} role="row"><span role="cell"><strong>{item.email}</strong><small>Expires {new Date(item.expires_at).toLocaleDateString()}</small></span><span role="cell">{item.role}</span><span role="cell"><button onClick={() => void revoke(item.id)}>Revoke</button></span></div>)}</div></> : null}</div>;
}

function PoliciesAdmin() {
  const auth = useAirboardAuth();
  const [policy, setPolicy] = useState({ externalGuestsAllowed: true, voiceEnabled: true, cameraEnabled: true, gestureEnabled: true, exportsEnabled: true, contentRetentionDays: 30 });
  const [message, setMessage] = useState<string | null>(null);
  useEffect(() => { if (!auth.accessToken) return; void airboardApi<{ policy: Record<string, unknown> }>("/organization/policies", { accessToken: auth.accessToken }).then(({ policy: value }) => { if (!value) return; setPolicy({ externalGuestsAllowed: value.external_guests_allowed !== false, voiceEnabled: value.voice_enabled !== false, cameraEnabled: value.camera_enabled !== false, gestureEnabled: value.gesture_enabled !== false, exportsEnabled: value.exports_enabled !== false, contentRetentionDays: Number(value.content_retention_days ?? 30) }); }); }, [auth.accessToken]);
  const save = async () => { if (!auth.accessToken) return; await airboardApi("/organization/policies", { method: "PATCH", accessToken: auth.accessToken, body: JSON.stringify(policy) }); setMessage("Organization policy updated and recorded in the audit log."); };
  const toggles: Array<[string, keyof Omit<typeof policy, "contentRetentionDays">, string]> = [
    ["External guests", "externalGuestsAllowed", "People outside the workspace can join live boards and open view-only links. When off, only signed-in members can join, and every view-only link stops working until it's turned back on."],
    ["Voice commands", "voiceEnabled", "Airo listens for spoken commands. When off, voice is refused for everyone in the workspace; typed commands still work."],
    ["Camera and gesture input", "cameraEnabled", "The camera, used for hand gestures."],
    ["Gesture control", "gestureEnabled", "Hand gestures on the board."],
    ["Exports", "exportsEnabled", "Downloading or copying boards as PNG or PDF. When off, those buttons stop working. People can still take screenshots."],
  ];
  return <div><section className="app-page-heading"><p className="eyebrow">Guardrails</p><h1>Organization policy</h1><p>These apply to everyone in the workspace.</p></section><div className="policy-panel">{toggles.map(([label,key,detail]) => <label className="setting-toggle" key={key}><div><strong>{label}</strong><span>{detail}</span></div><input type="checkbox" checked={policy[key]} onChange={(event) => setPolicy({ ...policy, [key]: event.target.checked })} /></label>)}<button className="button button-primary" onClick={() => void save()}>Save policy</button><FormStatus message={message} /></div><ShareLinksAdmin /></div>;
}

type AdminShareLink = { id: string; boardId: string; boardTitle: string; createdBy: string; createdAt: string; expiresAt: string | null };

/** Every working view-only link in the workspace, so an admin can turn any of them off. */
function ShareLinksAdmin() {
  const auth = useAirboardAuth();
  const [links, setLinks] = useState<AdminShareLink[] | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  useEffect(() => {
    if (!auth.accessToken) return;
    void airboardApi<{ links: AdminShareLink[] }>("/organization/share-links", { accessToken: auth.accessToken })
      .then((result) => setLinks(result.links))
      .catch(() => setMessage("View-only links could not be loaded. Reload the page to try again."));
  }, [auth.accessToken]);
  const turnOff = async (link: AdminShareLink) => {
    if (!auth.accessToken) return;
    try {
      await airboardApi(`/organization/share-links/${encodeURIComponent(link.id)}`, { method: "DELETE", accessToken: auth.accessToken });
      setLinks((current) => (current ?? []).filter((item) => item.id !== link.id));
      setMessage(`Turned off a view-only link to “${link.boardTitle}”. It is recorded in the audit log.`);
    } catch {
      setMessage("The link was not turned off. Check your connection and try again.");
    }
  };
  return (
    <section className="admin-share-links" aria-labelledby="admin-share-links-title">
      <h2 id="admin-share-links-title">View-only links</h2>
      <p>Links people in this workspace made so anyone can view a board. A link also stops working when the person who made it leaves the workspace, is suspended or becomes a Viewer.</p>
      <FormStatus message={message} />
      {links === null ? (message ? null : <p>Loading links…</p>) : links.length ? (
        <div className="data-table" role="table" aria-label="View-only links">
          <div className="table-head" role="row"><span role="columnheader">Board</span><span role="columnheader">Made by</span><span role="columnheader">Action</span></div>
          {links.map((link) => (
            <div key={link.id} role="row">
              <span role="cell"><strong>{link.boardTitle}</strong><small>{link.expiresAt ? `Expires ${new Date(link.expiresAt).toLocaleDateString()}` : "Until turned off"}</small></span>
              <span role="cell">{link.createdBy}</span>
              <span role="cell"><button type="button" onClick={() => void turnOff(link)} aria-label={`Turn off view-only link to ${link.boardTitle}`}>Turn off</button></span>
            </div>
          ))}
        </div>
      ) : <p>No working view-only links.</p>}
    </section>
  );
}

function AuditAdmin() { const auth = useAirboardAuth(); const [events, setEvents] = useState<Record<string, unknown>[]>([]); useEffect(() => { if (auth.accessToken) void airboardApi<{ events: Record<string, unknown>[] }>("/organization/audit", { accessToken: auth.accessToken }).then((result) => setEvents(result.events)); }, [auth.accessToken]); return <div><section className="app-page-heading"><p className="eyebrow">Recorded activity</p><h1>Audit log</h1><p>Administrative, security, consent, installation, billing and data-control actions retained for 365 days. Personal fields are anonymized when an account is deleted.</p></section><div className="data-table audit" role="table" aria-label="Audit events"><div className="table-head" role="row"><span role="columnheader">Action</span><span role="columnheader">Target</span><span role="columnheader">Time</span></div>{events.length ? events.map((event) => <div key={String(event.id)} role="row"><span role="cell"><strong>{String(event.action)}</strong><small>Request {String(event.request_id ?? "—")}</small></span><span role="cell">{String(event.target_type ?? "—")}</span><span role="cell">{new Date(String(event.occurred_at)).toLocaleString()}</span></div>) : <div role="row"><span role="cell">No audit events yet.</span></div>}</div></div>; }


function Metric({ label, value, detail }: { label: string; value: string; detail: string }) { return <article><span>{label}</span><strong>{value}</strong><small>{detail}</small></article>; }
