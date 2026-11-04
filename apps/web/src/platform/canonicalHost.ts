// Cloud Run serves every service on two run.app hostnames, but Supabase only
// redirects sign-in links back to the canonical one. A PKCE verifier stored on
// the alias host therefore never meets its code, so alias hosts are sent to
// the canonical origin before any page (and any sign-in) can start there.
export function canonicalHostRedirect(
  host: string | null,
  pathAndQuery: string,
  canonicalOrigin: string | undefined,
  aliasHosts: string | undefined,
): string | null {
  const requestHost = host?.trim().toLowerCase();
  if (!requestHost || !canonicalOrigin?.trim() || !aliasHosts?.trim()) return null;
  let canonical: URL;
  try {
    canonical = new URL(canonicalOrigin.trim());
  } catch {
    return null;
  }
  if (canonical.protocol !== "https:" && canonical.protocol !== "http:") return null;
  const aliases = aliasHosts.split(",").map((alias) => alias.trim().toLowerCase()).filter(Boolean);
  if (!aliases.includes(requestHost) || requestHost === canonical.host) return null;
  return new URL(pathAndQuery.startsWith("/") ? pathAndQuery : `/${pathAndQuery}`, canonical.origin).toString();
}
