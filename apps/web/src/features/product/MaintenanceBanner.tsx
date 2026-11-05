"use client";

import { useEffect, useState } from "react";
import { airboardApi } from "../../platform/api";
import { MAINTENANCE_EVENT } from "../../platform/maintenance";

const RECHECK_MS = 30_000;

/**
 * Tells people when Airboard is read-only for a short upgrade: on load if the
 * API says so, or as soon as any change is refused. While it shows, it checks
 * back every 30 seconds and hides once changes are accepted again.
 */
export function MaintenanceBanner() {
  const [active, setActive] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const check = () =>
      airboardApi<{ readOnly?: boolean }>("/auth/config")
        .then((config) => {
          if (!cancelled) setActive(config.readOnly === true);
        })
        .catch(() => undefined);
    void check();
    const show = () => setActive(true);
    window.addEventListener(MAINTENANCE_EVENT, show);
    return () => {
      cancelled = true;
      window.removeEventListener(MAINTENANCE_EVENT, show);
    };
  }, []);

  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => {
      void airboardApi<{ readOnly?: boolean }>("/auth/config")
        .then((config) => setActive(config.readOnly === true))
        .catch(() => undefined);
    }, RECHECK_MS);
    return () => clearInterval(timer);
  }, [active]);

  if (!active) return null;
  return (
    <div className="maintenance-banner" role="status">
      <strong>Airboard is down for a short upgrade.</strong>{" "}
      You can still open your boards, but changes are paused for a few minutes.
    </div>
  );
}
