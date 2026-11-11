import { redirect } from "next/navigation";
import { movedAdminSection } from "../../../../src/features/product/pageTitles";

// Administration moved into Settings; old links land on the same page there.
export default async function Admin({ params }: { params: Promise<{ section: string }> }) {
  const { section } = await params;
  redirect(`/app/settings/${movedAdminSection(section)}`);
}
