import { INTERACTIVE_EMBED_HOSTS } from "../features/board/scenePlaybackOverlayGeometry.ts";

/**
 * Browser security headers for every web response (threat model W-1).
 *
 * middleware.ts sets them with a fresh script nonce per request. Next.js reads
 * that nonce back from the Content-Security-Policy request header and puts it
 * on its own inline scripts, so only scripts the app rendered can run. Pages
 * are therefore rendered per request (app/layout.tsx).
 *
 * Docs/Security Headers.md explains each source.
 */

const GITHUB_API_ORIGIN = "https://api.github.com";

export type SecurityHeaderOptions = {
  pathname: string;
  /** Base64 nonce, new for every request. */
  nonce: string;
  /** `next dev`: React refresh and Next's dev tools need eval. */
  development: boolean;
  /** NEXT_PUBLIC_AIRBOARD_API_URL. */
  apiUrl: string;
  /** NEXT_PUBLIC_SUPABASE_URL, when sign-in is configured. */
  supabaseUrl?: string | undefined;
};

export function createCspNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes));
}

/** The headers for one response, by page type. */
export function securityHeaders(options: SecurityHeaderOptions): Record<string, string> {
  const headers: Record<string, string> = {
    "Content-Security-Policy": contentSecurityPolicy(options),
    "X-Content-Type-Options": "nosniff",
    // The share page keeps its token out of every Referer header.
    "Referrer-Policy": isSharePath(options.pathname) ? "no-referrer" : "strict-origin-when-cross-origin",
    "Permissions-Policy": permissionsPolicy(),
    // No page may be framed (frame-ancestors 'none' says the same to newer browsers).
    "X-Frame-Options": "DENY",
  };
  // Browsers ignore HSTS over plain HTTP, but a dev server on https://localhost
  // would pin localhost for every other project, so send it only in production.
  if (!options.development) headers["Strict-Transport-Security"] = "max-age=63072000; includeSubDomains";
  return headers;
}

export function contentSecurityPolicy(options: SecurityHeaderOptions): string {
  const api = httpAndSocketOrigins(options.apiUrl);
  const supabase = httpOrigin(options.supabaseUrl);
  const directives: Array<[string, Array<string | null | undefined>]> = [
    ["default-src", ["'self'"]],
    [
      "script-src",
      [
        "'self'",
        `'nonce-${options.nonce}'`,
        // MediaPipe hand tracking compiles its WebAssembly.
        "'wasm-unsafe-eval'",
        // Airo's microphone AudioWorklet module is a Blob the page writes itself.
        "blob:",
        options.development ? "'unsafe-eval'" : null,
      ],
    ],
    // React and Next render style attributes; a style nonce would void 'unsafe-inline'.
    ["style-src", ["'self'", "'unsafe-inline'"]],
    // Board pictures are decoded from blob: URLs; the share page loads them
    // through the API, which redirects to a signed Supabase Storage URL.
    ["img-src", ["'self'", "data:", "blob:", api.http, supabase]],
    // Board videos play from blob: URLs; camera and screen streams use srcObject.
    ["media-src", ["'self'", "blob:"]],
    ["font-src", ["'self'"]],
    ["connect-src", ["'self'", api.http, api.socket, supabase, GITHUB_API_ORIGIN]],
    ["frame-src", embedFrameSources()],
    ["worker-src", ["'none'"]],
    ["object-src", ["'none'"]],
    ["base-uri", ["'self'"]],
    ["form-action", ["'self'"]],
    ["frame-ancestors", ["'none'"]],
  ];
  return directives
    .map(([name, sources]) => {
      const values = [...new Set(sources.filter((source): source is string => Boolean(source)))];
      return `${name} ${values.length ? values.join(" ") : "'none'"}`;
    })
    .join("; ");
}

/**
 * Camera, microphone and screen capture for the app's own pages only.
 * autoplay, fullscreen, encrypted-media and picture-in-picture keep their
 * defaults so allowlisted embeds can still use what their iframe allows.
 */
function permissionsPolicy(): string {
  const capture = "(self)";
  return [
    `camera=${capture}`,
    `microphone=${capture}`,
    `display-capture=${capture}`,
    "accelerometer=()",
    "bluetooth=()",
    "browsing-topics=()",
    "geolocation=()",
    "gyroscope=()",
    "hid=()",
    "idle-detection=()",
    "magnetometer=()",
    "midi=()",
    "payment=()",
    "publickey-credentials-get=()",
    "screen-wake-lock=()",
    "serial=()",
    "usb=()",
    "xr-spatial-tracking=()",
  ].join(", ");
}

function embedFrameSources(): string[] {
  return [...INTERACTIVE_EMBED_HOSTS].flatMap((host) => [`https://${host}`, `https://*.${host}`]);
}

function isSharePath(pathname: string): boolean {
  return pathname === "/s" || pathname.startsWith("/s/");
}

function httpOrigin(value: string | undefined): string | null {
  if (!value?.trim()) return null;
  try {
    const url = new URL(value.trim());
    return url.protocol === "https:" || url.protocol === "http:" ? url.origin : null;
  } catch {
    return null;
  }
}

function httpAndSocketOrigins(value: string): { http: string | null; socket: string | null } {
  const http = httpOrigin(value);
  if (!http) return { http: null, socket: null };
  const { protocol, host } = new URL(http);
  return { http, socket: `${protocol === "https:" ? "wss:" : "ws:"}//${host}` };
}
