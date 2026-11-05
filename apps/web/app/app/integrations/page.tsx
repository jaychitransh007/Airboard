import { Suspense } from "react";
import { IntegrationsPage } from "../../../src/features/product/IntegrationsPage";
export default function Integrations() { return <Suspense fallback={<div className="empty-panel">Loading integrations…</div>}><IntegrationsPage /></Suspense>; }
