import Link from "next/link";
import { HelpSearch } from "./HelpSearch";
import {
  getHelpCategories,
  getHelpArticle,
  helpHref,
  HELP_ARTICLES,
  HELP_STATUS_LABELS,
} from "./helpContent";
import { HelpShell } from "./HelpShell";

const popularSlugs = [
  "getting-started/your-first-board",
  "using-the-board/commands",
  "using-the-board/gestures",
  "integrations/google-meet",
  "reference/troubleshooting",
];

export function HelpCenterPage() {
  const categories = getHelpCategories();
  const popular = popularSlugs.flatMap((slug) => {
    const article = getHelpArticle(slug);
    return article ? [article] : [];
  });

  return (
    <HelpShell>
      <section className="help-hero">
        <p className="eyebrow">Airboard Help Center</p>
        <h1>Find the answer before the meeting starts.</h1>
        <p>
          Learn the board, choose an input method, verify preview integrations, and
          recover from visible errors without sharing conversation content.
        </p>
        <HelpSearch
          items={HELP_ARTICLES.map((article) => ({
            slug: article.slug,
            title: article.title,
            description: article.description,
            categoryLabel: article.categoryLabel,
            searchText: article.searchText,
          }))}
        />
      </section>

      <div className="help-home-body">
        <section className="help-popular" aria-labelledby="popular-help-heading">
          <div className="help-section-heading">
            <p className="eyebrow">Start here</p>
            <h2 id="popular-help-heading">Popular help</h2>
          </div>
          <div className="help-popular-grid">
            {popular.map((article, index) => (
              <Link href={helpHref(article)} key={article.slug}>
                <span aria-hidden="true">{String(index + 1).padStart(2, "0")}</span>
                <div>
                  <small>{article.categoryLabel}</small>
                  <strong>{article.title}</strong>
                  <p>{article.description}</p>
                </div>
                <em>→</em>
              </Link>
            ))}
          </div>
        </section>

        <section className="help-categories" aria-labelledby="help-categories-heading">
          <div className="help-section-heading">
            <p className="eyebrow">Browse by topic</p>
            <h2 id="help-categories-heading">Everything in one place</h2>
          </div>
          <div className="help-category-grid">
            {categories.map((category) => (
              <article id={category.id} key={category.id}>
                <div className="help-category-icon" aria-hidden="true">
                  {categoryIcon(category.id)}
                </div>
                <h3>{category.label}</h3>
                <p>{category.description}</p>
                <ul>
                  {category.articles.map((article) => (
                    <li key={article.slug}>
                      <Link href={helpHref(article)}>
                        <span>{article.title}</span>
                        {article.status !== "shipped" ? (
                          <small>{HELP_STATUS_LABELS[article.status]}</small>
                        ) : null}
                      </Link>
                    </li>
                  ))}
                </ul>
              </article>
            ))}
          </div>
        </section>

        <section className="help-support-cta">
          <div>
            <p className="eyebrow">Still stuck?</p>
            <h2>Send capability details, not conversation content.</h2>
            <p>
              Create a seven-day diagnostic from Privacy &amp; data, then include its
              ID, the visible error code, platform version, and first failed check.
            </p>
          </div>
          <div>
            <Link className="button button-primary" href="/support">
              Contact support
            </Link>
            <Link href="/help/account/privacy-and-your-data">How diagnostics work →</Link>
          </div>
        </section>
      </div>
    </HelpShell>
  );
}

function categoryIcon(category: string): string {
  if (category === "getting-started") return "↗";
  if (category === "using-the-board") return "◇";
  if (category === "integrations") return "∞";
  if (category === "account") return "◎";
  return "?";
}
