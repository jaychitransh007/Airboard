"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { airboardApi } from "../../platform/api";
import { useAirboardAuth } from "../../platform/auth";

export function CookieConsent() {
  const auth = useAirboardAuth(); const [visible, setVisible] = useState(false);
  useEffect(() => { try { setVisible(!localStorage.getItem("airboard.cookie-choice.v1")); } catch { setVisible(false); } }, []);
  const choose = async (analytics: boolean) => { try { localStorage.setItem("airboard.cookie-choice.v1", analytics ? "analytics" : "necessary"); } catch {} setVisible(false); if (auth.accessToken) void airboardApi("/consents", { method: "POST", accessToken: auth.accessToken, body: JSON.stringify({ consentType: "cookies_analytics", granted: analytics, source: "web_banner", documentVersion: "2026-07-18" }) }).catch(() => undefined); };
  if (!visible) return null;
  return <aside className="cookie-banner" aria-label="Cookie choices"><div><strong>Airboard uses necessary browser storage.</strong><p>Optional product analytics remains off unless you accept it. Board content, media, transcripts and meeting URLs are never analytics properties. <Link href="/cookies">Learn more</Link></p></div><button onClick={() => void choose(false)}>Necessary only</button><button className="button button-primary" onClick={() => void choose(true)}>Allow analytics</button></aside>;
}
