"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useAirboardAuth } from "../../platform/auth";
import { useMenuKeyboard } from "../../platform/menuKeyboard";
import { MaintenanceBanner } from "./MaintenanceBanner";
import { isImmersiveBoardPath } from "./productRouting";

// Everything else lives on the home page; the profile menu holds the rest.
const PROFILE_MENU = [
  ["/app/settings/profile", "Profile"],
  ["/help", "Help Center"],
  ["/app/billing", "Plan & Billing"],
  ["/app/settings/preferences", "Settings"],
] as const;

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const isBoardWorkspace = isImmersiveBoardPath(pathname);
  return (
    <div className={`app-shell${isBoardWorkspace ? " board-app-shell" : ""}`}>
      {/* A board has no header to skip past; its own landmarks do the job. */}
      {!isBoardWorkspace ? <a className="skip-link" href="#main-content">Skip to content</a> : null}
      <MaintenanceBanner />
      {!isBoardWorkspace ? (
        <header className="app-header">
          <Link className="app-brand" href="/app"><span className="brand-orbit" />Airboard</Link>
          <ProfileMenu />
        </header>
      ) : null}
      <div className="app-main">
        {/* A board brings its own main landmark; one inside another would be two. */}
        {isBoardWorkspace
          ? <div className="app-content">{children}</div>
          : <main id="main-content" className="app-content" tabIndex={-1}>{children}</main>}
      </div>
    </div>
  );
}

function ProfileMenu() {
  const auth = useAirboardAuth();
  const router = useRouter();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  useMenuKeyboard(menuRef, open, () => setOpen(false));
  useEffect(() => setOpen(false), [pathname]);
  useEffect(() => {
    if (!open) return;
    const closeOutside = (event: PointerEvent) => {
      if (event.target instanceof Node && !wrapperRef.current?.contains(event.target)) setOpen(false);
    };
    // Escape still closes the menu once focus has left its items.
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setOpen(false);
      buttonRef.current?.focus();
    };
    document.addEventListener("pointerdown", closeOutside);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOutside);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [open]);
  const name = auth.account?.profile.displayName ?? "Airboard user";
  const signOut = () => void auth.signOut().then(() => router.push("/"));
  return (
    <div className="profile-menu" ref={wrapperRef}>
      <button
        ref={buttonRef}
        type="button"
        className="profile-button"
        aria-label={`Account menu for ${name}`}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls="profile-menu-items"
        onClick={(event) => {
          // Safari doesn't focus a clicked button; the menu returns focus here.
          event.currentTarget.focus();
          setOpen((current) => !current);
        }}
      >
        <svg aria-hidden="true" viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
          <circle cx="12" cy="8.5" r="3.6" />
          <path d="M5 19.5c1.4-3.3 4-5 7-5s5.6 1.7 7 5" />
        </svg>
      </button>
      {open ? (
        <div className="profile-menu-panel">
          <div className="profile-menu-identity">
            <strong>{name}</strong>
            {auth.account?.profile.email ? <small>{auth.account.profile.email}</small> : null}
          </div>
          <div id="profile-menu-items" ref={menuRef} role="menu" aria-label="Account">
            {PROFILE_MENU.map(([href, label]) => (
              <Link
                role="menuitem"
                href={href}
                key={href}
                aria-current={menuActive(pathname, href) ? "page" : undefined}
                onClick={() => setOpen(false)}
              >
                {label}
              </Link>
            ))}
            <button type="button" role="menuitem" className="profile-menu-sign-out" onClick={signOut}>
              Sign out
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function menuActive(pathname: string, href: string): boolean {
  if (href === "/app/settings/preferences") {
    return pathname.startsWith("/app/settings/") && pathname !== "/app/settings/profile";
  }
  return pathname === href || pathname.startsWith(`${href}/`);
}
