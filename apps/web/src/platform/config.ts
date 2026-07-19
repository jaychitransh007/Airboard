export const AIRBOARD_API_URL =
  process.env.NEXT_PUBLIC_AIRBOARD_API_URL?.trim() || "http://127.0.0.1:4000";

export const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() || "";
export const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim() || "";

export const AUTH_CONFIGURED = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);

export function safeAppPath(value: string | null | undefined, fallback = "/onboarding"): string {
  const candidate = value?.trim();
  if (!candidate || !candidate.startsWith("/") || candidate.startsWith("//")) return fallback;
  try {
    const parsed = new URL(candidate, "https://airboard.invalid");
    return parsed.origin === "https://airboard.invalid"
      ? `${parsed.pathname}${parsed.search}${parsed.hash}`
      : fallback;
  } catch {
    return fallback;
  }
}

export type AuthProviderAvailability = {
  google: boolean;
  microsoft: boolean;
  emailMagicLink: boolean;
};

export function parseSupabaseAuthSettings(value: unknown): AuthProviderAvailability {
  const settings = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const external = settings.external && typeof settings.external === "object"
    ? settings.external as Record<string, unknown>
    : {};
  return {
    google: external.google === true,
    microsoft: external.azure === true,
    emailMagicLink: settings.disable_signup !== true,
  };
}

export async function fetchAuthProviderAvailability(
  fetcher: typeof fetch = fetch,
): Promise<AuthProviderAvailability> {
  if (!AUTH_CONFIGURED) return { google: false, microsoft: false, emailMagicLink: false };
  try {
    const response = await fetcher(`${SUPABASE_URL}/auth/v1/settings`, {
      headers: { apikey: SUPABASE_ANON_KEY },
    });
    if (!response.ok) throw new Error(`AUTH_SETTINGS_${response.status}`);
    return parseSupabaseAuthSettings(await response.json());
  } catch {
    return { google: false, microsoft: false, emailMagicLink: true };
  }
}
