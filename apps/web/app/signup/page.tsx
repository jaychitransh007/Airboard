import { Suspense } from "react";
import { AuthPage } from "../../src/features/product/AuthPage";
export default function SignupPage() { return <Suspense fallback={<div className="product-loading">Loading signup…</div>}><AuthPage mode="signup" /></Suspense>; }
