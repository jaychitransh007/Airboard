# Security headers (web)

The web app sends browser security headers on every response. They close
threat-model gap W-1 (in the private, untracked Threat Model): the session lives in
browser storage, so an injected script would mean account takeover, and any
site could frame the app.

`apps/web/middleware.ts` sets them, and `apps/web/src/platform/securityHeaders.ts`
builds them. The middleware makes a new script nonce for every request and
passes the policy on as a request header. Next.js reads the nonce from that
header and puts it on its own inline scripts. A prerendered page would carry no
nonce, so `app/layout.tsx` calls `connection()` and every page renders per
request.

## Headers by page type

| Header | Normal pages | Share page `/s/<token>` |
| --- | --- | --- |
| `Content-Security-Policy` | The policy below, `frame-ancestors 'none'` | Same |
| `X-Frame-Options` | `DENY` | `DENY` |
| `X-Content-Type-Options` | `nosniff` | `nosniff` |
| `Referrer-Policy` | `strict-origin-when-cross-origin` | `no-referrer`, so the token never leaves in a Referer |
| `Permissions-Policy` | `camera`, `microphone` and `display-capture` for the app's own origin; other powerful features off | Same |
| `Strict-Transport-Security` | `max-age=63072000; includeSubDomains`, production only | Same |

No page may be framed. The Chrome extension's overlay engine
(`/meet/overlay-engine`), the only page Meet was once allowed to frame, and the
Meet add-on pages (`/meet/side-panel`, `/meet/main-stage`) were removed on
12 November 2026; their old paths now get the same headers as every other page.

The Permissions-Policy leaves `autoplay`, `fullscreen`, `encrypted-media` and
`picture-in-picture` at the browser defaults. If the header listed them as
`(self)`, allowlisted embeds could not use them, even with their iframe's
`allow` attribute.

## Content-Security-Policy sources

| Directive | Sources | Why |
| --- | --- | --- |
| `default-src` | `'self'` | Anything not listed below |
| `script-src` | `'self'` | Next.js chunks, and MediaPipe's loader at `/vendor/mediapipe/wasm/vision_wasm_internal.js` |
| | `'nonce-…'` | Next.js's inline bootstrap and page-data scripts |
| | `'wasm-unsafe-eval'` | MediaPipe hand tracking compiles WebAssembly |
| | `blob:` | Airo's microphone AudioWorklet module is a Blob the page writes (`realtimeSpeech.ts`) |
| | `'unsafe-eval'` | Development only: React refresh and Next's dev tools |
| `style-src` | `'self' 'unsafe-inline'` | React and Next render `style` attributes |
| `img-src` | `'self' data: blob:` | App images; board pictures decoded from blob: URLs |
| | API origin, Supabase origin | The share page loads pictures through the API, which redirects to a signed Storage URL |
| `media-src` | `'self' blob:` | Board videos play from blob: URLs. Camera and screen streams use `srcObject`, which CSP does not cover |
| `font-src` | `'self'` | The app uses system fonts and loads none |
| `connect-src` | `'self'` | Page data, and MediaPipe's `.wasm` and model files |
| | API origin, over `https` and `wss` | REST calls, live-board and voice sockets (`NEXT_PUBLIC_AIRBOARD_API_URL`) |
| | Supabase origin | Sign-in, signed uploads, and redirects to signed downloads (`NEXT_PUBLIC_SUPABASE_URL`) |
| | `https://api.github.com` | Incidents on the status page |
| `frame-src` | `https://<host>` and `https://*.<host>` for each embed host | Only the playable embed hosts in `scenePlaybackOverlayGeometry.ts`, which also feed this list |
| `worker-src` | `'none'` | The app starts no workers |
| `object-src` | `'none'` | No plugins |
| `base-uri` | `'self'` | No injected `<base>` |
| `form-action` | `'self'` | Every form submits with JavaScript |

MediaPipe's tasks library also posts usage logs to
`https://odml.pa.googleapis.com/v1/log`, and it has no option to turn this off.
The policy blocks that request on purpose: hand tracking is meant to stay on the
device. The library's logger stops after the first refused send, and tracking
is unaffected. Each tracker start logs one "Refused to connect" message in the
console.

The browser uses no Supabase Realtime socket; only the API does, so no Supabase
`wss:` source is listed. Link-preview images are stored on the board but never
fetched by the browser: the canvas draws only pictures resolved from board
assets. If either changes, its origin must be added here first.

## Trade-offs

- `style-src` allows `'unsafe-inline'`. A style nonce would void it, and the
  app's `style` attributes would stop working. Injected CSS cannot run script.
- `script-src` allows `blob:` for the AudioWorklet. Only script already running
  on the page can make a blob: URL. Loading the worklet from a static file under
  `public/` would remove the need.
- Every page renders per request, so none is served from the build's static
  cache.

## Changing the policy

Add a new origin to `securityHeaders.ts` with the reason next to it, and update
the table above. `apps/web/test/securityHeaders.test.mjs` pins the policy for
each page type. `apps/web/e2e/securityHeaders.spec.ts` checks the headers that
are sent. It also loads pages, MediaPipe and the microphone worklet under the
policy with no violations, and confirms an injected inline script is refused.
It checks framing too: nothing may frame any page.
