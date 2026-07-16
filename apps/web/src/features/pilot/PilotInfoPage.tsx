import type { ReactNode } from "react";

const PILOT_CONTACT = "hellosigmascience@gmail.com";

export function PilotInfoPage({
  title,
  summary,
  children,
}: {
  title: string;
  summary: string;
  children: ReactNode;
}) {
  return (
    <main className="pilot-info-shell">
      <article className="pilot-info-card">
        <header className="pilot-info-header">
          <a className="pilot-info-brand" href="/">
            Airboard Pilot
          </a>
          <nav aria-label="Pilot information">
            <a href="/pilot/setup">Setup</a>
            <a href="/pilot/support">Support</a>
            <a href="/pilot/privacy">Privacy</a>
            <a href="/pilot/terms">Terms</a>
          </nav>
        </header>
        <div className="pilot-info-content">
          <p className="pilot-info-kicker">Google Meet public-draft evaluation</p>
          <h1>{title}</h1>
          <p className="pilot-info-summary">{summary}</p>
          <div className="pilot-info-notice">
            This page applies to the non-production Airboard Pilot and designated draft testers. It
            is not a production service commitment.
          </div>
          {children}
          <footer>
            <span>Last updated: July 16, 2026</span>
            <a href={`mailto:${PILOT_CONTACT}`}>{PILOT_CONTACT}</a>
          </footer>
        </div>
      </article>
    </main>
  );
}

export { PILOT_CONTACT };

