import { SettingsPage } from "../../../../src/features/product/SettingsPage";
export default async function Settings({ params }: { params: Promise<{ section: string }> }) { const { section } = await params; return <SettingsPage section={section} />; }
