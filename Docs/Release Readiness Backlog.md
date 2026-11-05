# Release Readiness Backlog

> **Status:** Backlog — recorded, not scheduled. No implementation committed.
> **Created:** 2026-07-29
> **Source:** 9-dimension code/product audit on branch `codex/production-readiness` (2026-07-28).
> **Relationship to other docs:** This is the engineering gap register that sits *underneath*
> [`Official Launch Readiness.md`](<Official Launch Readiness.md>) (the release ladder + decision gates) and
> [`ops/launch-evidence.json`](../ops/launch-evidence.json) (the fail-closed evidence ledger). Where an item
> is already represented by a launch gate, it is cross-referenced rather than duplicated.

## How to use this file

- Every item has a stable ID (`RGB-NNN`), a tier, an owner, concrete `file:line` evidence, and a status.
- **Status notation:** `Backlog` (recorded, not started) · `Planned` (scheduled) · `In progress` · `Done` (with evidence) · `Won't fix` (with rationale) · `Corrected` (finding overturned on verification).
- **Verification column:** `Verified` = confirmed by reading source during the audit · `Reported` = auditor-reported, not independently re-verified (the audit's automated verify pass was cut short — see [Coverage gaps](#coverage-gaps)).
- Promote an item out of Backlog only when a named owner accepts it. Closing an item requires evidence, same as the launch gates.

## Ground-truth snapshot at time of audit

- `pnpm -r build` ✓ · `pnpm typecheck` ✓ · `pnpm test` = **350/350 unit tests pass** · web build emits 27 static pages.
- `pnpm launch:check` (controlled-pilot) = 4/23; the 19 failures are deploy-time config + external human/legal/ops evidence, **not broken code**.
- The codebase is ready for a **controlled single-instance pilot** (as the docs claim). The items below are what stands between that and an honest **standalone-GA** / **paid-GA**.

---

## Tier 1 — Code/product blockers for an honest standalone-GA

These are fixable in the repo and each would make a public "supported product" claim dishonest or unsafe if left open.

| ID | Title | Owner | Verification | Evidence | Recommendation |
|----|-------|-------|--------------|----------|----------------|
| RGB-001 | **Retention & account/workspace erasure never actually execute** — all lifecycle work rides on `POST /internal/lifecycle/run` but **no scheduler is defined anywhere in the repo** | Engineering | Verified | `apps/api/src/controlPlaneRoutes.ts:1483` runs trial-expiry, `processDataRequests` (deletion execution), `expireDiagnostics`, `expireOperationalData`, `purgeExpiredDeletedBoards`; no cron/Cloud Scheduler config in `infra/`, `.github/`, `ops/` | Wire a Cloud Scheduler (or equivalent) job hitting the endpoint with `AIRBOARD_CRON_SECRET`, with a failed-run alert. Ties to launch gate `lifecycle-schedule`. |
| RGB-002 | **No React error boundaries** — any uncaught render error white-screens the whole workspace | Engineering | Verified | No `error.tsx` / `global-error.tsx` / `ErrorBoundary` / `componentDidCatch` anywhere in `apps/web` | Add Next.js `app/error.tsx` + `app/global-error.tsx` and a board-level boundary with a recovery affordance. |
| RGB-003 | **No graceful shutdown / SIGTERM handling** in the API | Engineering | Verified | No `SIGTERM`/`SIGINT`/`server.close`/drain handler in `apps/api/src` | Handle SIGTERM: stop accepting upgrades, drain WS with a close frame, flush, then exit within the platform grace window. |
| RGB-004 | **No committed deploy / migration-apply / rollback path** | Engineering | Verified | `infra/cloud-run/cloudbuild-api.yaml` & `cloudbuild-web.yaml` only `docker build`+push — no `gcloud run deploy`, no `supabase db push`, no rollback | Add scripted deploy + migration-apply + rollback (or document the exact manual runbook steps as scripts). Ties to `deployment-smoke` / `database-migrations` gates. |
| RGB-005 | **Outbound provider calls have no timeout** — a slow provider hangs a request worker | Engineering | Verified | Bare `fetch` with no `AbortController`: Resend `controlPlaneRoutes.ts:2021`, Stripe `stripeRequest` `:2132`, Supabase settings `auth.ts:63`. (Deepgram/OpenAI paths already have timeouts.) | Wrap each in an `AbortController` timeout consistent with the intent/transcription paths. |
| RGB-006 | **Accessibility gaps in core non-media flows** | Product / Engineering | Verified (spot) / Reported | Modals don't move/trap focus & lack full keyboard dismissal (WCAG 2.4.3/2.1.2); no skip-to-content link (2.4.1); contact-sales status not a live region; dock flyout declares `role=menu`/`menuitem` with no menu keyboard interaction (in the uncommitted dock redesign) | Focus trap + restore on dialogs, skip link on both shells, `aria-live` on form status, implement arrow/Home/End/Esc on the dock menu. Ties to `accessibility-audit` gate. |

---

## Tier 2 — Blocks the scaled thesis & paid-GA

| ID | Title | Owner | Verification | Evidence | Recommendation |
|----|-------|-------|--------------|----------|----------------|
| RGB-007 | **Realtime collaboration broadcast is process-local** — breaks across autoscaled instances | Engineering | Verified | `apps/api/src/server.ts:111` `rooms = new Map<>()`; `broadcast()` `:619` only reaches sockets on the same process | Add cross-instance fan-out (Redis/Postgres pub-sub) **or** pin a single instance and document the concurrency ceiling. Only required once the *collaboration* claim goes beyond single-instance. |
| RGB-008 | **Paid entitlement expiry from deprecated Stripe field + silent 24h fallback** | Engineering | Verified | `controlPlaneRoutes.ts:2208` reads subscription-level `data.current_period_end` (moved to item level in recent Stripe API versions → null) → `:2246` falls back to `now()+24h`, silently revoking paid access after a day | Read `current_period_end` from `items.data[0]`; remove the silent 24h fallback (fail loud / refuse to write a bogus expiry). Paid-GA only. |
| RGB-009 | **Team seats stored but never enforced** | Engineering | Verified (corrected scope) | `seat_quantity` written to `billing_subscriptions` `:2216` but `requireActiveEntitlement` `:1864` is a boolean org-scoped check — seat count is never compared to active members | Decide the seat model; if enforced, count active members against `seat_quantity` at session-start. (NB: an earlier auditor claim that "members get no entitlement" was **false** — see [Corrected findings](#corrected-findings).) Paid-GA only. |
| RGB-010 | **No failed-webhook alerting or Stripe↔Airboard reconciliation** | Engineering | Reported | Failed webhooks only log and return 500; no dead-letter/alert/reconcile path | Add failed-webhook alerting and a periodic reconciliation. Ties to paid-GA evidence. Paid-GA only. |

---

## Tier 3 — Hardening & correctness (should-fix before GA, not hard blockers)

### CI / supply chain
| ID | Title | Owner | Verification | Evidence | Recommendation |
|----|-------|-------|--------------|----------|----------------|
| RGB-011 | No linter anywhere (no ESLint config/script/CI step) | Engineering | Verified | `.github/workflows/ci.yml`; no ESLint in any `package.json` | Add ESLint + a CI lint gate. |
| RGB-012 | No dependency-vulnerability audit, secret scanning, or dependabot/CodeQL in CI | Engineering / Security | Verified | `.github/workflows/ci.yml` | Add `pnpm audit`/OSV, secret scan (e.g. gitleaks), and Dependabot/CodeQL. |
| RGB-013 | Semantic (LLM) voice false-accept path not covered by any CI gate | Engineering | Reported | Only deterministic grammar/false-accept evals gate CI | Add an offline semantic false-accept gate (or document the exclusion). |
| RGB-014 | New `catalogDock` E2E is uncommitted & never run; CI can't show E2E is a required merge check | Engineering | Verified | `apps/web/e2e/catalogDock.spec.ts` (uncommitted, +235 lines); Playwright not in the fast verify path | Run it before committing the dock diff; make the E2E job a required check on the release branch. |

### Security hardening (mediums)
| ID | Title | Owner | Verification | Evidence | Recommendation |
|----|-------|-------|--------------|----------|----------------|
| RGB-015 | Non-constant-time `===` compare on operator secrets (apiToken, cron secret, metrics token) | Engineering | Reported | `apps/api/src/security.ts:71,75`; `server.ts:211`; `controlPlaneRoutes.ts:1484` — the cron secret guards *destructive* deletion | Use `crypto.timingSafeEqual` on length-normalized buffers, matching the signed-token & Stripe paths. |
| RGB-016 | Transcription WS forwards the raw ~1h Supabase JWT in the `access_token` URL query | Engineering | Reported (partly tracked) | `apps/api/src/auth.ts:84`; `apps/web/src/features/board/realtimeSpeech.ts:242` — vs board `/ws` which uses a 30-min purpose-scoped signed ticket | Issue a short-lived `purpose='transcription'` signed ticket; ensure ingress/log-sink redaction covers `access_token`. |
| RGB-017 | Loopback gate uses substring match on attacker-controlled Host header | Engineering | Verified | `controlPlaneRoutes.ts:2407-2410` `.includes(host)`; only reachable when `localEntitlements` (not in prod) — defense-in-depth only | Exact equality/allowlist against `request.ip`. |
| RGB-018 | `'*'` allowed-origin honored by WS/intent/voice helpers but not the REST CORS layer | Engineering | Verified | `transcription/routes.ts:372`, `semanticIntent/routes.ts:191`, `voiceTrace/routes.ts:145` short-circuit `true` on `*`; `server.ts:137` (@fastify/cors) does not | Pick one policy; drop the `*` special-case or document it as unsupported in prod. |

### Backend robustness (mediums/lows)
| ID | Title | Owner | Verification | Evidence | Recommendation |
|----|-------|-------|--------------|----------|----------------|
| RGB-019 | Provider concurrency caps & rate limits are per-process (multiply by instance count) | Engineering | Reported | Per-process maps for rate limiter / concurrency | Move to a shared store if provider spend/quota must be bounded globally. |
| RGB-020 | Boot does not fail-fast on missing Supabase config; `/ready` returns 200 when DB unconfigured | Engineering | Reported | `apps/api/src` config/boot path | Fail-fast in production on required env; make `/ready` reflect DB reachability. |
| RGB-021 | Board WS has no per-connection event rate limit, no batch-size cap, no explicit `maxPayload` | Engineering | Reported | `server.ts` WS handler | Add per-connection event rate limit + payload/batch caps. |
| RGB-022 | No retry / circuit-breaking for OpenAI intent or Deepgram; an outage burns concurrency slots on timeouts | Engineering | Reported | intent/transcription paths | Add bounded retry + circuit breaker. |
| RGB-023 | No process-level `unhandledRejection`/`uncaughtException` handler | Engineering | Verified | `apps/api/src` | Add handlers that log and exit cleanly (paired with RGB-003). |
| RGB-024 | No connection-level rate limiting on WS upgrades or on `/state` & `/heartbeat` | Engineering | Verified | `server.ts:322,343,363`; `transcription/routes.ts:30` | Per-IP connection/attempt limiter + modest limiter on `/state`,`/heartbeat`. |

### Data / DB correctness
| ID | Title | Owner | Verification | Evidence | Recommendation |
|----|-------|-------|--------------|----------|----------------|
| RGB-025 | Account deletion is not atomic and has no retry — a mid-flight failure leaves a half-erased account | Engineering | Reported | `processDataRequests` sequence in `controlPlaneRoutes.ts` (no transaction) | Wrap in a transaction / make each step idempotent + resumable. |
| RGB-026 | No index on `product_events.profile_id` or `audit_events.actor_profile_id` | Engineering | Reported | export/erasure full-scans the two highest-volume tables | Add indexes in a migration. |
| RGB-027 | `delete_workspace` erases the whole org; account deletion orphans non-default personal orgs | Engineering | Reported | `supabase/migrations` account-operations | Verify & correct the deletion/ownership graph. |
| RGB-028 | Migrations not cleanly re-runnable (create policy / add constraint / drop function lack guards) | Engineering | Verified | `supabase/migrations/*` | Add `if not exists` / `drop … if exists` guards. |
| RGB-029 | `board_shares` (hashed share tokens) is schema-only; no code creates or resolves share links | Engineering / Product | Verified | migration defines table; no producer/consumer in code | Wire share-link flow or drop the table; ensure no UI advertises sharing that doesn't work. |

### Packaging / images
| ID | Title | Owner | Verification | Evidence | Recommendation |
|----|-------|-------|--------------|----------|----------------|
| RGB-030 | API runtime image copies full `node_modules` (esbuild, tsx, typescript, @types) | Engineering | Reported | `infra/cloud-run/api.Dockerfile` | Ship production-only deps. |
| RGB-031 | Docker base images use floating tags (not digest-pinned) and declare no `HEALTHCHECK` | Engineering | Verified | `infra/cloud-run/*.Dockerfile` | Digest-pin bases; add `HEALTHCHECK` (or rely on platform probes explicitly). |
| RGB-032 | Desktop app has no packaging, signing, notarization, or auto-update tooling | Engineering | Verified | `apps/desktop/package.json` (electron devDep only) | Required only for `desktop-public`; tracked as a preview meanwhile. |
| RGB-033 | Chrome extension packaging not run in CI; manifest hardcodes pilot Cloud Run URLs | Engineering | Reported | `extensions/chrome-meet-bridge/manifest.json`; `scripts/package-chrome-extension.mjs` not in CI | Parameterize URLs; run packaging in CI. Ties to `chrome-public`. |

### Docs drift / honesty
| ID | Title | Owner | Verification | Evidence | Recommendation |
|----|-------|-------|--------------|----------|----------------|
| RGB-034 | `Platform Support Matrix.md` still describes the retired Meet add-on architecture, not the shipped 0.8.0 camera overlay | Product | Corrected 2026-07-30 | `Docs/Platform Support Matrix.md` and `extensions/chrome-meet-bridge` | Current channel and release limits now match the private camera-overlay extension. |
| RGB-035 | `Intent Canvas Implementation Notes.md` still documents a removed Preview→Apply confirmation step (contradicts README + code) | Product | Corrected 2026-07-30 | `Docs/Intent Canvas Implementation Notes.md` | Current workflow now documents immediate, undoable command application. |
| RGB-036 | README understates voice-trace storage as "in-memory only" — durable, org-scoped, 14-day storage is implemented | Product | Corrected 2026-07-30 | `README.md`, `voice_trace_events` schema, and lifecycle purge | README now distinguishes durable authenticated storage from the local in-memory fallback. |
| RGB-037 | Two conflicting readiness sources of truth | Founder / Product | Corrected 2026-07-30 | `Public Beta Readiness…`, `Official Launch Readiness.md`, and `ops/launch-evidence.json` | Historical checklist is explicitly superseded; official readiness remains the current authority. |

---

## Tier 4 — External evidence & deploy-config gates (not code)

These are already enforced fail-closed by `ops/launch-evidence.json` / `pnpm launch:check` and are **not** duplicated as backlog items. Summary of what remains human/legal/ops/deploy:

- Production config: `NODE_ENV=production`, non-local HTTPS/WSS URLs, real Supabase keys, ≥32-char signing/API/cron secrets, `AIRBOARD_LOCAL_ENTITLEMENTS=false`, `AIRBOARD_CHROME_EXTENSION_ENABLED=true` for the active Meet release, Resend key.
- Applied production migrations; deployment + commercial smoke evidence.
- Legal/counsel approval; subprocessor review; threat model; independent pentest.
- Backup/restore drill; incident tabletop; monitoring/alert routing; real public status page; support SLA/staffing.
- Email sending domain (SPF/DKIM/DMARC); production auth/OAuth redirect+recovery tests; browser-matrix testing; accessibility-audit sign-off.

---

## Corrected findings

- **Team-plan entitlement (relates to RGB-009):** an auditor claimed the session-start gate is *user-scoped* so invited team members "get no entitlement." **Overturned** — `requireActiveEntitlement` (`controlPlaneRoutes.ts:1864`) filters by `organization_id`, so members of a paying org *do* pass. The genuine issue is only that `seat_quantity` is never enforced (captured in RGB-009).

## Coverage gaps

The audit workflow hit the org monthly spend limit mid-run, so the following were **not completed** and should be run before any GA decision:

- **`voice-gesture-realtime` dimension** — provider-outage degradation, false-accept safety end-to-end, gesture arbitration, and a correctness review of the uncommitted dock-gesture diff (`dockGestureActivation.ts` + the never-run `catalogDock.spec.ts`, see RGB-014).
- **`completeness-critic` dimension** — OSS/third-party-model license attribution, CSP headers, persisted board-JSON schema migration/versioning, cookie-consent/GDPR mechanics in the actual UI, MediaPipe model-asset delivery, i18n, trial/retention time-zone correctness.
- The automated adversarial **verify pass** for most Tier 2–3 items (hence several `Reported` rows above are not independently re-verified).

## Change log

- **2026-07-29** — Backlog created from the 2026-07-28 audit (RGB-001…RGB-037). All items `Backlog`; no implementation committed.
- **2026-11-04** — MLP launch review and stop-ship fixes (committed as `ab43907` on `codex/production-readiness`):
  - **Done:** RGB-002. Added route, board, root and 404 error boundaries: `apps/web/app/error.tsx`, `app/app/boards/error.tsx`, `global-error.tsx` and `not-found.tsx`.
  - **Partial:**
    - RGB-019: added a per-profile stream cap (`AIRBOARD_TRANSCRIPTION_MAX_STREAMS_PER_PROFILE`), but limits are still per process.
    - RGB-024: `/sessions/start` now authenticates first, then rate-limits by profile.
  - **New, fixed:**
    - Voice and LLM routes now require an org entitlement.
    - Rate limits are keyed by profile, and anonymous callers by a trusted-hop client IP (`AIRBOARD_TRUSTED_PROXY_HOPS`) instead of the spoofable first X-Forwarded-For entry.
    - Board state PATCH is compare-and-swap (409 `BOARD_VERSION_CONFLICT`). The client resolves benign conflicts and otherwise offers Keep mine or Load latest.
    - Saves retry with backoff, flush on hide/close, and warn before unload.
    - Asset binaries are erased on board purge and workspace/account deletion.
    - A visible Undo button and an undo toast follow every applied command.
    - Camera-frame UI state is throttled, and `inferenceMs` no longer drives gesture-trace posts.
    - Trial expiry and load failures show recoverable states.
    - The eval capability manifest is aligned to registry 2.0.
  - **Still open from that review:**
    - ~~The production Supabase project is unreachable (NXDOMAIN).~~ Restored the same day; see the deploy entry below.
    - Lifecycle scheduler (RGB-001).
    - Security headers.
    - Sharing and version restore.
    - First-run guidance.
- **2026-11-04** — Supabase restored and `ab43907` deployed to the pilot:
  - Supabase project `ljqxegqdfhqcmkbivldr` resolves again, auth is healthy, and the tables are intact. No migrations changed between `c19290e` and `ab43907`.
  - Cloud Run revisions `airboard-pilot-api-launch-ab43907` and `airboard-pilot-web-launch-ab43907` (images `api:` and `web:launch-ab43907-20261104`, Cloud Build `510bc02f` / `781fe3e5`) were staged with no traffic, checked on their tagged URLs, then given 100% traffic.
  - Smoke checks after the switch:
    - API `/ready` reports `database: ready` with transcription and semantic intent configured.
    - Unauthenticated board PATCH returns 401.
    - Both web URLs serve `/`, `/login` and `/app/boards`, plus the new styled 404.
    - The live sign-in page renders the magic-link form with no console errors.
  - **Not yet verified:**
    - A signed-in save, export and delete pass, and a rollback exercise (the `deployment-smoke` gate stays `pending`).
    - `AIRBOARD_TRUSTED_PROXY_HOPS=1` against real Cloud Run X-Forwarded-For.
    - The lifecycle schedule (Cloud Scheduler API still not enabled).
- **2026-11-04** — Signed-in deploy smoke:
  - Added `pnpm smoke:deploy`. It creates a throwaway account, then covers the entitlement 402→pass flip, board save, stale-version 409, reload, export request and delete-to-trash, and cleans up the account afterwards. It passes on `ab43907` against local Supabase, with no rows left behind.
  - Production checks without a login:
    - Browser CORS allows board PATCH only from the web origin.
    - The `figjam-c19290e` revisions are Ready, which makes rollback a single traffic switch.
  - Not yet run on production: a signed-in pass (needs a real login) and an executed rollback.
  - Minor: the web app returns 404 for `/favicon.ico`.
- **2026-11-04** — Sign-in on the alias web host fixed (`8bbcdbf`):
  - **Problem:** Supabase only redirects sign-in links to the canonical `airboard-pilot-web-634900453473.asia-south1.run.app`, and `efs77okmmq-el` is not on its allow-list. Links requested on that host landed on the canonical root without their PKCE verifier, so sign-in failed silently.
  - **Fix:** web middleware now 307s `AIRBOARD_WEB_ALIAS_HOSTS` to `AIRBOARD_CANONICAL_WEB_ORIGIN`, keeping path and query. It is deployed as `airboard-pilot-web-launch-8bbcdbf` at 100%.
  - **Verified live:** the alias host redirects, while the canonical and tagged revision URLs serve in place.
- **2026-11-04** — Signed-in production smoke in the browser (account with an expired trial, on a never-used board, restored to blank afterwards):
  - **Passed:**
    - Magic-link sign-in on the canonical host.
    - "Your pilot access has ended" state on New Airboard (402).
    - Typed command, then save (`PATCH /boards/:id` 200) and persistence after reload.
    - Toolbar Undo and Redo.
    - Two tabs: the stale save got 409, the "changed in another tab" banner appeared, and **Load latest** reloaded without overwriting.
    - Export PNG (54 KB).
    - Move to Trash with confirmation, then Restore.
  - **Found:**
    - On narrow widths, about 800px, the Airo panel (`aside.canvas-copilot`) covers the undo toast (`z-index: 9`), so the toast is invisible and its Undo can't be clicked; toolbar Undo still works.
    - Every tab visibility change fires a Supabase `SIGNED_IN` event that reloads `/me`; it should reload only when the token changes.
    - The home page ignores `?code=`/`?error=` from misrouted sign-in links.
    - `/favicon.ico` returns 404.
    - Realtime `/sessions/start` returns 403 `OWNER_ENTITLEMENT_REQUIRED` for expired trials (expected), and the board then works without live sync.
- **2026-11-04** — Undo toast kept clear of the side panels (`e33fed1`):
  - **Fix:** the toast now centres in the canvas that the Airo panel and the settings inspector leave visible. At 700px and below, where the Airo panel fills the canvas, it sits on top of the panel (`z-index: 13`).
  - **Checked before deploy** by injecting the rules into the live board. Toast Undo was clickable in every case:
    - Airo open at 600, 800, 900, 980 and 1280px.
    - Settings open at 1280px.
    - Settings and Airo open at 900 and 1280px. At 900px the toast narrows to the 200px left free and its text is truncated.
  - **Real toast Undo:** at 800px, a real toast's Undo removed the test circle.
  - **Exception:** at phone widths with Settings open, the full-screen settings sheet still covers the toast, as before.
  - **Deployed:** `airboard-pilot-web-launch-e33fed1` at 100%, after a no-traffic tagged smoke (pages 200; the minified stylesheet keeps the new rules). `launch-8bbcdbf` stays Ready for rollback.
  - **Verified live at 800px:** the toast sits at 128–328px, clear of the Airo panel at 456px. Its Undo removed the test circle, and the board saved back to blank. The alias host still 307s to the canonical origin.
  - **Found while checking:** at 800px with Airo open, the bottom tool dock (`.object-dock.catalog-dock`) spans -177 to 599px. The Move tool is off-screen, and the right end slides under the Airo panel. The dock's `copilot-open` centring assumes the 378px desktop panel and doesn't fit narrow windows.
- **2026-11-04** — Tool dock kept usable beside the side panels (`676fa97`):
  - **Measured before the fix (Airo open):**
    - At 701–900px the dock was clipped off the left edge (Move hidden), and only 5–9 of its 11 tools were clickable.
    - At 981–1100px the zoom controls covered one or two tools.
    - Settings plus Airo broke the same way below about 1280px.
    - Cause: the `copilot-open` and `settings-open` rules shift the dock's `left` for the desktop panel widths without shrinking it. At 900px and below, the dock is also forced full-width.
  - **Fix:**
    - Above the fit points, the dock centres between the left edge and the zoom controls (`calc((100% - 536px) / 2)` with Airo open).
    - Below them, the open panels stop 94px above the bottom (Airo-only ≤1120px, Settings+Airo ≤1300px, Settings-only ≤940px). The dock and zoom controls then keep their closed-panel layout.
    - At 701–900px the full-width dock reserves 156px on its right for the zoom controls. This also fixes the zoom covering Insert at 701–740px with no panel open.
  - **Also fixed:** the settings panel scrolls again at 900px and below. The old stacked-layout `.sidebar { overflow: visible }` had let 1,500px of settings spill out of the panel, over the dock and out of reach.
  - **Checked before deploy** by injecting the rules into the live board. All 11 tools and all zoom buttons were clickable in every combination:
    - No panel: 560, 701, 760, 800, 1100px.
    - Airo: 701, 800, 900, 901, 980, 981, 1100, 1120, 1121, 1280, 1440px.
    - Settings: 701, 800, 900, 940, 941, 1280px.
    - Settings+Airo: 701, 800, 1000, 1300, 1301, 1440px.
  - **Unchanged:** at 700px and below the Airo and Settings sheets still cover the dock by design. From 941px up, the full-height settings panel still hides the zoom controls.
  - **Deployed:** `airboard-pilot-web-launch-676fa97` at 100%, after a no-traffic tagged smoke (pages 200; all the new rules survive minification). `launch-e33fed1` stays Ready for rollback.
  - **Verified live:**
    - 11/11 tools clickable at 800px (Airo, and Settings+Airo), 1100px (Airo) and 1280px (Airo, and Settings+Airo). The settings panel scrolls.
    - At 800px, the Hand and Move tools select from the dock.
    - Zoom in went to 125%, and Reset returned to 100% with the board saved.
- **2026-11-04** — End-to-end UX review, then typed and voice diagram building fixed (`39e0e38`):
  - **Review (live site plus a local new-user run):** top findings, in order:
    1. Diagram building by command broke after the first shape (fixed below).
    2. The 72-hour trial ends with no paid path.
    3. Production sign-up email is unverified: no custom SMTP or templates in the repo, and only email sign-in is enabled.
    4. Meet and desktop are headline promises but private previews.
    5. Other gaps: no product video, internal jargon in public copy, empty templates, no Share button (the URL carries a 6-hour join token), gesture-first onboarding, and possibly no way to type on a sticky note (needs a manual check).
  - **Problem:** on a fresh board, "add a user", "add an API to the right of the user", "connect user to API" produced two unlabeled User shapes stacked on one spot and a failed connect. Causes:
    - The add path dropped every shape at the view centre.
    - Placement next to a named element was ignored, and "called X to the left of Y" swallowed the placement into the label.
    - The parser matched the sentence's last noun, so "an API … of the user" created a User.
  - **Fix:**
    - The parser reads "left/right of", "above/below" and "next to" a named element, with the last phrase winning and targets capped at 6 words, and ends the label before it.
    - System and flow shapes get default names ("User", "API", "Gateway"), numbered when repeated ("User 2").
    - New command-created elements move to the nearest open spot.
    - A name matching several shapes resolves to the one labelled with it.
    - Icon shapes draw their label under the icon.
  - **Checks:**
    - 606 unit tests pass, grammar eval 223/223, and the false-accept eval finds 0.
    - The Playwright e2e specs could not run: browsers are not installed on this Mac.
  - **Deployed:** `airboard-pilot-web-launch-39e0e38` at 100%, after a no-traffic tagged smoke. `launch-676fa97` stays Ready for rollback.
  - **Verified live:** on a test board, the five-command sequence built User → API → Database, labeled and connected, and saved. The board was then undone back to blank.
- **2026-11-04** — Sign-in email screens and branded templates (`2768485`):
  - **Finding:** Supabase's built-in mailer only emails the project's team ("Email address not authorized") and sends at most 2 an hour. Neither the repo nor the API configures an email provider, so strangers cannot sign up until production has custom SMTP. The production SMTP setting was not readable from this session.
  - **Shipped:**
    - A "Check your inbox" panel (address, same-browser note, spam hint, Resend after 60s, change email).
    - Plain messages for mailer failures (a refused address points to pilot support; rate limits give the wait).
    - Clearer copy for links opened in another browser.
    - Branded magic-link and confirmation templates in `supabase/templates`.
    - SMTP steps in the Commercial Platform Runbook.
  - **Checks:**
    - Local: the real confirmation email rendered with the new template, the inbox panel and countdown worked, and the rate-limit message read "Please wait 34 seconds…".
    - 346 web tests pass.
  - **Deployed:** `airboard-pilot-web-launch-2768485` at 100% after a tagged smoke. The tagged host showed the new callback copy, and the signed-in app still loads. `launch-39e0e38` stays Ready for rollback.
  - **Still open:** custom SMTP on the user's own domain via Resend, plus the branded templates in the Supabase dashboard (account and password steps are the user's).
- **2026-11-04** — First-impression set (`a226e33`):
  - **On-canvas text:** placing a note or shape opens a focused editor on it; double-click, Enter or F2 edits existing text; each edit is one undo step.
    - The editing state had existed since `c19290e`, but nothing rendered it, so typing after placing a note went into the Airo box.
    - Commands create shapes without opening the editor, so focus stays in Airo.
  - **Welcome card:** now "Make your first diagram". It shows three typed commands and the mouse path first, then voice and gestures with a link to the gesture guide, and has a "Start building" button (e2e selectors updated).
  - **New boards:**
    - A lost `/trial/activate` race is tolerated, and a second setup run is skipped.
    - The address is rewritten in place to `/app/boards/<id>`. The previous router navigation raced the live session's URL update and could leave the page on `/app/boards/new`, where a reload created another board. That was probably live in production.
  - **Templates:**
    - Four Airo command scripts (`boardTemplates.ts`, each script tested) build a connected, named diagram on mount, before the live session opens. The session gets it in its opening snapshot; building after connect hit `BOARD_SEQUENCE_CONTENTION`.
    - The result is framed beside the Airo panel (`fitViewportToBounds`).
  - **Plain copy:**
    - Billing shows "Free pilot · Active until/Ended on …" instead of `personal_trial` and the Stripe launch-gate sentence.
    - Pricing reads "Free during the pilot".
    - Dashboard, sign-up, landing, product, demo, templates, changelog, Meet (now with buttons) and status are rewritten.
    - The Airo status line no longer names the speech vendor and model.
    - The legal drafts are unchanged.
  - **Also:** the placement preview clears after a mouse placement.
  - **Checks:**
    - 617 unit tests and both grammar evals pass.
    - Every item was verified in the running app on a local copy.
    - The e2e specs could not run (Playwright browser not installed).
  - **Deployed:** `airboard-pilot-web-launch-a226e33` at 100% after a tagged smoke (12 pages 200, new copy and welcome card in the bundles). `launch-2768485` stays Ready for rollback.
  - **Verified live:** Billing shows "Free pilot · Ended on Jul 22, 2026". Placing a note opened the editor, and the typed text saved to the note. The test board was then undone back to blank.
- **2026-11-05** — One-month pilot (`a0d7ed4`, the user's decision):
  - **API:** `TRIAL_DURATION_MS` is 30 days and the welcome email says one month.
  - **Database:** migration `20261105120000_one_month_pilot_trial.sql`.
    - The Chrome preflight trial function uses 30 days, with its grants kept.
    - Pilots activated within the last 30 days are extended to activation + 30 days, their trial entitlement is restored, and queued reminder emails move to the new end.
    - Older pilots, including the user's own account (activated around July 19), keep their original end.
  - **Copy:** every "72-hour" and "3-day" mention now says one month, across the site, the help center (regenerated), the terms draft sentence (its date still reads 25 July 2026, for counsel) and internal docs.
  - **Checks:**
    - Locally, the migration moved a pilot from Nov 7 to Dec 4 along with its reminders, and kept the function's grants.
    - 617 tests pass.
  - **Deployed:**
    - `supabase db push` applied only this migration (dry runs before and after; the remote is up to date).
    - `airboard-pilot-api-launch-a0d7ed4` and `airboard-pilot-web-launch-a0d7ed4` are at 100% after tagged smokes. The API reports ready, with 401s without auth and a passing CORS preflight; the web serves 8 pages with the new copy.
    - Rollback targets: API `launch-ab43907`, web `launch-a226e33`. The migration's data extension is not rolled back by a traffic switch.
  - **Verified live:** the signed-in app loads all 5 boards through the new API, and Billing still shows the user's pilot ended Jul 22.
- **2026-11-05** — Trust gaps (private boards, lifecycle schedule, rollback drill):
  - **Private boards (`7be667a`):**
    - Boards default to private, but every board route, the board-file routes and the session start checked only the organization, and the read policies only checked membership. Any member of a team organization could list, open, edit, delete and restore everyone's boards and read their history, live-session events and files.
    - `boardAccessFilter` now limits private boards to their owner on every route; organization and link boards stay open to members.
    - Migration `20261105130000_private_board_access.sql` adds `can_read_board` and `can_read_board_session` behind the read policies on boards, versions, sessions, participants, events, snapshots, exports and board assets.
    - Tests: a new API test has another member try every route on a private board, and each returns 404. Locally, a second member saw 1 shared board of 6, 2 of 22 sessions, and 0 private history or events (rolled back).
    - Deployed: migration pushed (dry runs before and after); `airboard-pilot-api-launch-7be667a` at 100% after a tagged smoke. The user's library still lists all 5 boards and a board opens and saves.
    - Rollback: API `launch-a0d7ed4`.
  - **Lifecycle schedule:**
    - Enabled `cloudscheduler.googleapis.com`.
    - Created job `airboard-lifecycle-hourly` (asia-south1, `0 * * * *` UTC), which POSTs `/internal/lifecycle/run` with the `airboard-cron-secret` bearer.
    - First run (manual, 200): 3 trials expired, 0 data requests waiting, retention sweep clean, 5 Trash boards past retention purged in 3 other organizations (the user's library and empty Trash were unaffected), and email not configured, so jobs stay queued.
    - The scheduler's own run returned 200.
    - Still to do: a failed-run alert, which keeps the `lifecycle-schedule` gate pending. Clear stale queued emails before configuring Resend.
  - **Rollback drill:** web traffic moved to `launch-a226e33` in 5s (confirmed by its copy, with pages at 200), then forward to `launch-a0d7ed4` in 4s; 16s on the previous revision. The `deployment-smoke` gate is now verified (launch check 5/23).
- **2026-11-05** — Failed-run alert for the lifecycle job (`e0545e8`):
  - **Alert:** a Monitoring email channel for `hellosigmascience@gmail.com` and the policy "Airboard lifecycle run failed". It is a log match on a Cloud Scheduler AttemptFinished entry at ERROR or HTTP ≥ 400 for jobs starting `airboard-lifecycle`, sends at most one email per 5 minutes, and includes a runbook note.
  - **Test:** a temporary job with a wrong bearer produced the matching entry (ERROR, UNAUTHENTICATED, 401) at 19:07 UTC, then was deleted. The email itself couldn't be checked from this session (the Gmail connector isn't authenticated).
  - **API:** `/internal/lifecycle/run` now returns 500 `LIFECYCLE_STEP_FAILED`, with the summary and a failure count, when any step reports failures. Previously partial failures, such as a storage error during a board purge, returned 200 and could not alert. All 114 API tests pass.
  - **Deployed:** `airboard-pilot-api-launch-e0545e8` at 100% after a tagged smoke (a clean lifecycle run returned 200). The scheduler's run against it returned 200 at 19:20 UTC. The user's 5 boards load. Rollback: API `launch-7be667a`.
  - **Gate:** `lifecycle-schedule` stays pending only until the test alert email is confirmed.
- **2026-11-05** — Failed-run alert fixed and proven:
  - **Problem:** the first alert (a log-match `conditionMatchedLog` policy) never fired. Its filter matched both test failures, but a temporary Pub/Sub channel received nothing, so the user got no email. The Monitoring notification service agent had also never been created.
  - **Fix:**
    - Created the service agent (serviceusage `generateServiceIdentity`).
    - Replaced the policy with log-based metric `airboard_lifecycle_failed_runs`, which counts scheduler executions logged at ERROR for jobs containing `airboard-lifecycle`.
    - New metric alert "Airboard lifecycle run failed" fires when the count is above 0 per 60s and notifies `hellosigmascience@gmail.com`.
  - **Proof:**
    - A temporary wrong-bearer job failed at 19:38:26Z and the metric counted it.
    - The policy opened an incident at 19:42:17Z, seen on the temporary Pub/Sub channel, and closed it automatically.
    - The user confirmed the alert email arrived.
    - The test job, Pub/Sub channel, topic and subscription were removed; only `airboard-lifecycle-hourly` remains.
  - **Gate:** `lifecycle-schedule` is now verified (launch check 6/23).
- **2026-11-05** — Experience gaps: sharing, phones, solo workspaces, waitlists and small fixes:
  - **Share:**
    - A **Share** button in the board header opens a dialog with three parts:
      - **Copy live link:** opens `/live/<session>?joinToken=…`, a new page where anyone joins the running session as a guest, with no account, for the token's 6 hours.
      - **Who can open this board later:** Only you or Everyone in the workspace. Team workspaces only.
      - **Download PNG.**
    - Guests see a live status rather than "Saved". Their edits reach the host, whose board saves them. If a link expired or its session ended, the guest sees a page that explains it.
    - A board address that still carries a live session now sends people who cannot open the saved board to the live page, instead of "board not found".
    - The Meet companion link now joins the same session. Before, `/app/boards/live` created a new saved board and dropped the session, so the companion never synced.
    - The API lets only a board's owner change who can open it (403 `BOARD_OWNER_ONLY`). Before, any member could hide a teammate's shared board.
    - Team workspaces get a **Shared** sidebar entry.
  - **Phones and tablets:**
    - Airo starts closed on phones and opens as a bottom sheet.
    - The top bar fits at 375px: undo and redo move to the ••• menu, and Use screen is hidden.
    - All 11 dock tools fit without overlapping. A later 42px rule had overridden the small-screen sizes.
    - Boards open framed on their content when any of it would start off screen.
    - Commands place new objects in the part of the canvas the Airo panel leaves visible.
    - On portrait tablets the canvas fills the screen. A 64vh rule had left a third of it empty.
    - **Sign in** shows in the landing header on phones.
  - **Solo workspaces:** the admin menu is hidden, old admin links explain why, and the sidebar names the workspace type.
  - **Meet, desktop, Zoom and Teams:** in-app sales-form links are replaced with a one-tap **Notify me**, which files a `waitlist` support request. The Meet setup checklist appears only once an extension or installation exists; until then the page explains how to use Airboard in meetings today. Overview hides integration health until a surface can be used.
  - **Small fixes:**
    - Added a favicon, SVG icon and Apple touch icon.
    - Camera and microphone blocks give browser-specific steps. The camera message used to say "for localhost".
    - `/me` reloads only when the signed-in person changes, not on token refreshes or tab focus.
    - The home page forwards `?code=` and `?error=` to `/auth/callback`.
  - **Verified locally:**
    - A guest from another origin joined with no account, and their command saved to the host's board (version 2).
    - The access toggle saved, then reverted.
    - Expired and incomplete links show the right page.
    - Layouts checked at 375, 768 and 1280px.
    - A waitlist request landed in `support_requests`.
    - Web 365/365 and API 115/115 tests pass, and every package typechecks. The e2e suite was not run (no Playwright browser installed).
  - **Deployed** (commit `0f6ab46`): `airboard-pilot-api-launch-0f6ab46` and `airboard-pilot-web-launch-0f6ab46` at 100%. No migration.
    - Tagged smoke before promotion: API health 200 and an unauthenticated visibility change 401; 9 web pages 200; favicon, SVG and Apple icons served and linked; `/live/...` is `noindex`; the home page forwards `?error=` to the callback (307). The bundles carry the Share dialog, guest status, live-link problem pages, Notify me, the personal-workspace admin page and the phone bottom sheet.
    - On production, a bad live link reaches the API (401 `VALID_JOIN_TOKEN_REQUIRED`, CORS allowed) and shows "This live link has expired". The owner's 5 boards load, and a board opens with **Share**.
    - Rollback: API `launch-e0545e8`, web `launch-a0d7ed4`.
  - **Found after deploy:** the owner's production account cannot start a live session (`/sessions/start` 403 `OWNER_ENTITLEMENT_REQUIRED`). Every session start in the logs back to 2026-11-04 failed the same way, so this predates the deploy.
    - Cause: the account has no active or trialing entitlement. The trial-expiry step of the hourly lifecycle job likely ended it; the production database was not read to confirm.
    - New pilots are unaffected: opening a first board activates a 30-day trial, and live sessions start.
    - The product hides an ended pilot. **Share** says the live server could not be reached, and **Billing** says the pilot "starts when you open your first board", because `/me` drops expired entitlements. New boards are refused too (`POST /boards` requires an entitlement).
- **2026-11-05** — Ended pilots are explained instead of hidden:
  - **API:**
    - `/me` reports the latest entitlement even after it ends; a live one still comes first, and a pending (not started) trial last. Before, an expired trial looked like no entitlement at all.
    - Live sessions check the workspace's entitlement, as new boards and Airo already did. Before, they checked the signed-in person's own row, so members of a team, whose entitlement is held by its owner, could not start live sessions.
  - **Billing:** an ended pilot shows "Ended on <date>", says what still works (saved boards open and save) and what is off (new boards, live links, Airo voice), and offers one-tap **Ask for more pilot time**. A pending pilot now says it starts with the first board. Before, it showed "Ended on" the sign-up date.
  - **Share:** when the pilot has ended, the live-link section says so and links to Plan & billing. Before, it blamed the live server.
  - **New board blocked:** the "pilot access has ended" page uses the same one-tap request.
  - The request files a `pilot_extension` support request and remembers it per ended pilot. "Notify me" now uses the same button.
  - Help: the trial and billing article gains "When the pilot ends", and the error-code reference lists the two entitlement codes.
  - **Verified locally** with the test account's pilot ended, then pending, then restored: Billing in all three states, the request landing in `support_requests`, the Share note, the blocked new-board page, and a live link again once active.
  - Web 368/368 and API 117/117 tests pass (new: plan states, live-start failure, `/me` entitlement choice, team-member session start), and every package typechecks.
  - **Deployed** (commit `1217615`): `airboard-pilot-api-launch-1217615` and `airboard-pilot-web-launch-1217615` at 100%. No migration.
    - Tagged smoke before promotion: API health and ready 200; `/me` and `/sessions/start` refuse unauthenticated calls (401); 10 web pages 200. The bundles carry the Billing ended state, the one-tap request, the Share note and "Ask about Personal". The help articles serve the new section and codes.
    - On production, the owner's Billing reads "Ended on Jul 22, 2026" with the explanation and **Ask for more pilot time**; the request was not sent. **Share** on a board says the pilot has ended and links to Billing.
    - Rollback: API and web `launch-0f6ab46`.
    - Seen while checking: opening a board takes about 8 seconds on production, because the page makes about six API calls one after another and each takes 1–2 seconds. Latency matches earlier revisions, so this deploy did not cause it.
- **2026-11-05** — The owner's pilot extended, with the user's approval:
  - The owner's personal workspace had a 3-day trial that ended on 2026-07-22 (the lifecycle job marked it expired on 2026-11-04).
  - The trial and its entitlement now run 30 days from today, to 2026-12-05. The change was one production transaction, and the original activation date is kept. No reminder emails were queued for the new end.
  - Billing now reads "Active until Dec 5, 2026", and **Share** on a board offers **Copy live link**.
  - Seen while connecting: the Supabase project is in ap-northeast-2 (Seoul) and the API is in asia-south1 (Mumbai), so every database call crosses regions. This bears on the slow board open.
- **2026-11-05** — Board writes work on any PostgREST version:
  - **Problem:** saving, trashing and restoring a board used an OR access filter on the update. PostgREST v14.3 rejects that with 42703 ("column boards.… does not exist"), so every board write failed on a fresh local stack. A new worktree without `supabase/.temp` version pins gets v14.3. Production runs v14.5, which accepts the filter, so production was not affected (checked with `supabase services` and the same request against both versions).
  - **Fix:** `writeAccessibleBoard` (`apps/api/src/boardAccess.ts`) runs each write with plain filters, first as the board's owner, then, only if that matched nothing, on a shared board. That is the same access rule, with no double write; the second step costs a member on a shared board one extra round trip.
  - **Tests:** the test fake now rejects an OR filter on writes, and a new test covers a member saving (including a version conflict), trashing and restoring a shared board.
  - **Verified** against real PostgREST v14.3 and v14.5 containers: owner save, member save, trash and restore on a temporary shared board, and refusal on another person's private board. The old filter fails only on v14.3.
  - API 118/118 and web 368/368 tests pass, and every package typechecks.
- **2026-11-05** — Opening a board made fast:
  - **Cause:** every signed-in request made about 4 Supabase round trips in a row: `auth.getUser` (a call to Supabase Auth), the profile, the membership, then the route's own query. `/sessions/start` made 8–9. The board page sent 7 of these one after another: `/me`, then the preflight and `/me/organizations`, then `/trial/activate`, then `GET /boards/:id`, then `/me` again, then `/sessions/start`. Supabase runs in Seoul (ap-northeast-2) and the API in Mumbai (asia-south1), so every round trip crosses regions.
  - **Server:**
    - The access token is checked locally against the project's ES256 signing key (`auth.getClaims`; supabase-js caches the key for 10 minutes) instead of calling Supabase Auth. A signed-out session's token stays usable until it expires (at most an hour).
    - The profile and its memberships come back in one query.
    - Requests that arrive together share one sign-in lookup, and later ones reuse it for 30 seconds. Switching organization, accepting an invitation, changing a member's role or status, renaming a profile and deleting an account drop it at once.
    - `/sessions/start` reads the owner, the entitlement and the board access together.
    - CORS preflights are cached for 10 minutes (`Access-Control-Max-Age: 600`). Chrome rechecked them after 5 seconds before.
  - **Web:**
    - A board page mounts as soon as the sign-in token is known, and the board loads alongside `/me`.
    - `/trial/activate` and the second `/me` run only while the trial is still `eligible`. The preflight record no longer holds up the board. An organization without a trial row could not open boards before (`TRIAL_NOT_ELIGIBLE`), and now it can.
    - Board pages skip `/me/organizations`, which only feeds the hidden sidebar.
  - **Measured locally** against the local Supabase stack with production builds of the web app and API. "+130 ms" sends every Supabase request through a proxy that adds 130 ms, roughly the Mumbai–Seoul round trip. Each row is the median of 3 runs with a cold sign-in cache (the replayed baseline is the median of 5).

    | Opening a saved board | Supabase calls | Canvas mounted | Live session |
    |---|---|---|---|
    | Before, local | 40 | 217 ms | 281 ms |
    | After, local | 13 | 67 ms | 92 ms |
    | Before, +130 ms, in the browser | 40 | 2,960 ms | 4,073 ms |
    | Server change only, +130 ms, replayed requests | 20 | 921 ms | 1,368 ms |
    | After, +130 ms, in the browser | 13 | 347 ms | 764 ms |

  - **Production estimate:** production request logs (1,127 successful requests, 2026-11-03 to 2026-11-05) put each Supabase round trip at about 180–225 ms. The routes that make 4 in a row take 760–900 ms at the median and about 710 ms at best, and `/sessions/start` (8–9 in a row) took 1.6 s. CORS preflights take 2 ms on the server, so they cost only the browser's round trip.
    - API time on the path to the canvas: about 4.1 s (5 calls in a row) before, about 0.4 s after.
    - API time on the path to the live session: about 5.7 s before, about 1 s after.
    - Page download, hydration and the browser's own round trips come on top. They are unchanged, apart from fewer preflights.
    - After 10 idle minutes, the first request fetches the signing key again, which costs one more round trip.
  - Web 373/373 and API 125/125 tests pass (new: local token checks, the shared and dropped sign-in, membership choice, the board-open order, parallel session-start reads, the preflight max age), and every package typechecks.
  - **Still open:**
    - The database and the API sit in different regions, so each remaining round trip still costs about 180–225 ms. Running the API in asia-northeast3 (Seoul), or moving Supabase to ap-south-1 (Mumbai), would bring each one down to a few milliseconds.
    - `/sessions/start` still inserts the session and then its owner participant in two steps; one database function would make it a single round trip.
    - The canvas starts its live session only after it mounts. Starting it together with the board load would hide about three more round trips.
    - Locally, the Supabase CLI's default PostgREST v14.3 failed every board save (42703 on the `or=` access filter). Fixed by `writeAccessibleBoard` in the entry above. A worktree still gets production's versions only after copying `rest-version`, `postgres-version` and `gotrue-version` from the main checkout's `supabase/.temp/`.
- **2026-11-05** — Faster board open and version-proof board writes deployed:
  - **Deployed** (merge commit `6cdeed8`, which brings in the faster board open and `a9c9439`, the board-write fix): `airboard-pilot-api-launch-6cdeed8` and `airboard-pilot-web-launch-6cdeed8` at 100%. No migration.
  - **Tagged smoke before promotion:**
    - API health and ready 200.
    - `/me` refuses no token, a malformed token and a forged HS256 token (401).
    - Preflights carry `Access-Control-Max-Age: 600`.
    - 8 web pages 200.
    - With the owner's real session from the production page, the tagged API returned `/me` (personal workspace, trial activated, entitlement trialing), the 5 boards and a board. The session's tokens are ES256, so they are checked locally.
  - **On production after promotion:**
    - Opening a board runs `/me`, the preflight and the board load in parallel.
    - Warm, the board loaded in about 0.8 s and the live session was ready in about 1.75 s, against about 9.3 s on `launch-1217615`. The first open on fresh instances took about 2.75 s.
    - A metadata save that re-sent the board's own title returned 200 through `writeAccessibleBoard`, with the title and version unchanged.
    - **Share** offers **Copy live link**.
    - The new API revision logged no errors besides the smoke's own 401s.
  - Rollback: API and web `launch-1217615`.
  - The API (Mumbai) and Supabase (Seoul) are still in different regions; co-locating them is the remaining large latency win.
- **2026-11-05** — Read-only switch for the Supabase move:
  - **API:** with `AIRBOARD_READ_ONLY=true`, every change gets `503 MAINTENANCE` with `Retry-After: 300` (`apps/api/src/readOnly.ts`). The guard runs after CORS, so browsers can read the refusal. Board live connections close with `MAINTENANCE`, and `/auth/config` reports `readOnly`.
  - **Web:** `airboardApi` announces a maintenance refusal, and a banner in the app shell and on the guest live page shows "Airboard is down for a short upgrade". The banner also appears on load when `/auth/config` says read-only, and it rechecks every 30 seconds. Saves, Share and guest live links each explain the pause. The error-code reference lists `MAINTENANCE`.
  - **Verified locally** with the API in read-only mode: the dashboard banner; a board opening with Share explaining the pause; an edit showing "saving is paused" and retrying; and a guest live link showing the upgrade page with Try again.
  - API 128/128 and web 375/375 tests pass (new: the guard with real CORS, and the maintenance announcement), and every package typechecks.
  - The new Mumbai project `ujotgzjpkocuhtfrvbzu` (Aura organization) is created and set up with all migrations and sign-in settings, with no data. See `Docs/Supabase Move to Mumbai Plan.md`.
  - **Deployed, switch off** (commit `513185f`): `airboard-pilot-api-launch-513185f` and `airboard-pilot-web-launch-513185f` at 100%. No migration.
    - **Tagged smoke:** API health and ready 200; `/auth/config` reports `readOnly: false`; unauthenticated changes reach the sign-in check (401, not 503); 6 web pages 200. The bundles carry the banner and the pause messages, and the error-code help lists `MAINTENANCE`.
    - **Production after promotion:** `/auth/config` reports `readOnly: false`. On the owner's board, every request returned 200 (including the banner's `/auth/config` check), the live session started and no banner showed. The new API revision logged no server errors.
    - **Rollback:** API and web `launch-6cdeed8`.
    - **To turn it on at cut-over:** `gcloud run services update airboard-pilot-api --project=project-1217dd57-9cac-491d-b8d --region=asia-south1 --update-env-vars AIRBOARD_READ_ONLY=true`, then `gcloud run services update-traffic airboard-pilot-api --project=project-1217dd57-9cac-491d-b8d --region=asia-south1 --to-latest`. Turn it off the same way with `false`. Deploys pin traffic to a named revision, so the settings change alone creates a revision that gets no traffic; the second command sends traffic to it. Every later deploy copies the service's saved settings, so turn the switch off the same way before deploying again.
- **2026-11-05** — Supabase moved from Seoul to Mumbai:
  - Production now uses `ujotgzjpkocuhtfrvbzu` (Aura organization, ap-south-1), next to the API and most pilot users. The step-by-step record is in `Docs/Supabase Move to Mumbai Plan.md`.
  - **Copy:**
    - Data-only copy while the API was read-only.
    - All 38 tables have matching row counts, and content fingerprints match.
    - Sign-in sessions were left behind, so everyone signs in again.
    - There were no storage files to copy.
  - **Live:** API `airboard-pilot-api-mumbai-fff6d97` (the `launch-513185f` image; `SUPABASE_URL` set to Mumbai; secret `airboard-supabase-secret-key-mumbai:1`) and web `airboard-pilot-web-mumbai-fff6d97` (built with Mumbai's URL and publishable key).
  - **Checks:** readiness against the Mumbai database passes, the lifecycle run returns 200, and read-only is off.
  - **Rollback:** Mumbai revisions only. The owner deleted the Seoul project the same day, so every earlier revision points at a project that no longer exists.
  - **Open:**
    - Resend SMTP. Until then, sign-in emails reach only Aura organization members.
    - ~~Deleting the Seoul project `ljqxegqdfhqcmkbivldr`.~~ Done by the owner on 2026-11-05.
    - The unused secret `airboard-supabase-secret-key` can be deleted.
- **2026-11-05** — Hardening for the pilot launch (commit `3c85863`):
  - **Launch check:** `pnpm launch:check:deployed` reads the serving Cloud Run revisions, their Secret Manager values (in memory, never printed) and the web image's Cloud Build substitutions, instead of the local `.env`. The board-socket check derives `wss://` from the API URL; nothing reads `AIRBOARD_WS_URL`. Against production it reports **19/23**. The four left are real: lifecycle email (Resend), release owner, support path and commercial smoke.
  - **Graceful shutdown (RGB-003):** on SIGTERM the API closes board sockets with 1012, so clients reconnect to the new instance, lets in-flight requests finish, and exits within 8 s (`apps/api/src/shutdown.ts`).
  - **Outbound timeouts (RGB-005):** Resend 10 s (a failed send is retried in 15 minutes), Stripe 15 s, Supabase auth settings 5 s.
  - **Accessibility (part of RGB-006):**
    - Share and the board and library dialogs keep Tab inside, close on Escape and return focus to where it was (`useModalFocus`).
    - The marketing, app and help shells start with a "Skip to content" link.
  - **Dependencies:**
    - Next 15.5.29, Fastify 5.12.8 and sharp 0.35.5.
    - `pnpm-workspace.yaml` overrides PostCSS under Next (8.4.31 → 8.5.32) and pins the patched `sharp` and `fast-uri` releases within their declared ranges.
    - Production audit: 0 vulnerabilities, from 3 critical and 24 high. The remaining dev-only findings are Electron in the unshipped desktop app.
  - **CI:**
    - ESLint with a bug-only rule set (React Hooks rules plus core correctness rules; vendored MediaPipe excluded).
    - The repository script tests (182).
    - `pnpm audit --prod --audit-level=high`.
    - A gitleaks scan of full history. Four reviewed false positives, notification template names, are ignored by fingerprint in `.gitleaksignore`.
    - Dependabot for npm and GitHub Actions.
  - **Deployed:** `airboard-pilot-api-launch-3c85863` and `airboard-pilot-web-launch-3c85863` at 100%, each with **one warm instance** (`min-instances=1`, max stays 1) to avoid cold starts. Mumbai settings and secret are unchanged.
    - **Smoke:**
      - readiness passed against Mumbai;
      - missing and forged tokens got 401;
      - the preflight max-age is 600;
      - 7 web pages returned 200, with the skip link present;
      - the bundles reference only Mumbai;
      - neither revision logged errors;
      - on production, the first Tab lands on the skip link.
    - **Rollback:** `mumbai-fff6d97` (both services). Earlier revisions point at the deleted Seoul project.
  - **Tests:** API 129, web 376, all packages pass, and the full e2e suite (53 passed, 2 skipped) includes two new keyboard tests.
- **2026-11-05** — Remaining engineering items:
  - **Hook dependency review (all 28 warnings):**
    - **Real bugs fixed:**
      - Airo's AI interpretation and voice diagnostics kept a stale sign-in token after the hourly refresh, so they would fail after an hour on one board.
      - Leaving a board with the camera on left the camera running: the unmount cleanup read a `<video>` ref that React had already cleared. The stream now lives in `cameraStreamRef`.
    - The rest were stable helpers, now listed, or deliberate triggers, documented in place.
    - Lint is now at 0 errors and 0 warnings.
  - **Keyboard menus:** `useMenuKeyboard` gives the ••• board menu and the library's board menus focus-on-open, arrow keys and Home/End, Escape back to the button, and close-on-Tab. The drawing-tool pop-outs share the same stepping rule.
  - **Lighter landing page:** the home page loads the board (desktop overlay, test harness) only on demand. First-load JS for `/` is 113 KB, down from 298 KB.
  - **Faster live start:**
    - A saved board's page sends `/sessions/start` alongside the board load (`requestBoardSessionStart`).
    - The board reuses that request through a cloned response, so it is safe when React remounts it.
    - The API takes a board's session workspace from the board itself. The single-insert session change was skipped: it needs a migration, and Mumbai made the saving small.
  - **Library:**
    - `GET /boards?preview=1` returns each board's outline (`boardPreview` in core: up to 60 shapes and lines, plus up to 40 text snippets), never its full content.
    - The library and dashboard draw miniatures.
    - Search matches titles and the words on boards.
    - Cards read "Updated 5 minutes ago · Only you" instead of "private · version N".
  - **Exports:**
    - **Export PDF:** a one-page PDF from a small writer with no dependencies. The page has the on-screen size and the image keeps every pixel.
    - **Copy image:** a PNG on the clipboard. Share has it too.
    - The app's embedded browser pane denies clipboard writes, so this was verified in Playwright with clipboard permission.
  - **Landing demo:** a CSS-only loop (`IdeaDemo`) on the landing page and `/demo`, where a typed sentence becomes a connected diagram. With reduced motion it shows the finished board. "See an idea move" scrolls to it.
  - **Tests:** API 131, web 384, core 64, scripts 182; lint and typecheck clean; the full e2e suite (56 passed, 2 skipped) includes new tests for the board menu keyboard, Copy image and Export PDF. One stylus e2e test failed once under 5 parallel workers and passed 4/4 alone and in a full rerun.
  - **Deployed** (commit `34df218`): `airboard-pilot-api-launch-34df218` and `airboard-pilot-web-launch-34df218` at 100%. No migration.
    - **Tagged smoke:**
      - Mumbai settings and secret kept, read-only off;
      - readiness passed against Mumbai;
      - `/boards?preview=1` and `/sessions/start` refuse signed-out callers;
      - 7 web pages returned 200;
      - the landing page and `/demo` carry the demo, and help lists Export PDF;
      - the bundles carry Export PDF, Copy image and library previews and search, and reference only Mumbai.
    - **Production:** readiness passes; the deployed launch check reads the new revisions at 19/23; the new API revision logged no errors.
    - **Graceful shutdown seen in production:** the outgoing `launch-3c85863` API instance logged `shutting down` on SIGTERM at 08:05:16 UTC.
    - **Warm instances fixed:**
      - Revision-level `min-instances=1` (from `3c85863`) kept tagged, no-traffic revisions running and billed, per Cloud Run's docs.
      - Both services now use a **service-level minimum of 1** (`gcloud run services update --min=1`), which only applies to revisions receiving traffic.
      - The `launch-3c85863-*` tags were removed.
      - Deploys now stage with `--min-instances=default`.
      - `launch-34df218` still carries a revision-level minimum, so remove its tag after the next promotion.
    - **Rollback:** both services to `launch-3c85863` (untagged; route with `--to-revisions`).
- **2026-11-05** — Engineering leftovers:
  - **Desktop tooling:** Electron 43.1.1 → 43.8.7, which clears every Electron advisory. `pnpm-workspace.yaml` pins `undici` ^7.30.1, used only by Electron's download helper. The full audit (dev included) has 0 high and 0 critical. One moderate is left: `minimatch` under typescript-eslint, which needs a major upgrade.
  - **One-step session start:**
    - Migration `20261105140000_start_board_session_rpc.sql` adds `start_board_session`, which inserts the live session and its owner participant in one transaction. This saves a round trip on every board open, and a session can no longer exist without its owner.
    - Only `service_role` may call it; `anon` and `authenticated` cannot.
    - Access checks stay in the API.
    - The migration must be applied before the API revision that calls it.
  - **Live boards across API instances (RGB-007):**
    - Each instance relays an accepted event to its own sockets first, then publishes it on a private Supabase Realtime channel for that session (`airboard:board-session:<id>`, `self: false`).
    - Other instances holding sockets for the session relay it to theirs (`apps/api/src/boardEventFanOut.ts`).
    - An instance joins the channel when the first socket for a session arrives and leaves it with the last.
    - Events are batched under 900 KB per message. An event too large for one message goes as its sequence number, and receivers read it from `board_events`.
    - **Nothing lost or doubled:**
      - Broadcast is best effort, so each instance keeps a per-session mark: every sequence up to it has reached its sockets.
      - The mark is read before the channel joins.
      - On every join and rejoin (a Realtime reconnect), the instance reads anything newer from `board_events`.
      - A message that skips past the mark has the gap read first.
      - Anything at or below the mark is never relayed again.
    - Before the channel has joined, or from an instance with no socket on that board, events go over HTTP: `httpSend`, falling back to `send()` on Realtime servers older than v2.97 (the local CLI runs v2.73.2).
    - The database stays the record. The `(board_session_id, sequence)` unique constraint already ordered concurrent writers.
    - The owner-absence lock is safe across instances: a timer on one instance checks the session row, and owner heartbeats every 30 s mark it active well inside the 180 s grace period.
    - Rate limits stay per instance.
    - Browsers cannot listen in: the channels are private, the API joins them with its service key, and there is no `realtime.messages` policy for `anon` or `authenticated`.
    - **Fan-out check in `/ready`:**
      - `/ready` reports `dependencies.boardFanOut` as `ready`, `unavailable` or `off`. To get it, the instance joins and leaves a throwaway private channel.
      - A pass is reused for 10 minutes. A failure is retried after 30 seconds and logged as `board event fan-out cannot join its channels`, with the server's reason.
      - A fan-out failure does not change `ready`, because one instance still works.
      - The check first ran at startup. On Cloud Run that reported `CHANNEL_ERROR` because CPU is throttled outside requests. The same key, Node 22 and the same client joined production's private channels from outside Cloud Run, so the check moved into a request.
    - `AIRBOARD_REALTIME_FANOUT=off` turns the fan-out off.
    - **Capacity:** one API instance uses one Realtime connection, and Supabase allows 100 channels per connection. Cloud Run concurrency is 80 sockets per instance, so an instance stays under that limit. Raising concurrency above 100 would need more connections.
    - **Verified:**
      - Unit tests with a fake Realtime hub, including dropped messages, a rejoin and late duplicates.
      - A test with two real API servers sharing one store, where the owner's edit on one reaches a guest connected to the other, once and without an echo.
      - Against local Supabase Realtime: cross-instance delivery, no echo, delivery from an instance that never joined, a public-key browser refused (`CHANNEL_ERROR`), and the probe passing with both the legacy service-role JWT and the new `sb_secret_` key.
      - The Supabase store against the local database: session start through `start_board_session`, then the range and latest-sequence reads.
  - **Warm instances:** the `launch-34df218-*` tags were removed, so that revision's own minimum stops applying once it leaves traffic.
  - **Tests:**
    - API 135 and scripts 182.
    - Lint, typecheck, docs, the PR evals, the production audit and the build are clean.
    - The full e2e suite: 56 passed, 2 skipped.
  - **Deployed:**
    - **Migration:** `20261105140000` was applied to Mumbai first.
      - Only `service_role` may execute the function.
      - A call as `service_role` inside a rolled-back transaction returned an active 6-hour session with its linked owner and left no row.
    - **API:** `airboard-pilot-api-launch-87aec6f` (commit `87aec6f`) at 100%, with a revision max of 3 instances.
      - The first staged revision (`6d2bb10`) logged `CHANNEL_ERROR` from the startup check, which led to the `/ready` check above. It was never promoted, and its tag was removed.
    - **Web:** `airboard-pilot-web-launch-6d2bb10` at 100%. Its code is unchanged since then, and it stays at 1 instance.
    - Both services keep the service-level minimum of 1.
    - **Smoke:**
      - Mumbai settings and secret kept, read-only off.
      - Production `/ready` reports `database: ready` and `boardFanOut: ready`.
      - Session start, board list and a forged token got 401.
      - 7 web pages returned 200.
      - The bundles reference only Mumbai and the production API.
      - Neither revision logged errors.
      - The deployed launch check is unchanged at 19/23.
    - **Rollback:** both services to `launch-34df218` (untagged; route with `--to-revisions`). The new function is additive, and older revisions ignore it.
- **2026-11-05** — Release tooling and status (part of RGB-004):
  - **`infra/cloud-run/release.sh`:** `build`, `stage api|web` and `promote api|web` commit the deploy steps used through November.
    - It builds both images for HEAD as `launch-<commit>`, and refuses to build with uncommitted tracked changes.
    - It stages each revision with no traffic on its own tagged URL. The API may grow to 3 instances and the web to 1, and staged revisions hold no warm instances.
    - It sends all traffic to a named revision.
    - `AIRBOARD_RELEASE` picks another release (rollback). `DRY_RUN=1` prints the commands instead of running them.
  - **`Docs/Project Status.md`:** what is live, what shipped, what is left with owners, and how to release.
- **2026-11-05** — Google sign-in for everyone:
  - **Google Auth Platform** (pilot project):
    - The consent screen is now "Airboard" (it read "sigma-fit"). It has home, privacy and terms links on the live site.
    - The authorized domains are the Supabase project and the web host.
    - The developer contact was misspelled and is corrected.
    - Publishing status is **In production** for External users. It asks for no sensitive scopes, so it needs no Google verification.
    - The web client "Airboard sign-in (Supabase)" redirects to `https://ujotgzjpkocuhtfrvbzu.supabase.co/auth/v1/callback`.
  - **Supabase:**
    - `[auth.external.google]` in `supabase/config.toml` reads its client ID and secret from `.env` (`SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_ID`, `SUPABASE_AUTH_EXTERNAL_GOOGLE_SECRET`).
    - `supabase config push` changed only the Google provider, as previewed.
    - The secret was pasted into `.env` by the owner and never printed or committed.
  - **App:** no code change. The login page reads Supabase's providers and now shows "Continue with Google". New accounts get their Google name and avatar through the existing profile trigger.
  - **Verified without signing in:**
    - Production auth settings list `google` and `email`.
    - `/auth/v1/authorize?provider=google` sends people to Google with the new client, the Supabase callback and the `email profile` scope.
    - Google accepts the client and opens its sign-in page.
    - The live `/login` shows the button.
    - The owner's first Google sign-in is the end-to-end test.
- **2026-11-05** — Faster camera start (commit `f33b2cb`):
  - **Finding:** the owner saw a long wait before Chrome's camera prompt. Airboard asks for the camera in the same tick as the click, from both the Airo button and Settings; this was measured in Playwright. The wait before the prompt is inside Chrome or macOS: opening the camera, finding devices such as Continuity Camera or virtual cameras, or another app holding the camera.
  - **Fix:**
    - Hand tracking (a 3.3 MB compressed engine plus a 7.8 MB model on a first visit) used to download only after the camera was granted. It now loads while the browser asks, and a tracker nobody adopts is closed when it arrives.
    - If the browser takes more than 1.5 s to answer, Settings and the Airo panel explain the prompt and where to look.
  - **Measured:** with a simulated 4 s prompt, the tracker files finished at +0.5 s and hands were on 0.6 s after the camera answered.
  - **Tests:** web 384. Full e2e: 56 passed, 2 skipped. The known stylus flake failed once under parallel load and passed 4 of 4 alone and in a full rerun.
  - **Deployed with `infra/cloud-run/release.sh`** (its first real run): web `airboard-pilot-web-launch-f33b2cb` at 100%. The API is unchanged at `launch-87aec6f`.
    - **Tagged smoke:** revision max 1 and no revision minimum. 7 pages returned 200. The bundles carry the camera message and reference only Mumbai and the production API.
    - **Production:** the pages and API `/ready` pass, and the new revision logged no errors.
    - **Rollback:** web to `launch-6d2bb10`.
  - **Release script:** `promote` now prints only the serving revision. The services still carry old tagged revisions (24 web, 16 API) that stay reachable at their own addresses.
- **2026-11-05** — Calmer board (commits `c68493b`, `6c4ca43`). The owner found the board too crowded with the camera on, Airo listening and a section selected.
  - **Top bar:** Share plus one menu (**•••**). Airo voice and hands, the screen background, undo and redo, diagram visibility, the exports, board settings, help and Move to Trash all live in the menu. The menu now opens above the settings drawer; before, the drawer covered it.
  - **Airo:**
    - While Airo is on, its panel is a corner strip: what it heard, what it is doing, and a one-line composer. **⤢** shows the activity and **⤡** shrinks it again.
    - The on/off switch (**⏻**) is on the panel.
    - A camera that is still starting counts as on, so the panel doesn't flip between strip and full while hand tracking loads.
  - **Element toolbar:**
    - Compact by default: kind, colour swatches, order, duplicate, delete and **More**.
    - **More** shows every field (size, rotation, lock and the kind-specific controls), and **Less** goes back.
    - It floats above the selection, or below it near the top bar, and stays clear of the dock (`contextToolbarPosition`). This also ends the clipped Fill, Border and Width labels.
  - **Zoom:** at the end of the tool dock. Phones hide it and pinch instead. The dock's breakpoints beside open panels moved for its new width (675px).
  - **Help:** the voice, screen and pointer articles describe the new controls.
  - **Build fix:** the web build's command-contract check looked for a literal `className="canvas-copilot"`, now conditional, so the first image build failed. The check now looks for the panel's test id, and the capability evidence names the renamed top-bar test. This failure was missed because the full web build was not run locally before the commit; typecheck, lint and tests all passed.
  - **Tests:**
    - Web unit tests: 386.
    - Script tests: 182. The PR evals, docs check and local web build pass.
    - Full e2e: 59 passed and 2 skipped. New `boardLayout.spec.ts` covers the floating toolbar, the Airo strip and the dock zoom, and passed 3 of 3 runs.
    - Screenshots were reviewed with a fake camera at 1000×650.
  - **Deployed** with `infra/cloud-run/release.sh`: web `airboard-pilot-web-launch-6c4ca43` at 100%. The API is unchanged at `launch-87aec6f`.
    - **Tagged smoke:** revision max 1 and no revision minimum. 7 pages returned 200. The bundles carry the strip, dock zoom and menu changes and reference only Mumbai. The screen help article shows the new wording.
    - **Production:** the pages and API `/ready` pass, and the new revision logged no errors.
    - **Rollback:** web to `launch-f33b2cb`.
- **2026-11-05** — Old revision addresses removed:
  - **Removed:** 24 web and 15 API tags from earlier deploys (`gcloud run services update-traffic --remove-tags`), including pre-hardening builds and builds that pointed at the deleted Seoul project.
  - **Kept:** only the serving revisions' tags, `launch-6c4ca43-web` and `launch-87aec6f-api`.
  - **Unchanged:**
    - Traffic stays at 100% on those revisions.
    - The services keep a minimum of 1 instance; the maximum is 1 for the web and 3 for the API.
    - The revisions themselves remain, so rollbacks still work with `--to-revisions` (or `AIRBOARD_RELEASE=launch-<hash> infra/cloud-run/release.sh promote …`).
  - **Checked:** sampled old addresses now return 404, and production web and API `/ready` pass.
- **2026-11-05** — Cleanup. An import graph, an export scan, a CSS-class scan and an asset scan flagged these; a review of the docs, scripts and config confirmed the rest.
  - **Dead code removed:**
    - `meetActivityState.ts` and its test: production never used it.
    - The barrel `scripts/lib/interaction-eval.mjs`: nothing imported it.
    - 12 unused exports, including `createAnnotationFromGesture`, `createPaletteNode`, `createBrowserSpeechSession`, `createBridgedMicStream` and `probeMediaCaptureCapability`.
    - The 23 helpers that only those exports used. `gestureAnnotationMode.ts` went from 1,207 to 772 lines.
    - The API's unused `tsx` dev dependency.
  - **Dead CSS removed:**
    - 175 rules for 43 classes that no source uses, plus dead selectors trimmed from 17 more rules. `globals.css` went from 6,600 to 6,152 lines. Every class still in use keeps its styles.
    - The shape toolbar's old beside-the-panel offsets.
    - Phones now keep the full-width element bar; the floating position is for wider screens, covered by a new e2e test.
  - **Assets and infra:**
    - The retired `gesture_recognizer.task`, 8 MB that shipped in every web image. The command contract still forbids loading it.
    - `infra/docker-compose.yml`: Redis, which nothing uses.
    - The retired Meet add-on's `infra/google-meet/pilot-deployment.json`.
  - **Wrong text fixed:**
    - The extension popup said a "3-day trial" that started on the first composite. It now says the one-month pilot starts when the first board opens, which matches the API.
    - README: the trial length, the screen background, the Airo strip and Undo's place.
    - Help 01, 06 and 15: Undo is in the ••• menu, and how to turn Airo on.
    - The migration evidence now lists all 16 migrations.
    - The Chrome Web Store doc's trial length.
    - The voice architecture's "preview and confirm" step; changes apply immediately.
    - The Mumbai move doc is cut to its record plus the read-only switch, with no Seoul-as-current text.
  - **Archived:** 9 superseded docs went to `Docs/archive/` with an index: the July MVP plan and PRD, the add-on designs and spike, the removed modes and the old readiness reviews.
  - **Local:**
    - The merged speed-branch worktree and branch were removed.
    - `.claude/` is now git-ignored.
    - Old build output (`apps/web/.next-production`), a stray root `.next/` and the 0.7.0 extension zip were deleted. About 1.2 GB freed.
  - **Left for decisions:** retiring the Meet add-on code (routes, adapter and SDK, which the test harness still exercises), a status column and separate change log for this backlog, and an Artifact Registry cleanup policy.
  - **Deployed** with `infra/cloud-run/release.sh`: web `airboard-pilot-web-launch-d8446ea` at 100%. The API is unchanged at `launch-87aec6f`; its only changes were an unused type and a dev dependency.
    - **Tagged smoke:** 7 pages returned 200. The hand model and engine load, and `gesture_recognizer.task` returns 404. The bundles keep the strip, dock zoom and camera message and reference only Mumbai. Help 01 shows the new Undo wording.
    - **Production:** the pages and API `/ready` pass, and the new revision logged no errors.
    - **Tags:** the previous serving tag was removed, so only the live revisions keep a tag.
    - **Rollback:** web to `launch-6c4ca43`.
    - **Extension:** the popup fix reaches users only when the extension is repackaged and published.
