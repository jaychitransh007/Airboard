import { NextResponse, type NextRequest } from "next/server";
import { canonicalHostRedirect } from "./src/platform/canonicalHost";
import { createCspNonce, securityHeaders } from "./src/platform/securityHeaders";

export function middleware(request: NextRequest) {
  const target = canonicalHostRedirect(
    request.headers.get("host"),
    `${request.nextUrl.pathname}${request.nextUrl.search}`,
    process.env.AIRBOARD_CANONICAL_WEB_ORIGIN,
    process.env.AIRBOARD_WEB_ALIAS_HOSTS,
  );
  const headers = securityHeaders({
    pathname: request.nextUrl.pathname,
    nonce: createCspNonce(),
    development: process.env.NODE_ENV === "development",
    apiUrl: process.env.NEXT_PUBLIC_AIRBOARD_API_URL?.trim() || "http://127.0.0.1:4000",
    supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL,
    chromeExtensionId: process.env.NEXT_PUBLIC_AIRBOARD_CHROME_EXTENSION_ID,
  });

  // Temporary (307) so an alias can be re-enabled without browsers holding a
  // cached permanent redirect.
  let response: NextResponse;
  if (target) {
    response = NextResponse.redirect(target, 307);
  } else {
    // Next.js takes the script nonce from the CSP request header and adds it
    // to the scripts it renders.
    const requestHeaders = new Headers(request.headers);
    requestHeaders.set("Content-Security-Policy", headers["Content-Security-Policy"]!);
    response = NextResponse.next({ request: { headers: requestHeaders } });
  }
  for (const [name, value] of Object.entries(headers)) response.headers.set(name, value);
  return response;
}
