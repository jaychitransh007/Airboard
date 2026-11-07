import type { Metadata } from "next";
import { AuthenticatedAirboard } from "../../../../src/features/product/AuthenticatedAirboard";

export const metadata: Metadata = { title: "Board" };
export default async function BoardPage({ params }: { params: Promise<{ boardId: string }> }) { const { boardId } = await params; return <div className="canvas-route"><AuthenticatedAirboard boardId={boardId} /></div>; }
