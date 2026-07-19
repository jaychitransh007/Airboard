"use client";

import { AuthProvider } from "../src/platform/auth";
import { CookieConsent } from "../src/features/product/CookieConsent";

export function Providers({ children }: { children: React.ReactNode }) {
  return <AuthProvider>{children}<CookieConsent /></AuthProvider>;
}
