import { AuthenticatedAirboard } from "../../../../src/features/product/AuthenticatedAirboard";
export default async function BoardPage({ params }: { params: Promise<{ boardId: string }> }) { const { boardId } = await params; return <div className="canvas-route"><AuthenticatedAirboard boardId={boardId} /></div>; }
