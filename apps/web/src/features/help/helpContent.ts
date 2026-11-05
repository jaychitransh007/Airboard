import {
  HELP_ARTICLES,
  type HelpArticle,
  type HelpArticleStatus,
} from "../../generated/helpContent";

export const HELP_CATEGORY_ORDER = [
  "getting-started",
  "using-the-board",
  "integrations",
  "account",
  "reference",
] as const;

export const HELP_CATEGORY_DESCRIPTIONS: Record<string, string> = {
  "getting-started": "Learn the product, check requirements, and make your first diagram.",
  "using-the-board": "Create and present with commands, voice, gestures, pointer, and keyboard.",
  integrations: "Set up preview surfaces and verify what your audience receives.",
  account: "Manage your workspace, trial, administration, privacy, and data.",
  reference: "Troubleshoot symptoms, interpret errors, and check current limits.",
};

export const HELP_STATUS_LABELS: Record<HelpArticleStatus, string> = {
  shipped: "Available now",
  "private-preview": "Private preview",
  "development-preview": "Development preview",
  gated: "Availability gated",
  reference: "Reference",
};

export function getHelpArticle(slug: string): HelpArticle | undefined {
  return HELP_ARTICLES.find((article) => article.slug === slug);
}

export function getHelpCategories(): Array<{
  id: string;
  label: string;
  description: string;
  articles: HelpArticle[];
}> {
  return HELP_CATEGORY_ORDER.flatMap((id) => {
    const articles = HELP_ARTICLES.filter((article) => article.category === id);
    if (!articles.length) return [];
    return [
      {
        id,
        label: articles[0]?.categoryLabel ?? id,
        description: HELP_CATEGORY_DESCRIPTIONS[id] ?? "",
        articles: [...articles].sort((left, right) => left.order - right.order),
      },
    ];
  });
}

export function getHelpNeighbors(article: HelpArticle): {
  previous?: HelpArticle;
  next?: HelpArticle;
} {
  const ordered = getHelpCategories().flatMap((category) => category.articles);
  const index = ordered.findIndex((candidate) => candidate.slug === article.slug);
  return {
    ...(index > 0 && ordered[index - 1] ? { previous: ordered[index - 1] } : {}),
    ...(index >= 0 && ordered[index + 1] ? { next: ordered[index + 1] } : {}),
  };
}

export function helpHref(articleOrSlug: HelpArticle | string): string {
  const slug = typeof articleOrSlug === "string" ? articleOrSlug : articleOrSlug.slug;
  return `/help/${slug}`;
}

export { HELP_ARTICLES };
export type { HelpArticle, HelpArticleStatus };
