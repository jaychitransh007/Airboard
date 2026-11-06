"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useAirboardAuth } from "../../platform/auth";
import { airboardApi } from "../../platform/api";
import { MaintenanceBanner } from "./MaintenanceBanner";
import { isImmersiveBoardPath } from "./productRouting";

const MAIN_NAV = [
  ["/app", "Overview", "⌂"],
  ["/app/boards", "Boards", "◇"],
  ["/app/templates", "Templates", "✦"],
  ["/app/integrations", "Integrations", "∞"],
  ["/app/activity", "Activity", "∿"],
] as const;

// Boards other members opened up to the whole workspace; personal workspaces have none.
const SHARED_NAV = ["/app/shared", "Shared", "⇄"] as const;

const WORKSPACE_KIND_LABEL = { personal: "Personal workspace", team: "Team workspace", enterprise: "Enterprise workspace" } as const;

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
  const isBoardWorkspace = isImmersiveBoardPath(pathname);
  useEffect(() => {
    // The organization switcher lives in the sidebar, which a board hides.
    if (!auth.accessToken || isBoardWorkspace) return;
    void airboardApi<{ organizations: Array<{ organization_id: string; organizations: { name?: string } | null }> }>("/me/organizations", { accessToken: auth.accessToken }).then((result) => setOrganizations(result.organizations));
  }, [auth.accessToken, auth.account?.organization.id, isBoardWorkspace]);
  const selectOrganization = async (organizationId: string) => {
    if (!auth.accessToken || organizationId === auth.account?.organization.id) return;
    await airboardApi(`/me/organizations/${organizationId}/select`, { method: "POST", accessToken: auth.accessToken });
    await auth.refreshAccount();
    window.location.assign("/app");
  };
  const personal = auth.account?.organization.kind === "personal";
  // Members, policies, SSO and audit have nothing to manage in a workspace of one.
  const isAdmin = !personal && ["owner", "admin"].includes(auth.account?.organization.role ?? "");
  const mainNav = personal ? MAIN_NAV : [MAIN_NAV[0], MAIN_NAV[1], SHARED_NAV, ...MAIN_NAV.slice(2)];
  // Narrow windows (phones, or a desktop zoomed to 200% or more) hide the
  // sidebar; the bottom bar's More opens everything that doesn't fit in it.
  const [moreOpen, setMoreOpen] = useState(false);
  const moreButtonRef = useRef<HTMLButtonElement | null>(null);
  useEffect(() => setMoreOpen(false), [pathname]);
  useEffect(() => {
    if (!moreOpen) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setMoreOpen(false);
      moreButtonRef.current?.focus();
    };
    document.addEventListener("keydown", closeOnEscape);
    return () => document.removeEventListener("keydown", closeOnEscape);
  }, [moreOpen]);
  const signOut = () => void auth.signOut().then(() => router.push("/"));
  const organizationSelect = organizations.length > 1 ? <select aria-label="Current organization" value={auth.account?.organization.id ?? ""} onChange={(event) => void selectOrganization(event.target.value)}>{organizations.map((membership) => <option value={membership.organization_id} key={membership.organization_id}>{membership.organizations?.name ?? "Airboard workspace"}</option>)}</select> : null;
  return (
    <div className={`app-shell${isBoardWorkspace ? " board-app-shell" : ""}`}>
      {/* A board has no navigation to skip past; its own landmarks do the job. */}
      {!isBoardWorkspace ? <a className="skip-link" href="#main-content">Skip to content</a> : null}
      <MaintenanceBanner />
      {!isBoardWorkspace ? <aside className="app-sidebar">
        <Link className="app-brand" href="/app"><span className="brand-orbit" />Airboard</Link>
        <div className="workspace-switcher">
          <span>{auth.account ? WORKSPACE_KIND_LABEL[auth.account.organization.kind] : "Workspace"}</span>
          {organizationSelect ?? <strong>{auth.account?.organization.name ?? "Your Airboard"}</strong>}
        </div>
        <nav aria-label="Airboard">
          {mainNav.map(([href, label, glyph]) => (
            <Link className={navActive(pathname, href) ? "active" : ""} aria-current={navActive(pathname, href) ? "page" : undefined} href={href} key={href}><span className="nav-glyph" aria-hidden="true">{glyph}</span><span>{label}</span></Link>
          ))}
        </nav>
        {isAdmin ? (
          <nav className="admin-nav" aria-label="Administration">
            <span>Administration</span>
            {ADMIN_NAV.map(([href, label, glyph]) => (
              <Link className={navActive(pathname, href) ? "active" : ""} aria-current={navActive(pathname, href) ? "page" : undefined} href={href} key={href}><span className="nav-glyph" aria-hidden="true">{glyph}</span><span>{label}</span></Link>
            ))}
          </nav>
        ) : null}
        <div className="sidebar-bottom">
          <Link href="/help">Help center</Link>
          <Link href="/app/billing">Plan & billing</Link>
          <Link href="/app/settings/profile">Settings</Link>
          <button
            className="sidebar-account"
            onClick={signOut}
          >
            <span>{initials(auth.account?.profile.displayName)}</span>
            <div><strong>{auth.account?.profile.displayName ?? "Airboard user"}</strong><small>Sign out</small></div>
          </button>
        </div>
      </aside> : null}
      <div className="app-main">
        {/* A board brings its own main landmark; one inside another would be two. */}
        {isBoardWorkspace
          ? <div className="app-content">{children}</div>
          : <main id="main-content" className="app-content" tabIndex={-1}>{children}</main>}
      </div>
      {!isBoardWorkspace ? <nav className="app-mobile-nav" aria-label="Airboard mobile navigation">
        {mainNav.slice(0, 4).map(([href, label, glyph]) => (
          <Link className={navActive(pathname, href) ? "active" : ""} aria-current={navActive(pathname, href) ? "page" : undefined} href={href} key={href}><span aria-hidden="true">{glyph}</span><small>{label}</small></Link>
        ))}
        <button
          ref={moreButtonRef}
          type="button"
          className="app-mobile-more"
          aria-expanded={moreOpen}
          aria-controls="app-mobile-menu"
          onClick={() => setMoreOpen((open) => !open)}
        >
          <span aria-hidden="true">⋯</span><small>More</small>
        </button>
        <div id="app-mobile-menu" className="app-mobile-menu" hidden={!moreOpen}>
          {organizationSelect}
          <ul aria-label="More pages">
            {[...mainNav.slice(4), ...(isAdmin ? ADMIN_NAV : []), ["/help", "Help center", "?"] as const, ["/app/billing", "Plan & billing", "◈"] as const, ["/app/settings/profile", "Settings", "⚙"] as const].map(([href, label]) => (
              <li key={href}><Link className={navActive(pathname, href) ? "active" : ""} aria-current={navActive(pathname, href) ? "page" : undefined} href={href}>{label}</Link></li>
            ))}
          </ul>
          <button type="button" className="app-mobile-sign-out" onClick={signOut}>Sign out</button>
        </div>
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
