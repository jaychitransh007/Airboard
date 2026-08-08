import Link from "next/link";
import { HelpShell } from "../../src/features/help/HelpShell";

export default function HelpNotFound() {
  return (
    <HelpShell>
      <section className="help-not-found">
        <p className="eyebrow">Article not found</p>
        <h1>That help page has moved or does not exist.</h1>
        <p>Search the Help Center or start with troubleshooting.</p>
        <div>
          <Link className="button button-primary" href="/help">
            Open Help Center
          </Link>
          <Link className="button button-quiet" href="/help/reference/troubleshooting">
            Troubleshooting
          </Link>
        </div>
      </section>
    </HelpShell>
  );
}
