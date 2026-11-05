"use client";

import { createClient, type Session, type SupabaseClient } from "@supabase/supabase-js";
import { usePathname, useRouter } from "next/navigation";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { airboardApi } from "./api";
import { AUTH_CONFIGURED, safeAppPath, SUPABASE_ANON_KEY, SUPABASE_URL } from "./config";
import { liveLinkFromBoardAddress } from "../features/board/shareLinks";
import { isImmersiveBoardPath } from "../features/product/productRouting";

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
  /** The signed-in person's account once its first load settles (null if it failed). */
  accountReady: () => Promise<AirboardAccount | null>;
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

  const loadAccount = useCallback(async (token: string | null): Promise<AirboardAccount | null> => {
    if (!token) {
      setAccount(null);
      return null;
    }
    try {
      const next = await airboardApi<AirboardAccount>("/me", { accessToken: token });
      setAccount(next);
      setError(null);
      return next;
    } catch (caught) {
      setAccount(null);
      setError(caught instanceof Error ? caught.message : "ACCOUNT_UNAVAILABLE");
      return null;
    }
  }, []);

  // The account belongs to the signed-in person, not to a token. Supabase
  // reports hourly token refreshes and tab-focus re-checks as auth events too;
  // reloading /me on each one doubled start-up requests and let one transient
  // failure blank the account (and the board) mid-session.
  const sessionUserRef = useRef<string | null | undefined>(undefined);
  const accountLoadRef = useRef<Promise<AirboardAccount | null>>(Promise.resolve(null));
  const syncSession = useCallback((nextSession: Session | null) => {
    setSession(nextSession);
    const nextUser = nextSession?.user.id ?? null;
    if (sessionUserRef.current !== nextUser) {
      sessionUserRef.current = nextUser;
      accountLoadRef.current = loadAccount(nextSession?.access_token ?? null);
    }
    return accountLoadRef.current;
  }, [loadAccount]);

  useEffect(() => {
    const client = supabaseBrowserClient();
    if (client) {
      void client.auth.getSession().then(({ data }) => {
        void syncSession(data.session).finally(() => setLoading(false));
      });
      const { data } = client.auth.onAuthStateChange((_event, nextSession) => {
        void syncSession(nextSession);
      });
      return () => data.subscription.unsubscribe();
    }

    // Local development has an explicit server-signed identity. It is issued
    // only on loopback and is never enabled by the production API config.
    void airboardApi<{ accessToken: string }>("/auth/development", { method: "POST" })
      .then((result) => {
        accountLoadRef.current = loadAccount(result.accessToken);
        setDevelopmentToken(result.accessToken);
        return accountLoadRef.current;
      })
      .catch(() => setError("AUTH_NOT_CONFIGURED"))
      .finally(() => setLoading(false));
  }, [loadAccount, syncSession]);

  const value = useMemo<AuthValue>(
    () => ({
      loading,
      session,
      accessToken,
      account,
      error,
      accountReady: () => accountLoadRef.current,
      refreshAccount: async () => {
        accountLoadRef.current = loadAccount(accessToken);
        await accountLoadRef.current;
      },
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
        sessionUserRef.current = null;
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
      // A board address carrying a live session admits guests without an account.
      const live = pathname.startsWith("/app/boards/")
        ? liveLinkFromBoardAddress(window.location.origin, window.location.search)
        : null;
      if (live) {
        window.location.replace(live);
        return;
      }
      const returnPath = safeAppPath(
        `${pathname}${typeof window !== "undefined" ? window.location.search : ""}`,
        pathname,
      );
      router.replace(`/login?next=${encodeURIComponent(returnPath)}`);
    }
  }, [auth.accessToken, auth.loading, pathname, router]);
  // A board starts loading alongside the account rather than after it; board
  // pages wait for the account themselves.
  const opensBeforeAccount = Boolean(auth.accessToken) && isImmersiveBoardPath(pathname);
  if (auth.loading && !opensBeforeAccount) return <div className="product-loading">Preparing your Airboard…</div>;
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
