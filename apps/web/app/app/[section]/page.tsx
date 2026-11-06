import type { Metadata } from "next";
import { ProductSection } from "../../../src/features/product/ProductSection";
import { appSectionTitle } from "../../../src/features/product/pageTitles";
export async function generateMetadata({ params }: { params: Promise<{ section: string }> }): Promise<Metadata> { const { section } = await params; return { title: appSectionTitle(section) }; }
export default async function AppSection({ params }: { params: Promise<{ section: string }> }) { const { section } = await params; return <ProductSection section={section} />; }
