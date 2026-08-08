"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { useAirboardAuth } from "../../platform/auth";
import { airboardApi } from "../../platform/api";
import { isImmersiveBoardPath } from "./productRouting";

const MAIN_NAV = [
  ["/app", "Overview", "⌂"],
  ["/app/boards", "Boards", "◇"],
  ["/app/templates", "Templates", "✦"],
  ["/app/integrations", "Integrations", "∞"],
  ["/app/activity", "Activity", "∿"],
] as const;

const ADMIN_NAV = [
  ["/app/admin/overview", "Admin overview", "◫"],
  ["/app/admin/members", "Members", "◎"],
  ["/app/admin/policies", "Policies", "⊙"],
  ["/app/admin/identity-directory", "SSO & SCIM", "⌘"],
  ["/app/admin/installations", "Installation health", "↗"],
  ["/app/admin/audit-logs", "Audit log", "≋"],
] as const;

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const auth = useAirboardAuth();
  const [organizations, setOrganizations] = useState<Array<{ organization_id: string; organizations: { name?: string } | null }>>([]);
  useEffect(() => {
    if (!auth.accessToken) return;
    void airboardApi<{ organizations: Array<{ organization_id: string; organizations: { name?: string } | null }> }>("/me/organizations", { accessToken: auth.accessToken }).then((result) => setOrganizations(result.organizations));
  }, [auth.accessToken, auth.account?.organization.id]);
  const selectOrganization = async (organizationId: string) => {
    if (!auth.accessToken || organizationId === auth.account?.organization.id) return;
    await airboardApi(`/me/organizations/${organizationId}/select`, { method: "POST", accessToken: auth.accessToken });
    await auth.refreshAccount();
    window.location.assign("/app");
  };
  const isAdmin = ["owner", "admin"].includes(auth.account?.organization.role ?? "");
  const isBoardWorkspace = isImmersiveBoardPath(pathname);
  return (
    <div className={`app-shell${isBoardWorkspace ? " board-app-shell" : ""}`}>
      {!isBoardWorkspace ? <aside className="app-sidebar">
        <Link className="app-brand" href="/app"><span className="brand-orbit" />Airboard</Link>
        <div className="workspace-switcher">
          <span>{auth.account?.organization.kind ?? "workspace"}</span>
          {organizations.length > 1 ? <select aria-label="Current organization" value={auth.account?.organization.id ?? ""} onChange={(event) => void selectOrganization(event.target.value)}>{organizations.map((membership) => <option value={membership.organization_id} key={membership.organization_id}>{membership.organizations?.name ?? "Airboard workspace"}</option>)}</select> : <strong>{auth.account?.organization.name ?? "Your Airboard"}</strong>}
        </div>
        <nav aria-label="Airboard">
          {MAIN_NAV.map(([href, label, glyph]) => (
            <Link className={navActive(pathname, href) ? "active" : ""} href={href} key={href}><span className="nav-glyph" aria-hidden="true">{glyph}</span><span>{label}</span></Link>
          ))}
        </nav>
        {isAdmin ? (
          <nav className="admin-nav" aria-label="Administration">
            <span>Administration</span>
            {ADMIN_NAV.map(([href, label, glyph]) => (
              <Link className={navActive(pathname, href) ? "active" : ""} href={href} key={href}><span className="nav-glyph" aria-hidden="true">{glyph}</span><span>{label}</span></Link>
            ))}
          </nav>
        ) : null}
        <div className="sidebar-bottom">
          <Link href="/help">Help center</Link>
          <Link href="/app/billing">Plan & billing</Link>
          <Link href="/app/settings/profile">Settings</Link>
          <button
            className="sidebar-account"
            onClick={() => void auth.signOut().then(() => router.push("/"))}
          >
            <span>{initials(auth.account?.profile.displayName)}</span>
            <div><strong>{auth.account?.profile.displayName ?? "Airboard user"}</strong><small>Sign out</small></div>
          </button>
        </div>
      </aside> : null}
      <div className="app-main">
        <main className="app-content">{children}</main>
      </div>
      {!isBoardWorkspace ? <nav className="app-mobile-nav" aria-label="Airboard mobile navigation">
        {[...MAIN_NAV.slice(0, 4), ["/help", "Help", "?"] as const].map(([href, label, glyph]) => (
          <Link className={navActive(pathname, href) ? "active" : ""} href={href} key={href}><span aria-hidden="true">{glyph}</span><small>{label}</small></Link>
        ))}
      </nav> : null}
    </div>
  );
}

function initials(value?: string): string {
  return (value ?? "A")
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");
}

function navActive(pathname: string, href: string): boolean {
  return href === "/app" ? pathname === href : pathname === href || pathname.startsWith(`${href}/`);
}
