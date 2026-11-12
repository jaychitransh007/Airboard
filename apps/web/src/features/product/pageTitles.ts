/**
 * Page titles for routes whose content is chosen by a URL segment. Each page
 * needs its own title: browsers show it, and Next.js announces it to screen
 * readers after a client-side navigation, but only when it changes.
 *
 * A plain module (no "use client"), so route files can read it on the server.
 */

export const SETTINGS_SECTIONS = [
  ["profile", "Profile"],
  ["preferences", "Preferences"],
  ["connected-accounts", "Connected accounts"],
  ["notifications", "Notifications"],
  ["privacy-data", "Privacy & data"],
  ["sessions", "Sessions"],
] as const;

/** Workspace pages in Settings. Every member sees Workspace; the rest are for team owners and admins. */
export const WORKSPACE_SECTIONS = [
  ["workspace", "Workspace"],
] as const;

export const WORKSPACE_ADMIN_SECTIONS = [
  ["members", "Members"],
  ["policies", "Policies"],
  ["audit-logs", "Audit log"],
] as const;

// Old Administration links, from before admin moved into Settings. SSO & SCIM
// (identity-directory) was removed on 12 Nov 2026; its links land on Workspace.
const ADMIN_SECTION_MOVES: Record<string, string> = {
  overview: "workspace",
  installations: "workspace",
  members: "members",
  policies: "policies",
  "audit-logs": "audit-logs",
};

export function movedAdminSection(section: string): string {
  return ADMIN_SECTION_MOVES[section] ?? "workspace";
}

/** Settings pages that no longer exist, and where their old links now land. */
const REMOVED_SETTINGS_SECTIONS: Record<string, string> = {
  "identity-directory": "workspace",
};

export function removedSettingsSection(section: string): string | null {
  return REMOVED_SETTINGS_SECTIONS[section] ?? null;
}

export function isWorkspaceAdminSection(section: string): boolean {
  return WORKSPACE_ADMIN_SECTIONS.some(([id]) => id === section);
}

export function settingsSectionTitle(section: string): string {
  const label = [...SETTINGS_SECTIONS, ...WORKSPACE_SECTIONS, ...WORKSPACE_ADMIN_SECTIONS]
    .find(([id]) => id === section)?.[1];
  return label ? `${label} · Settings` : "Settings";
}
