import Link from "next/link";
import type { ReactNode } from "react";
import { HelpHeaderAction } from "./HelpHeaderAction";

export function HelpShell({ children }: { children: ReactNode }) {
  return (
    <div className="help-shell">
      <header className="help-header">
        <Link className="help-brand" href="/" aria-label="Airboard home">
          <span className="brand-orbit" aria-hidden="true" />
          Airboard
          <small>Help center</small>
        </Link>
        <nav aria-label="Help Center">
          <Link href="/help">Help home</Link>
          <Link href="/help/reference/troubleshooting">Troubleshooting</Link>
          <Link href="/support">Contact support</Link>
        </nav>
        <HelpHeaderAction />
      </header>
      <main>{children}</main>
      <footer className="help-footer">
        <div>
          <strong>Airboard Help Center</strong>
          <p>Product guidance for the controlled pilot and preview surfaces.</p>
        </div>
        <nav aria-label="Help Center footer">
          <Link href="/privacy">Privacy</Link>
          <Link href="/security">Security</Link>
          <Link href="/status">Status</Link>
          <Link href="/support">Support</Link>
        </nav>
        <small>
          Preview and gated capabilities are labelled in their articles. Help content is
          guidance, not an uptime, certification, or contractual claim.
        </small>
      </footer>
    </div>
  );
}
