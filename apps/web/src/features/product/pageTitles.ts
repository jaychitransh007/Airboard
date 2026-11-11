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

const APP_SECTION_TITLES: Record<string, string> = {
  activity: "Activity",
  shared: "Shared boards",
};

const ADMIN_SECTION_TITLES: Record<string, string> = {
  overview: "Admin overview",
  members: "Members",
  policies: "Organization policy",
  "audit-logs": "Audit log",
  installations: "Installation health",
  "identity-directory": "SSO and SCIM",
};

export function appSectionTitle(section: string): string {
  return APP_SECTION_TITLES[section] ?? "Page not found";
}

export function adminSectionTitle(section: string): string {
  return ADMIN_SECTION_TITLES[section] ?? ADMIN_SECTION_TITLES.overview!;
}

export function settingsSectionTitle(section: string): string {
  const label = SETTINGS_SECTIONS.find(([id]) => id === section)?.[1];
  return label ? `${label} · Settings` : "Settings";
}
