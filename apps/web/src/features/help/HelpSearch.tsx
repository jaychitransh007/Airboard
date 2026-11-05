"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { rankHelpArticles, type HelpSearchItem } from "./searchHelpArticles";

export function HelpSearch({ items }: { items: readonly HelpSearchItem[] }) {
  const [query, setQuery] = useState("");
  const results = useMemo(() => rankHelpArticles(items, query), [items, query]);
  const searching = query.trim().length >= 2;

  return (
    <div className="help-search">
      <label htmlFor="help-search-input">Search Airboard help</label>
      <div className="help-search-field">
        <span aria-hidden="true">⌕</span>
        <input
          id="help-search-input"
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Try “Meet overlay”, “undo”, or an error code"
          autoComplete="off"
        />
        {query ? (
          <button type="button" onClick={() => setQuery("")} aria-label="Clear help search">
            ×
          </button>
        ) : null}
      </div>
      {searching ? (
        <div className="help-search-results" aria-live="polite">
          {results.length ? (
            <>
              <p>{results.length} helpful {results.length === 1 ? "article" : "articles"}</p>
              <ul>
                {results.map((result) => (
                  <li key={result.slug}>
                    <Link href={`/help/${result.slug}`}>
                      <span>{result.categoryLabel}</span>
                      <strong>{result.title}</strong>
                      <small>{result.description}</small>
                    </Link>
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <div className="help-search-empty">
              <strong>No matching article</strong>
              <p>Try a shorter product term, or open troubleshooting.</p>
              <Link href="/help/reference/troubleshooting">Browse troubleshooting →</Link>
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}
