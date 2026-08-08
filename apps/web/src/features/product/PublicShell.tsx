import Link from "next/link";
import type { ReactNode } from "react";

export function PublicShell({ children }: { children: ReactNode }) {
  return (
    <div className="marketing-shell">
      <header className="marketing-header">
        <Link className="marketing-brand" href="/" aria-label="Airboard home">
          <span className="brand-orbit" aria-hidden="true" />
          Airboard
          <small className="release-stage">Controlled pilot</small>
        </Link>
        <nav aria-label="Main navigation">
          <Link href="/product">Product</Link>
          <Link href="/integrations">Integrations</Link>
          <Link href="/pricing">Pricing</Link>
          <Link href="/enterprise">Enterprise</Link>
        </nav>
        <div className="marketing-actions">
          <Link className="button button-quiet" href="/login">Sign in</Link>
          <Link className="button button-primary" href="/signup">Join pilot</Link>
        </div>
      </header>
      <main>{children}</main>
      <footer className="marketing-footer">
        <div>
          <strong>Airboard</strong>
          <p>Diagrams that stay in the conversation.</p>
        </div>
        <div className="footer-links">
          <Link href="/security">Security</Link>
          <Link href="/help">Help center</Link>
          <Link href="/support">Support</Link>
          <Link href="/status">Status</Link>
          <Link href="/changelog">Changelog</Link>
          <Link href="/privacy">Privacy</Link>
          <Link href="/terms">Terms</Link>
          <Link href="/subprocessors">Subprocessors</Link>
          <Link href="/accessibility">Accessibility</Link>
        </div>
        <small>© {new Date().getFullYear()} Airboard. Controlled pilot: standalone web is available; meeting and desktop integrations are previews. Raw media is processed live and is not stored by Airboard.</small>
      </footer>
    </div>
  );
}
export function MarketingPage({
  eyebrow,
  title,
  summary,
  children,
}: {
  eyebrow: string;
  title: string;
  summary: string;
  children: ReactNode;
}) {
  return (
    <PublicShell>
      <section className="content-hero">
        <p className="eyebrow">{eyebrow}</p>
        <h1>{title}</h1>
        <p className="hero-summary">{summary}</p>
      </section>
      <div className="content-body">{children}</div>
    </PublicShell>
  );
}

export function FeatureGrid({
  items,
}: {
  items: { title: string; description: string; badge?: string }[];
}) {
  return (
    <div className="feature-grid">
      {items.map((item) => (
        <article className="feature-card" key={item.title}>
          {item.badge ? <span className="feature-badge">{item.badge}</span> : null}
          <h2>{item.title}</h2>
          <p>{item.description}</p>
        </article>
      ))}
    </div>
  );
}
