export type HelpSearchItem = {
  slug: string;
  title: string;
  description: string;
  categoryLabel: string;
  searchText: string;
};

export function rankHelpArticles(
  items: readonly HelpSearchItem[],
  query: string,
  limit = 8,
): HelpSearchItem[] {
  const terms = normalizedTerms(query);
  if (!terms.length) return [];

  return items
    .flatMap((item) => {
      const title = normalize(item.title);
      const description = normalize(item.description);
      const corpus = normalize(item.searchText);
      if (!terms.every((term) => corpus.includes(term))) return [];
      const score = terms.reduce(
        (total, term) =>
          total +
          (title === term ? 12 : 0) +
          (title.startsWith(term) ? 8 : 0) +
          (title.includes(term) ? 5 : 0) +
          (description.includes(term) ? 2 : 0),
        0,
      );
      return [{ item, score }];
    })
    .sort(
      (left, right) =>
        right.score - left.score || left.item.title.localeCompare(right.item.title),
    )
    .slice(0, Math.max(0, limit))
    .map(({ item }) => item);
}

function normalizedTerms(value: string): string[] {
  return [...new Set(normalize(value).split(" ").filter((term) => term.length >= 2))];
}

function normalize(value: string): string {
  return value
    .toLocaleLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}
