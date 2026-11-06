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
      <span id="help-search-hint" hidden>Results appear below as you type.</span>
      <div className="help-search-field">
        <span aria-hidden="true">⌕</span>
        <input
          id="help-search-input"
          type="search"
          aria-describedby="help-search-hint"
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
      {/* Mounted before the first keystroke: a live region added together with
          its text is often not announced. */}
      <p className="sr-only" role="status">
        {searching ? (results.length ? `${results.length} helpful ${results.length === 1 ? "article" : "articles"}` : "No matching article") : ""}
      </p>
      {searching ? (
        <div className="help-search-results">
          {results.length ? (
            <>
              <p aria-hidden="true">{results.length} helpful {results.length === 1 ? "article" : "articles"}</p>
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
