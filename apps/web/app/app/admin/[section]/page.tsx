import { AdminPage } from "../../../../src/features/product/AdminPage";
export default async function Admin({ params }: { params: Promise<{ section: string }> }) { const { section } = await params; return <AdminPage section={section} />; }
