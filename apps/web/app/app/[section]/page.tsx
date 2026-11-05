import { ProductSection } from "../../../src/features/product/ProductSection";
export default async function AppSection({ params }: { params: Promise<{ section: string }> }) { const { section } = await params; return <ProductSection section={section} />; }
