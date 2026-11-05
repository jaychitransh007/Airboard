import { Suspense } from "react";
import { AuthPage } from "../../src/features/product/AuthPage";
export default function LoginPage() { return <Suspense fallback={<div className="product-loading">Loading sign in…</div>}><AuthPage mode="login" /></Suspense>; }
