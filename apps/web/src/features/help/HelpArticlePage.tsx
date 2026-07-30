import Link from "next/link";
import type { ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  getHelpCategories,
  getHelpNeighbors,
  helpHref,
  HELP_STATUS_LABELS,
  type HelpArticle,
} from "./helpContent";
import { HelpShell } from "./HelpShell";

export function HelpArticlePage({ article }: { article: HelpArticle }) {
  const categories = getHelpCategories();
  const neighbors = getHelpNeighbors(article);
  const related =
    categories
      .find((category) => category.id === article.category)
      ?.articles.filter((candidate) => candidate.slug !== article.slug)
      .slice(0, 3) ?? [];

  return (
    <HelpShell>
      <div className="help-article-shell">
        <aside className="help-article-nav" aria-label="Help topics">
          <Link className="help-nav-home" href="/help">
            ← Help home
          </Link>
          {categories.map((category) => (
            <section key={category.id}>
              <h2>{category.label}</h2>
              <nav>
                {category.articles.map((candidate) => (
                  <Link
                    className={candidate.slug === article.slug ? "active" : ""}
                    aria-current={candidate.slug === article.slug ? "page" : undefined}
                    href={helpHref(candidate)}
                    key={candidate.slug}
                  >
                    {candidate.title}
                  </Link>
                ))}
              </nav>
            </section>
          ))}
        </aside>

        <article className="help-article">
          <nav className="help-breadcrumbs" aria-label="Breadcrumb">
            <Link href="/help">Help center</Link>
            <span aria-hidden="true">/</span>
            <Link href={`/help#${article.category}`}>{article.categoryLabel}</Link>
          </nav>
          <header>
            <span className={`help-status ${article.status}`}>
              {HELP_STATUS_LABELS[article.status]}
            </span>
            <h1>{article.title}</h1>
            <p>{article.description}</p>
            <small>Verified {formatDate(article.lastVerified)}</small>
          </header>

          {article.status !== "shipped" && article.status !== "reference" ? (
            <div className={`help-status-callout ${article.status}`}>
              <strong>{HELP_STATUS_LABELS[article.status]}</strong>
              <span>{statusExplanation(article.status)}</span>
            </div>
          ) : null}

          <div className="help-markdown">
            <MarkdownBody body={article.body} />
          </div>

          {related.length ? (
            <section className="help-related" aria-labelledby="related-help-heading">
              <h2 id="related-help-heading">Related help</h2>
              <div>
                {related.map((candidate) => (
                  <Link href={helpHref(candidate)} key={candidate.slug}>
                    <small>{candidate.categoryLabel}</small>
                    <strong>{candidate.title}</strong>
                    <span>→</span>
                  </Link>
                ))}
              </div>
            </section>
          ) : null}

          <nav className="help-neighbors" aria-label="Previous and next help articles">
            {neighbors.previous ? (
              <Link href={helpHref(neighbors.previous)}>
                <small>Previous</small>
                <strong>← {neighbors.previous.title}</strong>
              </Link>
            ) : (
              <span />
            )}
            {neighbors.next ? (
              <Link href={helpHref(neighbors.next)}>
                <small>Next</small>
                <strong>{neighbors.next.title} →</strong>
              </Link>
            ) : null}
          </nav>
        </article>

        <aside className="help-on-this-page">
          <strong>On this page</strong>
          <nav>
            {article.headings.map((heading) => (
              <a className={heading.depth === 3 ? "nested" : ""} href={`#${heading.id}`} key={heading.id}>
                {heading.label}
              </a>
            ))}
          </nav>
          <div>
            <span>Need more help?</span>
            <Link href="/support">Contact support →</Link>
          </div>
        </aside>
      </div>
    </HelpShell>
  );
}

function MarkdownBody({ body }: { body: string }) {
  const seen = new Map<string, number>();
  const headingId = (children: ReactNode) => {
    const base = slugify(flattenText(children));
    const count = seen.get(base) ?? 0;
    seen.set(base, count + 1);
    return count === 0 ? base : `${base}-${count + 1}`;
  };

  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        h2: ({ children }) => <h2 id={headingId(children)}>{children}</h2>,
        h3: ({ children }) => <h3 id={headingId(children)}>{children}</h3>,
        a: ({ href = "", children }) =>
          href.startsWith("/") ? (
            <Link href={href}>{children}</Link>
          ) : (
            <a href={href} target={href.startsWith("http") ? "_blank" : undefined} rel={href.startsWith("http") ? "noreferrer" : undefined}>
              {children}
            </a>
          ),
      }}
    >
      {body}
    </ReactMarkdown>
  );
}

function flattenText(value: ReactNode): string {
  if (typeof value === "string" || typeof value === "number") return String(value);
  if (Array.isArray(value)) return value.map(flattenText).join("");
  if (value && typeof value === "object" && "props" in value) {
    return flattenText((value as { props?: { children?: ReactNode } }).props?.children);
  }
  return "";
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-");
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat("en", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${value}T00:00:00Z`));
}

function statusExplanation(status: HelpArticle["status"]): string {
  if (status === "private-preview") {
    return "This capability requires approved preview access and can change before public distribution.";
  }
  if (status === "development-preview") {
    return "This capability is intended for controlled development use and is not generally distributed.";
  }
  return "Availability depends on the capability being explicitly enabled in your Airboard environment.";
}
