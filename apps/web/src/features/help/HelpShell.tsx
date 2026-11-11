import Link from "next/link";
import type { ReactNode } from "react";
import { HelpHeaderAction } from "./HelpHeaderAction";

export function HelpShell({ children }: { children: ReactNode }) {
  return (
    <div className="help-shell">
      <a className="skip-link" href="#main-content">Skip to content</a>
      <header className="help-header">
        <Link className="help-brand" href="/">
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
      <main id="main-content" tabIndex={-1}>{children}</main>
      <footer className="help-footer">
        <div>
          <strong>Airboard Help Center</strong>
          <p>Product guidance for the Airboard pilot.</p>
        </div>
        <nav aria-label="Help Center footer">
          <Link href="/privacy">Privacy</Link>
          <Link href="/security">Security</Link>
          <Link href="/status">Status</Link>
          <Link href="/support">Support</Link>
        </nav>
        <small>
          Help content is
          guidance, not an uptime, certification, or contractual claim.
        </small>
      </footer>
    </div>
  );
}
