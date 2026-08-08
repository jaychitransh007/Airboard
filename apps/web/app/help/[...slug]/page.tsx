import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { HelpArticlePage } from "../../../src/features/help/HelpArticlePage";
import { getHelpArticle, HELP_ARTICLES } from "../../../src/features/help/helpContent";

export const dynamicParams = false;

export function generateStaticParams() {
  return HELP_ARTICLES.map((article) => ({ slug: article.slug.split("/") }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string[] }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const article = getHelpArticle(slug.join("/"));
  if (!article) return {};
  return {
    title: article.title,
    description: article.description,
  };
}

export default async function HelpArticleRoute({
  params,
}: {
  params: Promise<{ slug: string[] }>;
}) {
  const { slug } = await params;
  const article = getHelpArticle(slug.join("/"));
  if (!article) notFound();
  return <HelpArticlePage article={article} />;
}
