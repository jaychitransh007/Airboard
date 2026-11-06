import type { Metadata } from "next";
import { AdminPage } from "../../../../src/features/product/AdminPage";
import { adminSectionTitle } from "../../../../src/features/product/pageTitles";
export async function generateMetadata({ params }: { params: Promise<{ section: string }> }): Promise<Metadata> { const { section } = await params; return { title: adminSectionTitle(section) }; }
export default async function Admin({ params }: { params: Promise<{ section: string }> }) { const { section } = await params; return <AdminPage section={section} />; }
