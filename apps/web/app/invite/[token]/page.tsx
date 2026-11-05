import { InvitePage } from "../../../src/features/product/InvitePage";

export default async function InvitationRoute({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return <InvitePage token={token} />;
}
