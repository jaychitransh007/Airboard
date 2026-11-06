import type { Metadata } from "next";
import { Suspense } from "react";
import { AuthCallback } from "../../../src/features/product/AuthCallback";

export const metadata: Metadata = { title: "Signing in" };
export default function CallbackPage() {
  return <Suspense fallback={<div className="product-loading">Securing your Airboard account…</div>}><AuthCallback /></Suspense>;
}
