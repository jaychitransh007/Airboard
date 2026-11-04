import Link from "next/link";
import { PublicShell } from "../src/features/product/PublicShell";

export default function NotFound() {
  return (
    <PublicShell>
      <section className="help-not-found">
        <p className="eyebrow">Page not found</p>
        <h1>That page has moved or does not exist.</h1>
        <p>Head back to Airboard or open your boards.</p>
        <div>
          <Link className="button button-primary" href="/">
            Go to the home page
          </Link>
          <Link className="button button-quiet" href="/app/boards">
            Open my boards
          </Link>
        </div>
      </section>
    </PublicShell>
  );
}
