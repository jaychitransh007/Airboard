import { Suspense } from "react";
import { AuthCallback } from "../../../src/features/product/AuthCallback";
export default function CallbackPage() {
  return <Suspense fallback={<div className="product-loading">Securing your Airboard account…</div>}><AuthCallback /></Suspense>;
}
