import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";

// Pages folded into the home page; old links and bookmarks land there.
const MOVED_TO_HOME = new Set(["activity", "shared", "trash"]);

export const metadata: Metadata = { title: "Page not found" };

export default async function AppSection({ params }: { params: Promise<{ section: string }> }) {
  const { section } = await params;
  if (MOVED_TO_HOME.has(section)) redirect("/app");
  notFound();
}
