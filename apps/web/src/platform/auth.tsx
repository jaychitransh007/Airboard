"use client";

import { createClient, type Session, type SupabaseClient } from "@supabase/supabase-js";
import { usePathname, useRouter } from "next/navigation";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { airboardApi } from "./api";
import { AUTH_CONFIGURED, safeAppPath, SUPABASE_ANON_KEY, SUPABASE_URL } from "./config";

export type AirboardAccount = {
  profile: {
    id: string;
    email: string | null;
    displayName: string;
    avatarUrl?: string | null;
    locale: string;
    timezone: string;
    onboardingCompletedAt: string | null;
    preferences?: {
      overlayEnabled?: boolean;
      neonTheme?: boolean;
      videoEnabled?: boolean;
      audioEnabled?: boolean;
    };
    notificationPreferences?: {
      product?: boolean;
      trial?: boolean;
      security?: boolean;
      billing?: boolean;
    };
  };
  organization: {
    id: string;
    name: string;
    slug: string;
    kind: "personal" | "team" | "enterprise";
    role: "owner" | "admin" | "billing" | "member" | "viewer";
  };
  workspace: { id: string; name: string; isDefault?: boolean } | null;
  trial: { status: string; activatedAt: string | null; expiresAt: string | null } | null;
  entitlement: { plan: string; status: string; validUntil: string | null } | null;
};

type AuthValue = {
  loading: boolean;
  session: Session | null;
  accessToken: string | null;
  account: AirboardAccount | null;
  error: string | null;
  refreshAccount: () => Promise<void>;
  signInWithOAuth: (provider: "google" | "azure", next?: string) => Promise<void>;
  signInWithMagicLink: (email: string, next?: string) => Promise<void>;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthValue | null>(null);

let browserClient: SupabaseClient | null = null;
function supabaseBrowserClient(): SupabaseClient | null {
  if (!AUTH_CONFIGURED) return null;
  browserClient ??= createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: {
      flowType: "pkce",
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
    },
  });
  return browserClient;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [loading, setLoading] = useState(true);
  const [session, setSession] = useState<Session | null>(null);
  const [developmentToken, setDevelopmentToken] = useState<string | null>(null);
  const [account, setAccount] = useState<AirboardAccount | null>(null);
  const [error, setError] = useState<string | null>(null);
  const accessToken = session?.access_token ?? developmentToken;

  const loadAccount = useCallback(async (token: string | null) => {
    if (!token) {
      setAccount(null);
      return;
    }
    try {
      const next = await airboardApi<AirboardAccount>("/me", { accessToken: token });
      setAccount(next);
      setError(null);
    } catch (caught) {
      setAccount(null);
      setError(caught instanceof Error ? caught.message : "ACCOUNT_UNAVAILABLE");
    }
  }, []);

  useEffect(() => {
    const client = supabaseBrowserClient();
    if (client) {
      void client.auth.getSession().then(({ data }) => {
        setSession(data.session);
        void loadAccount(data.session?.access_token ?? null).finally(() => setLoading(false));
      });
      const { data } = client.auth.onAuthStateChange((_event, nextSession) => {
        setSession(nextSession);
        void loadAccount(nextSession?.access_token ?? null);
      });
      return () => data.subscription.unsubscribe();
    }

    // Local development has an explicit server-signed identity. It is issued
    // only on loopback and is never enabled by the production API config.
    void airboardApi<{ accessToken: string }>("/auth/development", { method: "POST" })
      .then((result) => {
        setDevelopmentToken(result.accessToken);
        return loadAccount(result.accessToken);
      })
      .catch(() => setError("AUTH_NOT_CONFIGURED"))
      .finally(() => setLoading(false));
  }, [loadAccount]);

  const value = useMemo<AuthValue>(
    () => ({
      loading,
      session,
      accessToken,
      account,
      error,
      refreshAccount: () => loadAccount(accessToken),
      signInWithOAuth: async (provider, next) => {
        const client = supabaseBrowserClient();
        if (!client) throw new Error("AUTH_NOT_CONFIGURED");
        const callback = new URL("/auth/callback", window.location.origin);
        callback.searchParams.set("next", safeAppPath(next));
        const { error: authError } = await client.auth.signInWithOAuth({
          provider,
          options: { redirectTo: callback.toString() },
        });
        if (authError) throw authError;
      },
      signInWithMagicLink: async (email, next) => {
        const client = supabaseBrowserClient();
        if (!client) throw new Error("AUTH_NOT_CONFIGURED");
        const callback = new URL("/auth/callback", window.location.origin);
        callback.searchParams.set("next", safeAppPath(next));
        const { error: authError } = await client.auth.signInWithOtp({
          email,
          options: { emailRedirectTo: callback.toString() },
        });
        if (authError) throw authError;
      },
      signOut: async () => {
        await supabaseBrowserClient()?.auth.signOut();
        setDevelopmentToken(null);
        setSession(null);
        setAccount(null);
      },
    }),
    [accessToken, account, error, loadAccount, loading, session],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAirboardAuth(): AuthValue {
  const value = useContext(AuthContext);
  if (!value) throw new Error("useAirboardAuth must be used inside AuthProvider");
  return value;
}

export function AuthGate({ children }: { children: ReactNode }) {
  const auth = useAirboardAuth();
  const pathname = usePathname();
  const router = useRouter();
  useEffect(() => {
    if (!auth.loading && !auth.accessToken) {
      const returnPath = safeAppPath(
        `${pathname}${typeof window !== "undefined" ? window.location.search : ""}`,
        pathname,
      );
      router.replace(`/login?next=${encodeURIComponent(returnPath)}`);
    }
  }, [auth.accessToken, auth.loading, pathname, router]);
  if (auth.loading) return <div className="product-loading">Preparing your Airboard…</div>;
  if (!auth.accessToken) return <div className="product-loading">Taking you to sign in…</div>;
  if (auth.error && !auth.account) {
    return (
      <div className="product-loading">
        <strong>Airboard could not load your account.</strong>
        <span>{auth.error}</span>
        <button onClick={() => void auth.refreshAccount()}>Try again</button>
      </div>
    );
  }
  return children;
}
