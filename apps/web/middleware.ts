import { NextResponse, type NextRequest } from "next/server";
import { canonicalHostRedirect } from "./src/platform/canonicalHost";

export function middleware(request: NextRequest) {
  const target = canonicalHostRedirect(
    request.headers.get("host"),
    `${request.nextUrl.pathname}${request.nextUrl.search}`,
    process.env.AIRBOARD_CANONICAL_WEB_ORIGIN,
    process.env.AIRBOARD_WEB_ALIAS_HOSTS,
  );
  // Temporary (307) so an alias can be re-enabled without browsers holding a
  // cached permanent redirect.
  return target ? NextResponse.redirect(target, 307) : NextResponse.next();
}
