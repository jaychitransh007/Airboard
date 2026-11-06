import type { Metadata } from "next";
import { Suspense } from "react";
import { AuthPage } from "../../src/features/product/AuthPage";

export const metadata: Metadata = { title: "Sign in" };
export default function LoginPage() { return <Suspense fallback={<div className="product-loading">Loading sign in…</div>}><AuthPage mode="login" /></Suspense>; }
