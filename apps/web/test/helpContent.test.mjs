import assert from "node:assert/strict";
import test from "node:test";

import { HELP_ARTICLES } from "../src/generated/helpContent.ts";
import {
  rankHelpArticles,
} from "../src/features/help/searchHelpArticles.ts";

const searchItems = HELP_ARTICLES.map((article) => ({
  slug: article.slug,
  title: article.title,
  description: article.description,
  categoryLabel: article.categoryLabel,
  searchText: article.searchText,
}));

test("help manifest contains the complete ordered information architecture", () => {
  assert.equal(HELP_ARTICLES.length, 17);
  assert.equal(new Set(HELP_ARTICLES.map((article) => article.slug)).size, 17);
  assert.deepEqual(
    [...new Set(HELP_ARTICLES.map((article) => article.category))],
    ["account", "getting-started", "integrations", "reference", "using-the-board"],
  );
  for (const article of HELP_ARTICLES) {
    assert.match(article.slug, /^[a-z0-9-]+\/[a-z0-9-]+$/);
    assert.doesNotMatch(article.slug, /\/\d+-/);
    assert.ok(article.body.length > 300, `${article.slug} should contain useful guidance`);
    assert.ok(article.headings.length > 0, `${article.slug} should expose article navigation`);
  }
});

test("help search prioritizes title matches and requires every query term", () => {
  const voice = rankHelpArticles(searchItems, "Airo voice");
  assert.equal(voice[0]?.slug, "using-the-board/airo-voice");

  const meet = rankHelpArticles(searchItems, "Meet receiver verification");
  assert.equal(meet[0]?.slug, "integrations/google-meet");

  assert.deepEqual(rankHelpArticles(searchItems, "Meet nonexistent-term"), []);
  assert.deepEqual(rankHelpArticles(searchItems, "a"), []);
});

test("help search finds exact customer-visible error codes", () => {
  const results = rankHelpArticles(searchItems, "CHROME_EXTENSION_NOT_REACHABLE");
  assert.equal(results[0]?.slug, "reference/error-codes");
});
