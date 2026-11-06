import type { Metadata } from "next";
import { Suspense } from "react";
import { IntegrationsPage } from "../../../src/features/product/IntegrationsPage";

export const metadata: Metadata = { title: "Integrations" };
export default function Integrations() { return <Suspense fallback={<div className="empty-panel">Loading integrations…</div>}><IntegrationsPage /></Suspense>; }
