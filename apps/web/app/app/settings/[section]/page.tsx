import type { Metadata } from "next";
import { SettingsPage } from "../../../../src/features/product/SettingsPage";
import { settingsSectionTitle } from "../../../../src/features/product/pageTitles";
export async function generateMetadata({ params }: { params: Promise<{ section: string }> }): Promise<Metadata> { const { section } = await params; return { title: settingsSectionTitle(section) }; }
export default async function Settings({ params }: { params: Promise<{ section: string }> }) { const { section } = await params; return <SettingsPage section={section} />; }
