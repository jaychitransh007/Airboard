# Release Readiness Backlog

> **Status:** Living register. Each item's Status column is current as of 2026-11-05; the change log at the end records the evidence.
> **Created:** 2026-07-29
> **Source:** 9-dimension code/product audit on branch `codex/production-readiness` (2026-07-28).
> **Relationship to other docs:** This is the engineering gap register that sits *underneath*
> [`Official Launch Readiness.md`](<Official Launch Readiness.md>) (the release ladder + decision gates) and
> [`ops/launch-evidence.json`](../ops/launch-evidence.json) (the fail-closed evidence ledger). Where an item
> is already represented by a launch gate, it is cross-referenced rather than duplicated.

## How to use this file

- Every item has a stable ID (`RGB-NNN`), a tier, an owner, concrete `file:line` evidence, and a status.
- **Status notation:** `Backlog` (recorded, not started) · `Planned` (scheduled) · `In progress` · `Partly done` (date, then what remains) · `Done` (date of the change-log entry with the evidence) · `Won't fix` (with rationale) · `Corrected` (finding overturned on verification).
- **Verification column:** `Verified` = confirmed by reading source during the audit · `Reported` = auditor-reported, not independently re-verified (the audit's automated verify pass was cut short — see [Coverage gaps](#coverage-gaps)).
- Promote an item out of Backlog only when a named owner accepts it. Closing an item requires evidence, same as the launch gates.

## Ground-truth snapshot at time of audit

- `pnpm -r build` ✓ · `pnpm typecheck` ✓ · `pnpm test` = **350/350 unit tests pass** · web build emits 27 static pages.
- `pnpm launch:check` (controlled-pilot) = 4/23; the 19 failures are deploy-time config + external human/legal/ops evidence, **not broken code**.
- The codebase is ready for a **controlled single-instance pilot** (as the docs claim). The items below are what stands between that and an honest **standalone-GA** / **paid-GA**.

---

## Tier 1 — Code/product blockers for an honest standalone-GA

These are fixable in the repo and each would make a public "supported product" claim dishonest or unsafe if left open.

| ID | Title | Status | Owner | Verification | Evidence | Recommendation |
|----|-------|--------|-------|--------------|----------|----------------|
| RGB-001 | **Retention & account/workspace erasure never actually execute** — all lifecycle work rides on `POST /internal/lifecycle/run` but **no scheduler is defined anywhere in the repo** | Done 2026-11-05 | Engineering | Verified | `apps/api/src/controlPlaneRoutes.ts:1483` runs trial-expiry, `processDataRequests` (deletion execution), `expireDiagnostics`, `expireOperationalData`, `purgeExpiredDeletedBoards`; no cron/Cloud Scheduler config in `infra/`, `.github/`, `ops/` | Wire a Cloud Scheduler (or equivalent) job hitting the endpoint with `AIRBOARD_CRON_SECRET`, with a failed-run alert. Ties to launch gate `lifecycle-schedule`. |
| RGB-002 | **No React error boundaries** — any uncaught render error white-screens the whole workspace | Done 2026-11-04 | Engineering | Verified | No `error.tsx` / `global-error.tsx` / `ErrorBoundary` / `componentDidCatch` anywhere in `apps/web` | Add Next.js `app/error.tsx` + `app/global-error.tsx` and a board-level boundary with a recovery affordance. |
| RGB-003 | **No graceful shutdown / SIGTERM handling** in the API | Done 2026-11-05 | Engineering | Verified | No `SIGTERM`/`SIGINT`/`server.close`/drain handler in `apps/api/src` | Handle SIGTERM: stop accepting upgrades, drain WS with a close frame, flush, then exit within the platform grace window. |
| RGB-004 | **No committed deploy / migration-apply / rollback path** | Done 2026-11-05 | Engineering | Verified | `infra/cloud-run/cloudbuild-api.yaml` & `cloudbuild-web.yaml` only `docker build`+push — no `gcloud run deploy`, no `supabase db push`, no rollback | Add scripted deploy + migration-apply + rollback (or document the exact manual runbook steps as scripts). Ties to `deployment-smoke` / `database-migrations` gates. |
| RGB-005 | **Outbound provider calls have no timeout** — a slow provider hangs a request worker | Done 2026-11-05 | Engineering | Verified | Bare `fetch` with no `AbortController`: Resend `controlPlaneRoutes.ts:2021`, Stripe `stripeRequest` `:2132`, Supabase settings `auth.ts:63`. (Deepgram/OpenAI paths already have timeouts.) | Wrap each in an `AbortController` timeout consistent with the intent/transcription paths. |
| RGB-006 | **Accessibility gaps in core non-media flows** | Done 2026-11-05: the `accessibility-audit` launch gate still needs a manual screen-reader pass | Product / Engineering | Verified (spot) / Reported | Modals don't move/trap focus & lack full keyboard dismissal (WCAG 2.4.3/2.1.2); no skip-to-content link (2.4.1); contact-sales status not a live region; dock flyout declares `role=menu`/`menuitem` with no menu keyboard interaction (in the uncommitted dock redesign) | Focus trap + restore on dialogs, skip link on both shells, `aria-live` on form status, implement arrow/Home/End/Esc on the dock menu. Ties to `accessibility-audit` gate. |

---

## Tier 2 — Blocks the scaled thesis & paid-GA

| ID | Title | Status | Owner | Verification | Evidence | Recommendation |
|----|-------|--------|-------|--------------|----------|----------------|
| RGB-007 | **Realtime collaboration broadcast is process-local** — breaks across autoscaled instances | Done 2026-11-05 | Engineering | Verified | `apps/api/src/server.ts:111` `rooms = new Map<>()`; `broadcast()` `:619` only reaches sockets on the same process | Add cross-instance fan-out (Redis/Postgres pub-sub) **or** pin a single instance and document the concurrency ceiling. Only required once the *collaboration* claim goes beyond single-instance. |
| RGB-008 | **Paid entitlement expiry from deprecated Stripe field + silent 24h fallback** | Backlog (paid launch) | Engineering | Verified | `controlPlaneRoutes.ts:2208` reads subscription-level `data.current_period_end` (moved to item level in recent Stripe API versions → null) → `:2246` falls back to `now()+24h`, silently revoking paid access after a day | Read `current_period_end` from `items.data[0]`; remove the silent 24h fallback (fail loud / refuse to write a bogus expiry). Paid-GA only. |
| RGB-009 | **Team seats stored but never enforced** | Backlog (paid launch) | Engineering | Verified (corrected scope) | `seat_quantity` written to `billing_subscriptions` `:2216` but `requireActiveEntitlement` `:1864` is a boolean org-scoped check — seat count is never compared to active members | Decide the seat model; if enforced, count active members against `seat_quantity` at session-start. (NB: an earlier auditor claim that "members get no entitlement" was **false** — see [Corrected findings](#corrected-findings).) Paid-GA only. |
| RGB-010 | **No failed-webhook alerting or Stripe↔Airboard reconciliation** | Backlog (paid launch) | Engineering | Reported | Failed webhooks only log and return 500; no dead-letter/alert/reconcile path | Add failed-webhook alerting and a periodic reconciliation. Ties to paid-GA evidence. Paid-GA only. |

---

## Tier 3 — Hardening & correctness (should-fix before GA, not hard blockers)

### CI / supply chain
| ID | Title | Status | Owner | Verification | Evidence | Recommendation |
|----|-------|--------|-------|--------------|----------|----------------|
| RGB-011 | No linter anywhere (no ESLint config/script/CI step) | Done 2026-11-05 | Engineering | Verified | `.github/workflows/ci.yml`; no ESLint in any `package.json` | Add ESLint + a CI lint gate. |
| RGB-012 | No dependency-vulnerability audit, secret scanning, or dependabot/CodeQL in CI | Done 2026-11-05 | Engineering / Security | Verified | `.github/workflows/ci.yml` | Add `pnpm audit`/OSV, secret scan (e.g. gitleaks), and Dependabot/CodeQL. |
| RGB-013 | Semantic (LLM) voice false-accept path not covered by any CI gate | Done 2026-11-05 | Engineering | Reported | Only deterministic grammar/false-accept evals gate CI | Add an offline semantic false-accept gate (or document the exclusion). |
| RGB-038 | The production intent model acts on meeting talk: `gpt-5.4-mini` changed the board for 8–10 of 60 ambient cases and asked a question for 12–14 | Done and deployed 2026-11-06 (`launch-010a9b7`): prompt 2.12 leaves all 60 alone; the known list is empty | Engineering / Product | Verified | `evals/voice-intent/semantic-negatives.known-false-accepts.v1.json` | Keep tightening the prompt until the known list is empty, without losing real commands. |
| RGB-039 | Airo can't see or change shapes made by typed commands or the toolbar, so it draws duplicates (found 2026-11-07 in the live journey: "the API" became a second API box) | Done and deployed 2026-11-07 (`launch-376f31e`, then `launch-bd5de96`): Airo sees typed and toolbar shapes and can connect, rename, move, line up, spread out, tidy, copy, group and delete them | Engineering | Verified on the live site | `buildSemanticIntentContext`, `resolveSemanticReference` and `spatialSemanticNodes` in `apps/web/src/features/board/intentPipeline.ts` read only legacy annotation strokes; `applyDiagramCommand` in `packages/core/src/diagramCommands.ts` writes only strokes. Typed commands such as "add a user" and the toolbar create v2 scene elements, which none of these read | Grouping Airo's own nodes together with typed shapes still says "not yet", because a section can't own a legacy node. |
| RGB-040 | The built-in typed-command parser treats any sentence that starts with add, create, insert, make or put as "add a shape" and finds a shape name anywhere in it (found 2026-11-07 on the live site: "put the user and the API side by side … and group them as front end" added a Front End shape instead of reaching Airo) | Done and deployed 2026-11-07 (web `launch-460cd8d`): a create accepts at most three describing words before the shape name, none of them a conjunction, pronoun, relation or second verb; anything longer goes to Airo | Engineering | Verified on the live site | `packages/core/src/sceneIntent.ts` (`CREATE` and the `shapeCreate` pattern) | None. |
| RGB-041 | Airo throws away a whole plan when the model asks to spread out only two shapes (found 2026-11-07 on the live site: "put the user and the API side by side, lined up along the top, and group them as front end" twice gave "the intent provider returned an invalid plan", logged as "Expected 3 to 20 object references") | Done and deployed 2026-11-07 (API `launch-637bd84`): the tool schema gives align and layout at least 2 targets and distribute at least 3 (or the selection alone), matching the validator, and prompt 2.13 says two shapes side by side is a layout or an align | Engineering | Verified on the live site | `packages/core/src/semanticPlan.ts`: the JSON schema gives `distribute` the generic reference list (`minItems: 1`), while `validateSemanticPlan` requires 3; `apps/api/src/semanticIntent/openaiResponses.ts` prompt | None. |
| RGB-042 | Airo voice reached only about 4 people at a time, and switched off for good at 30 minutes, on every deploy, on a network drop or when Deepgram closed the stream (found 2026-11-07 in the MLP launch audit) | Done and deployed 2026-11-07 (`launch-306c7a5`) | Engineering | Verified in tests (real voice client against the real API routes) and in production smoke checks; not yet tried with a real microphone | `apps/api/src/config.ts` `maxConcurrentStreams` defaulted to 4 per instance and production never set it; `realtimeSpeech.ts` ended the session on any close; Cloud Run concurrency 80 counted each voice user's two sockets | 50 voice streams per instance (Deepgram allows 150 per project; 3 instances), API concurrency 250, and the browser reconnects on its own with the microphone kept open. Still owed by the founder: confirm the Deepgram key is on the account's main project (secondary self-serve projects get one stream) and set Deepgram and OpenAI spend limits. |
| RGB-043 | A brand-new user who opened Templates before making a board was told "Your pilot access has ended": Templates created boards without starting the free trial (found 2026-11-07 in the MLP launch audit) | Done and deployed 2026-11-07 (web `launch-4ae4227`; founder's decision for minimum scope): Templates removed from the app and the public site | Product / Engineering | Verified in tests | `ProductSection.tsx` Templates posted to `/boards` without `/trial/activate`; `boardTemplates.ts` built the diagram on mount | None. Every new board starts from New Airboard, which starts the trial. |
| RGB-044 | Nothing capped total provider spend: each Google account got its own free daily allowance, so many accounts together could run up the OpenAI and Deepgram bills, and voice streams didn't opt out of Deepgram's model-improvement programme (threat model X-1, V-4) | Done 2026-11-07, not deployed yet | Engineering / Founder | Verified in tests and on a local database | `apps/api/src/dailyUsage.ts` counted only per person; `deepgramFluxProtocol.ts` set no `mip_opt_out` | A service-wide daily ceiling (5,000 Airo model commands, 3,000 voice minutes, tunable) and `mip_opt_out=true` on every Deepgram stream. Still owed by the founder: spend limits in the OpenAI and Deepgram consoles, which need the founder's sign-in. |
| RGB-014 | New `catalogDock` E2E is uncommitted & never run; CI can't show E2E is a required merge check | Done 2026-11-05 | Engineering | Verified | `apps/web/e2e/catalogDock.spec.ts` (uncommitted, +235 lines); Playwright not in the fast verify path | Run it before committing the dock diff; make the E2E job a required check on the release branch. |

### Security hardening (mediums)
| ID | Title | Status | Owner | Verification | Evidence | Recommendation |
|----|-------|--------|-------|--------------|----------|----------------|
| RGB-015 | Non-constant-time `===` compare on operator secrets (apiToken, cron secret, metrics token) | Done 2026-11-05 | Engineering | Reported | `apps/api/src/security.ts:71,75`; `server.ts:211`; `controlPlaneRoutes.ts:1484` — the cron secret guards *destructive* deletion | Use `crypto.timingSafeEqual` on length-normalized buffers, matching the signed-token & Stripe paths. |
| RGB-016 | Transcription WS forwards the raw ~1h Supabase JWT in the `access_token` URL query | Done and deployed 2026-11-07 (`launch-fc7bc79`, two days early at the owner's choice): the API no longer reads a sign-in token from any URL, and the voice evaluation tool trades its token for a ticket | Engineering | Reported (partly tracked) | `apps/api/src/auth.ts:84`; `apps/web/src/features/board/realtimeSpeech.ts:242` — vs board `/ws` which uses a 30-min purpose-scoped signed ticket | Issue a short-lived `purpose='transcription'` signed ticket; ensure ingress/log-sink redaction covers `access_token`. |
| RGB-017 | Loopback gate uses substring match on attacker-controlled Host header | Done 2026-11-05 | Engineering | Verified | `controlPlaneRoutes.ts:2407-2410` `.includes(host)`; only reachable when `localEntitlements` (not in prod) — defense-in-depth only | Exact equality/allowlist against `request.ip`. |
| RGB-018 | `'*'` allowed-origin honored by WS/intent/voice helpers but not the REST CORS layer | Done 2026-11-05 | Engineering | Verified | `transcription/routes.ts:372`, `semanticIntent/routes.ts:191`, `voiceTrace/routes.ts:145` short-circuit `true` on `*`; `server.ts:137` (@fastify/cors) does not | Pick one policy; drop the `*` special-case or document it as unsupported in prod. |

### Backend robustness (mediums/lows)
| ID | Title | Status | Owner | Verification | Evidence | Recommendation |
|----|-------|--------|-------|--------------|----------|----------------|
| RGB-019 | Provider concurrency caps & rate limits are per-process (multiply by instance count) | Done and deployed 2026-11-07 (`launch-bd5de96`, migration `20261107120000`): per-minute limits are counted in Postgres (`consume_rate_limit`), so they hold across instances; stream caps stay per instance | Engineering | Verified in production | Per-process maps for rate limiter / concurrency | None for the pilot. |
| RGB-020 | Boot does not fail-fast on missing Supabase config; `/ready` returns 200 when DB unconfigured | Done 2026-11-05 | Engineering | Reported | `apps/api/src` config/boot path | Fail-fast in production on required env; make `/ready` reflect DB reachability. |
| RGB-021 | Board WS has no per-connection event rate limit, no batch-size cap, no explicit `maxPayload` | Done 2026-11-05 | Engineering | Reported | `server.ts` WS handler | Add per-connection event rate limit + payload/batch caps. |
| RGB-022 | No retry / circuit-breaking for OpenAI intent or Deepgram; an outage burns concurrency slots on timeouts | Done 2026-11-05 | Engineering | Reported | intent/transcription paths | Add bounded retry + circuit breaker. |
| RGB-023 | No process-level `unhandledRejection`/`uncaughtException` handler | Done 2026-11-05 | Engineering | Verified | `apps/api/src` | Add handlers that log and exit cleanly (paired with RGB-003). |
| RGB-024 | No connection-level rate limiting on WS upgrades or on `/state` & `/heartbeat` | Done 2026-11-05 | Engineering | Verified | `server.ts:322,343,363`; `transcription/routes.ts:30` | Per-IP connection/attempt limiter + modest limiter on `/state`,`/heartbeat`. |

### Data / DB correctness
| ID | Title | Status | Owner | Verification | Evidence | Recommendation |
|----|-------|--------|-------|--------------|----------|----------------|
| RGB-025 | Account deletion is not atomic and has no retry — a mid-flight failure leaves a half-erased account | Done 2026-11-05 | Engineering | Reported | `processDataRequests` sequence in `controlPlaneRoutes.ts` (no transaction) | Wrap in a transaction / make each step idempotent + resumable. |
| RGB-026 | No index on `product_events.profile_id` or `audit_events.actor_profile_id` | Done 2026-11-05 | Engineering | Reported | export/erasure full-scans the two highest-volume tables | Add indexes in a migration. |
| RGB-027 | `delete_workspace` erases the whole org; account deletion orphans non-default personal orgs | Done 2026-11-05 | Engineering | Reported | `supabase/migrations` account-operations | Verify & correct the deletion/ownership graph. |
| RGB-028 | Migrations not cleanly re-runnable (create policy / add constraint / drop function lack guards) | Done 2026-11-07: every migration is safe to run twice; the guard check covers all files and more statement kinds | Engineering | Verified on a local Supabase stack | `supabase/migrations/*` | Keep new migrations re-runnable; the guard check enforces it. |
| RGB-029 | `board_shares` (hashed share tokens) is schema-only; no code creates or resolves share links | Done and deployed 2026-11-06 (`launch-7fa8ff1`) | Engineering / Product | Verified | migration defines table; no producer/consumer in code | Wire share-link flow or drop the table; ensure no UI advertises sharing that doesn't work. |

### Packaging / images
| ID | Title | Status | Owner | Verification | Evidence | Recommendation |
|----|-------|--------|-------|--------------|----------|----------------|
| RGB-030 | API runtime image copies full `node_modules` (esbuild, tsx, typescript, @types) | Done 2026-11-05 | Engineering | Reported | `infra/cloud-run/api.Dockerfile` | Ship production-only deps. |
| RGB-031 | Docker base images use floating tags (not digest-pinned) and declare no `HEALTHCHECK` | Done 2026-11-05 | Engineering | Verified | `infra/cloud-run/*.Dockerfile` | Digest-pin bases; add `HEALTHCHECK` (or rely on platform probes explicitly). |
| RGB-032 | Desktop app has no packaging, signing, notarization, or auto-update tooling | Tooling done 2026-11-07: electron-builder packages macOS dmg/zip and a Windows installer, signing and notarization run from CI secrets, and electron-updater updates installed apps from GitHub Releases; nothing signed or released yet | Engineering | Unsigned macOS build and smoke run verified locally; Windows untested | `apps/desktop/package.json` (electron devDep only) | The owner adds the Apple Developer ID and Windows signing secrets (see `apps/desktop/README.md`), then a `desktop-v*` tag builds the first signed draft release. |
| RGB-033 | Chrome extension packaging not run in CI; manifest hardcodes pilot Cloud Run URLs | Done 2026-11-07: the packager stamps the chosen release target's addresses (`targets.json`, `AIRBOARD_EXTENSION_TARGET`), and CI keeps each package as an artifact | Engineering | Verified locally (pilot package byte-identical) | `extensions/chrome-meet-bridge/manifest.json`; `scripts/package-chrome-extension.mjs` not in CI | For a production domain, add a target and set the API's allowed origins and the web build's extension ID to match. |

### Docs drift / honesty
| ID | Title | Status | Owner | Verification | Evidence | Recommendation |
|----|-------|--------|-------|--------------|----------|----------------|
| RGB-034 | `Platform Support Matrix.md` still describes the retired Meet add-on architecture, not the shipped 0.8.0 camera overlay | Done 2026-07-30 | Product | Corrected 2026-07-30 | `Docs/Platform Support Matrix.md` and `extensions/chrome-meet-bridge` | Current channel and release limits now match the private camera-overlay extension. |
| RGB-035 | `Intent Canvas Implementation Notes.md` still documents a removed Preview→Apply confirmation step (contradicts README + code) | Done 2026-07-30 | Product | Corrected 2026-07-30 | `Docs/Intent Canvas Implementation Notes.md` | Current workflow now documents immediate, undoable command application. |
| RGB-036 | README understates voice-trace storage as "in-memory only" — durable, org-scoped, 14-day storage is implemented | Done 2026-07-30 | Product | Corrected 2026-07-30 | `README.md`, `voice_trace_events` schema, and lifecycle purge | README now distinguishes durable authenticated storage from the local in-memory fallback. |
| RGB-037 | Two conflicting readiness sources of truth | Done 2026-07-30 | Founder / Product | Corrected 2026-07-30 | `Public Beta Readiness…`, `Official Launch Readiness.md`, and `ops/launch-evidence.json` | Historical checklist is explicitly superseded; official readiness remains the current authority. |

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
- **2026-11-05** — Dependency updates, image retention and docs.
  - **Dependabot:**
    - **#2 to #5 (GitHub Actions):** `actions/checkout`, `actions/setup-node` and `actions/upload-artifact` to v7, and `pnpm/action-setup` to v5. Dependabot changed only the `uses:` lines, and CI passed on each PR.
    - **#6 (12 minor and patch updates):** Fastify plugins, Supabase JS 2.118, React 19.3, Playwright 1.64, esbuild, `ws` and types. Its `tsx` bump no longer applied.
    - **#7 (MediaPipe 1.2):** `@mediapipe/tasks-vision` resolved to 1.2.2. `/vendor/mediapipe/wasm` was re-copied from the package so the served engine matches the JavaScript (14.6 MB).
      - With a fake camera, the 1.2 engine and the unchanged `hand_landmarker.task` load, the tracker starts, and per-frame gesture traces run with no errors.
      - The recorded-hand replay test is skipped in this repo (no fixture), so real-hand detection still needs one manual check after the next web deploy.
    - **#8 (React Hooks lint 7):** lint is clean. The config still enables only `rules-of-hooks` and `exhaustive-deps`.
    - **#9 (Electron 45.2.1):** the desktop typecheck and its 5 tests pass. The full audit still shows only the known moderate.
    - **#10 (`@types/node` 26):** declined. Production runs Node 22 (both Docker images), and Node 26 types break the web build (`setTimeout` returns `number | Timeout`). `.github/dependabot.yml` now ignores major `@types/node` updates, which move with the runtime.
  - **Artifact Registry cleanup policy** on `airboard-pilot`:
    - Keep images tagged `live`, and keep the 10 newest per image.
    - Delete anything older than 3 days.
    - The serving images are tagged `live`, and `release.sh promote` moves that tag to the image it promotes.
    - Before the policy the repository held 32 API and 74 web versions, 3.1 GB in all (layers are shared).
  - **Docs:**
    - The touchpad notes now say the board opens in Intent Canvas, and they no longer list the removed modes.
    - The eight help pages still dated July were re-checked against the code:
      - 02: what happens when voice is unavailable.
      - 03: the first-board steps, the pilot start, where User and Service shapes are, and Undo.
      - 10: the popup's six readiness checks, the button names and how to disconnect.
      - 13: team workspaces only, suspend instead of remove, the actual policy list, SAML metadata, the installation fields and the audit retention.
      - 14: uploaded images and videos.
      - 04, 11 and 17 were accurate.
    - The remaining "Start Airo" hints and the Airo panel's Undo hint in the app now say "Turn Airo on" and "••• menu". The Meet and desktop surfaces keep their real Start Airo button.
    - This backlog's tables have a Status column for every item.
  - **Merged:** jaychitransh007/Airboard#18 (merge `2b611e0`). Dependabot #2–#5 and #7–#9 and the regenerated #17 were closed as included; #10 was closed as declined.
  - **Deployed:** API `airboard-pilot-api-launch-3e17071` at 100%, which matches `main` exactly. The web stays at `launch-d8446ea`.
    - **Tagged smoke:** Mumbai settings and secret kept, read-only off, max 3. `/ready` passes for the database and `boardFanOut` on Supabase JS 2.118 and the updated Fastify plugins. Session start, board list and a forged token got 401. `/auth/config` lists Google. No errors.
    - **Production:** `/ready` passes and the new revision logged no errors.
    - **Tags:** the `live` image tag moved to `api:launch-3e17071`. The previous serving tag was removed.
    - **Rollback:** API to `launch-87aec6f`.
  - **Web deployed:** `airboard-pilot-web-launch-3e17071` at 100%, the same build as the API, so both match `main`.
    - **Tagged smoke:** 7 pages returned 200. The MediaPipe 1.2 engine (14.6 MB) and the hand model are served, and the retired gesture model returns 404. The bundles carry the "Turn Airo on" hints and the menu Undo hint, with no "Press Start Airo" left. Help 03 and 10 show the corrected text. The bundles reference only Mumbai.
    - **Production:** the pages and API `/ready` pass, and the new revision logged no errors.
    - **Tags:** the `live` image tag moved to `web:launch-3e17071`. Only the serving revisions keep a tag.
    - **Rollback:** web to `launch-d8446ea`.
    - **Owner check:** wave a hand at a board once to confirm MediaPipe 1.2 detects real hands; no automated test covers that.
- **2026-11-05** — Security, robustness, data and image items from Tier 3 (commit `854858a` on `codex/production-readiness`):
  - **Security:**
    - RGB-015: the API token, cron secret and metrics token are compared in constant time (`secretsMatch` in `security.ts` hashes both sides, then uses `timingSafeEqual`).
    - RGB-016: the app swaps its sign-in token for a one-minute `transcription` ticket (`POST /transcription/ticket`) and opens the voice socket with that, so the sign-in token no longer goes in a URL. The server still accepts `access_token` for one release; `scripts/lib/audio-stt-eval/adapters.mjs` uses it too. Remove both next release.
    - RGB-017: the development sign-in trusts only a loopback socket address, never the Host header.
    - RGB-018: production refuses to start with a `*` allowed origin, and the WS, intent and voice-trace routes share one exact-match `originAllowed`.
  - **Robustness:**
    - RGB-020: production refuses to start without `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`; `/ready` without a database answers 503 outside local development.
    - RGB-021: board sockets cap messages at 1 MB, batches at 500 events and each connection at 5,000 events per 10 seconds (`AIRBOARD_RATE_LIMIT_BOARD_EVENTS_PER_10_SECONDS`).
    - RGB-022: a circuit breaker on the OpenAI intent provider and on opening Deepgram streams. After 3 outages in a row it answers "unavailable" at once for 30 seconds, then lets one trial through. Bad requests and bad model output do not count. No automatic retries: they would double the wait on a voice command, and the app already falls back to its built-in grammar.
    - RGB-023: `unhandledRejection` and `uncaughtException` log at fatal and run the graceful shutdown with exit code 1.
    - RGB-024: per-caller limits on board socket connections (120/min), `/state` and `/heartbeat` reads (300/min) and voice socket connections (60/min).
  - **Data:**
    - RGB-025: deletion cannot be one transaction (it spans the database, Storage and Supabase Auth), so every step is now checked and safe to repeat. A failed request goes back on the queue for the next hourly run and is marked failed after 5 attempts (new `data_requests.attempts`). A request left `processing` for 30 minutes is picked up again, and overlapping runs cannot both claim one. A retry that finds the auth user already gone carries on. Exports fail and retry instead of completing with a missing section.
    - RGB-026: `product_events_profile_idx` and `audit_events_actor_profile_idx` in `supabase/migrations/20261105150000_data_request_erasure.sql`, applied to local Supabase. Applied to production before the API deployed (see below).
    - RGB-027: account deletion erases every personal workspace the account is the last active member of, not only the one the request came from. Shared and team workspaces stay. Workspace deletion now needs the owner role (was owner or admin), checked again when it runs after the seven-day window. Open: a team whose only owner deletes their account keeps its members but has no owner.
    - RGB-028: `scripts/test/migration-guards.test.mjs` fails `pnpm test:scripts` when a migration from `20261105150000` on is unsafe to run twice. The 30 unguarded statements in older migrations stay as written: those versions are recorded as applied and never run again.
  - **Images:**
    - RGB-030: the API image installs production dependencies only (`pnpm deploy --prod`), and esbuild moved to devDependencies. Local arm64 build: 526 MB → 419 MB, and `node_modules` holds only the bundle's externals plus Supabase JS (54 MB). The image starts, answers `/health` and loads sharp (libvips 8.18.7), heic-convert, Fastify and ws.
    - RGB-031: both images pin `node:22-bookworm-slim` by digest, and Dependabot now proposes digest updates (Node majors ignored). Cloud Run ignores Docker `HEALTHCHECK`, so `release.sh stage` sets HTTP startup and liveness probes (API `/health`, web `/favicon.ico`).
- **2026-11-05** — `854858a` deployed to the pilot:
  - **Migration:** `20261105150000_data_request_erasure.sql` applied to Mumbai first. The production REST API sees `data_requests.attempts`.
  - **API:** `airboard-pilot-api-launch-854858a` at 100%, with the startup and liveness probes on `/health`.
    - **Tagged smoke:** `/ready` passes for the database and `boardFanOut`. A ticket request, session start, intent, `/metrics` and the lifecycle endpoint all return 401 without credentials, as does a forged sign-in token. Voice sockets with a forged or missing ticket close with 1008. The ticket endpoint's CORS preflight allows the web origin only. The revision logged no errors.
  - **Web:** `airboard-pilot-web-launch-854858a` at 100%, with probes on `/favicon.ico`.
    - **Tagged smoke:** 7 pages returned 200. The bundle exchanges the sign-in token for a ticket at `/transcription/ticket` and puts only `ticket` in the voice socket URL. It references only Mumbai.
  - **Tags:** the `live` image tags moved to `launch-854858a`, and the `launch-3e17071` Cloud Run tags were removed.
  - **Rollback:** both services to `launch-3e17071`. Its API does not read `attempts`, so the migration needs no rollback.
  - **Lifecycle:** the 14:00 UTC scheduled run, the first on the new erasure code, returned 200 and logged no errors.
  - **Launch check:** `pnpm launch:check:deployed` still passes 19 of 23. The blockers are unchanged: lifecycle email, release owner, support path and the commercial smoke.
  - **Owner check:** turn Airo on once in production. It is the first signed-in use of the voice ticket, which no automated test covers against production.
  - **Merged:** jaychitransh007/Airboard#21 (merge `49bf2c4`).
- **2026-11-05** — CI gates (on `codex/production-readiness`):
  - **RGB-013:** the AI fallback's false accepts now run in every PR and release eval (`semantic-ambient-negative-replay`). `evals/voice-intent/semantic-negatives.recorded.v1.json` holds one live `gpt-5.4-mini` answer for each of the 60 meeting-talk cases, recorded once for a few cents. The replay sends each answer back through the API's fan-in rule, the production OpenAI provider's request and output checks, the browser's plan parser and the production command pipeline, with no API calls. A case must stay quiet unless the reviewed known list names it with the same outcome; a listed case that improves must leave the list. Each answer stores a hash of the exact request, so a prompt, tool, model or request change fails until someone re-records. `evals/README.md` has the commands.
  - **New, RGB-038:** the recording showed the production model changes the board for 8 of the 60 cases (for example "so the user hits the payment API which writes to the ledger" adds two connectors), acts without changing it for 2, asks a question for 14 and gives the wrong reason for 1. Those 25 are the known list. The code's default model, `gpt-5.6-terra`, changed the board for 3. Production still sets `gpt-5.4-mini`.
  - **Secret scan:** it had failed on `main` since `6e81f44`, because gitleaks read the image tag `api:launch-3e17071` in a deploy record as a key. `.gitleaks.toml` now allows `api:`/`web:` release tags only. All history scans clean, and a fake key next to a tag is still caught.
  - **RGB-014:** `main` is now protected. A pull request merges only when "Typecheck, tests, safety evals", "Playwright E2E (interaction layer)" and "Secret scan" pass, each bound to GitHub Actions so no other app can report it. The rule applies to admins too, and force-pushes and deleting `main` are blocked. Branches need not be up to date with `main` first. #23 showed `BLOCKED` while its checks ran.
  - **Dependabot #19 (closed):** took `@types/node` 22.20.5. Declined its `@mediapipe/tasks-vision` change, which was a downgrade from 1.2.2 to 1.2.0 and would mismatch the vendored WASM. A new `@types/ws>@types/node` override keeps `@types/ws` on the Node 22 types instead of the Node 24 copy Electron brings.
- **2026-11-05** — The intent model is now `gpt-5.6-luna` alone (on `codex/production-readiness`):
  - **Why:** measured on the same day, one attempt per case.

    | Model | 38 real commands right | 60 chatter lines that change the board | Asks a question about chatter | Typical response | Slowest 5% |
    | --- | --- | --- | --- | --- | --- |
    | `gpt-5.4-mini` (production until now) | 26 | 8–10 | 12–14 | 1.6–1.7 s | 3.1–3.2 s |
    | `gpt-5.6-luna` | 34 (after the fix below) | 1–3 | 20–24 | 1.9–2.1 s | 2.7–3.5 s |
    | `gpt-5.6-terra` | not run | 1–3 | 13 | 1.6–1.7 s | 2.3–2.4 s |

    The product owner chose Luna. Terra was faster on the same prompt (OpenAI processing p50 1.18 s against Luna's 1.46 s, with the same answer length).
  - **Only model:** the default allowlist is now `gpt-5.6-luna` alone, so the in-app Intent model picker has nothing else to switch to.
  - **Contract fix:** a lone `current_selection` reference now satisfies align (2+), distribute (3+) and layout (2+). The corpus expects that form, but the parser rejected it, so neither model could pass those cases: Luna's plans were refused outright. The board still checks the selection size when it runs the step. Both the API and the browser parse plans with this code, so both need the release.
  - **Chatter replay:** re-recorded with Luna. It changes the board for 1 case ("make a note that we owe legal a response by Friday"), asks a question for 20, gives the wrong reason for 7, has 2 answers rejected and stays quiet for 30. The known list now holds those 30.
  - **Latency:** neither model meets the eval's 2.5 s end-to-action p95 gate: Luna 3.5 s, Mini 3.1 s on the real-command run.
- **2026-11-05** — `launch-05c0281` deployed to the pilot (commit `05c0281`):
  - **API:** `airboard-pilot-api-launch-05c0281` at 100%, deployed with `AIRBOARD_INTENT_MODEL=gpt-5.6-luna` and `AIRBOARD_INTENT_ALLOWED_MODELS=gpt-5.6-luna`. Production `/intent/config` reports Luna as the only model, `/ready` passes and intent without sign-in returns 401. The revision logged no errors.
  - **Web:** `airboard-pilot-web-launch-05c0281` at 100%, so the browser also accepts a lone `current_selection`. Six paths returned 200, and the bundle references only Mumbai.
  - **Tags:** the `live` image tags moved to `launch-05c0281`, and the `launch-854858a` Cloud Run tags were removed.
  - **Rollback:** both services to `launch-854858a`. That API revision keeps its own settings, so rolling back also restores `gpt-5.4-mini`.
  - **Not verified in production:** a signed-in voice command through Luna (needs a real sign-in). The same code and model passed 34 of 38 real commands locally.
  - **Local setup:** `.env` must name an allowed model, so a local `AIRBOARD_INTENT_MODEL=gpt-5.6-terra` now stops the API from starting; the repository's `.env` was moved to Luna.
- **2026-11-05** — Intent prompt 2.9: Luna leaves meeting talk alone (commit `fe9f36b`):
  - **What changed:** the prompt used to say every transcript was captured "only after diagram-command mode was activated", gave one example of non-board speech, and told the model to ask whenever a detail was missing. It now tells the model that people keep talking to each other while Airo listens, and asks it to decide first whether the speech is meant for the board. That holds when it addresses Airo, uses editing language on objects that are on the board, or states a new relationship between objects named by their visible labels. Editing verbs on things that are not on the board (tickets, invites, branches, slides), generic type words in conversation, reports and suggestions, descriptions of how a system works, and figures of speech ("make a note that…") are `not_board_command`. Questions are only for clear board commands, and a request about another document is `not_board_command` rather than `unsupported_operation`. Answers to Airo's own question skip the test.
  - **Result with Luna, against the 2.8 baseline:**

    | | 2.8 | 2.9 |
    | --- | --- | --- |
    | Meeting talk left alone (of 60) | 30 | 53–55 |
    | Meeting talk that changes the board | 1–3 | 0 |
    | Meeting talk that gets a question | 20 | 3–4 |
    | Real commands right (of 38) | 35 | 33–35 |

    Real-command misses stayed within the 2.8 range. The two dialogue cases ("…with yes and", then "No.") passed 8 of 10 runs each way.
  - **CI:** the replay is re-recorded with prompt 2.9, and the known list shrank from 30 to 5: 3 questions about system talk or a document, and 2 requests about another document reported as `unsupported_operation`.
  - **Deployed:** API `airboard-pilot-api-launch-fe9f36b` at 100% (image digest checked against the `launch-fe9f36b` tag). It keeps Luna as the only model, `/ready` passes, intent without sign-in returns 401 and the revision logged no errors. The web stays on `launch-05c0281`; the prompt lives only in the API. Rollback: the API to `launch-05c0281`.
- **2026-11-05** — Luna answers faster: intent prompt 2.10 on OpenAI's priority tier (commit `db35e58`):
  - **Where the time went:** each request sends about 7,600 input tokens, about 98% already cached by OpenAI, and returns 70 output tokens typically (about 250 for multi-shape plans). On the 38 real commands, OpenAI's own processing was 1.5–1.6 s typically and 2.3–3.7 s for the slowest 5%, and about 0.7 s more went to the network and queuing. A cold cache added about 0.7 s to the slowest requests.
  - **What changed:** the request asks for OpenAI's `priority` tier (new `AIRBOARD_INTENT_SERVICE_TIER`, default `priority`; `default` or `auto` turns it off), a fixed `prompt_cache_key`, and 24-hour prompt cache retention so sparse pilot traffic keeps the prefix cached.
  - **Result, direct to OpenAI on the 38 real commands:** typical 2.2 s → 1.7 s, slowest 5% 4.0 s → 2.4 s. Through the API end to end: typical 1.7 s, slowest 5% 2.6 s, against 2.0 s and 3.3–3.8 s before. The eval target is 2.5 s.
  - **Prompt 2.10:** the priority tier answered two dialogue cases differently: the answer "No." to "What label should the branch to User Two have?" completed the branch in 1 of 10 runs, and the cut-off "…with yes and" was labelled `incomplete_request`. Two general rules fixed both, 8 of 8 each: a one-word answer to a missing-label question is the label, and speech cut off while giving one slot names that slot.
  - **Accuracy:** 34 of 38 real commands. The misses are earlier kinds: a question instead of deleting a duplicate, "lay out" instead of "distribute", a question with a different code for a missing object, and one grid layout that named the four selected services instead of "the current selection" (same board result; 6 of 6 correct on a rerun). Meeting talk: 53–55 of 60 left alone, 3–5 questions, no board changes. The replay's known list is rebuilt from the new recording: 7 cases, none that change the board.
  - **Deployed:** API `airboard-pilot-api-launch-db35e58` at 100%; the running image digest matches the `launch-db35e58` tag. Luna stays the only model, `/ready` passes, intent without sign-in returns 401 and the revision logged no errors. The web stays on `launch-05c0281`. Rollback: the API to `launch-fe9f36b`.
  - **Cost:** the priority tier bills tokens at a higher rate than the standard tier. Each AI-interpreted command is about 7,600 mostly cached input tokens and 70 output tokens, and only commands the built-in grammar cannot parse reach the model.
- **2026-11-05** — Intent prompt 2.11: "space evenly" distributes (commit `e8e1644`):
  - **Problem:** "Airo space the selected services evenly from left to right" failed in nearly every run. Luna returned a left-to-right layout instead of distribute, so the shapes were rearranged rather than evenly spaced. The prompt never said how the two differ.
  - **Rule:** even spacing ("space evenly", "equal gaps", "spread out evenly") is distribute on the matching axis, even when a direction is named; layout only rearranges objects into a row, column, or grid.
  - **Result:** distribute 8 of 8 runs; grid layout and align stayed 5 of 5. Real commands 36 of 38, the best so far; both misses are questions with a different issue code than the corpus expects. Meeting talk: 53 of 60 left alone, no board changes. The replay is re-recorded with its known list rebuilt (7 cases: 4 questions, 2 wrong reasons, 1 rejected answer).
  - **Latency varies by run:** this run's slowest 5% end to end was 3.1 s, against 2.6 s on the previous run with the same settings.
  - **Deployed:** API `airboard-pilot-api-launch-e8e1644` at 100%; the running image digest matches the `launch-e8e1644` tag. Luna stays the only model, `/ready` passes, intent without sign-in returns 401 and the revision logged no errors. The web stays on `launch-05c0281`. Rollback: the API to `launch-db35e58`.
- **2026-11-05** — Release script migrations and the remaining accessibility gaps (commits `b40f09e` and `47e7eb5`):
  - **RGB-004:** `infra/cloud-run/release.sh migrate` lists the migration files the pilot database has not applied and runs `supabase db push --yes`, then checks nothing is left. `release.sh stage api` refuses while any are pending and names them (`AIRBOARD_SKIP_MIGRATION_CHECK=1` overrides it when the database cannot be reached). Both refuse when the Supabase CLI is linked to another project. Checked against the pilot database with read-only dry runs: nothing pending, then a temporary migration file that blocked `stage api` and that `migrate` would apply. Migrations are not rolled back, so each must keep working with the API it replaces.
  - **RGB-006, announced form results:** 12 result and error lines (contact sales, sign-in, invites, integrations, settings, support, admin and billing) now use a shared `FormStatus`: a `role="status"` line, or `role="alert"` for errors, that stays mounted while empty. A live region added together with its text is often not announced. Empty ones are taken out of the layout.
  - **RGB-006, automated WCAG 2.2 AA pass:** `@axe-core/playwright` 4.14.0 checked 13 public pages, the board, the Share dialog, the board menu and the shape popover. It found:
    - logo links and the zoom button whose accessible names did not contain their visible text (2.5.3);
    - help-page captions at 3.45–4.19:1 contrast, the landing illustration's labels at 3.51:1, and the help support button at 4.04:1 (1.4.3);
    - a board-menu item pointing `aria-controls` at the settings panel while the panel was not rendered.

    All are fixed: the logo links take their visible names, the zoom button reads "100%, reset canvas zoom", the captions use `#685d7a` (5.0–6.1:1), the illustration labels use 0.78 opacity (5.8:1 or more), the help button uses the brand lavender, and the menu item names the panel only while it is open. `apps/web/e2e/accessibility.spec.ts` now fails on any violation on those pages and states, and checks that the contact form's live region exists before submitting and announces the result.
  - **Still open for the `accessibility-audit` gate (owner Product):** a manual pass with a screen reader and with reduced motion. axe checks markup and contrast, not how a screen reader reads the board.
  - **Found on staging:** the cookie banner, shown to every first-time visitor, is translucent, so its muted "Learn more" link fell to 3.85:1 over the support page; local tests had passed it over lighter content. Its text now uses `#4a524a` (5.2:1 or more). Two test paths were 404 pages; the test now audits `/use-cases/product-teams` and `/help/getting-started/your-first-board`.
  - **Deployed:** web `airboard-pilot-web-launch-47e7eb5` at 100%. Before promoting, axe ran against the staged revision with the cookie banner showing: 13 pages including signed-out `/app/boards`, all 200 with zero WCAG 2.2 AA violations, and the contact-sales status region present before submitting. The API stays on `launch-e8e1644`; `release.sh migrate` in dry-run mode confirmed the pilot database has every migration. Rollback: the web to `launch-05c0281`.
- **2026-11-05** — The controlled pilot needs no email (product owner's decision; on `codex/production-readiness`, not yet deployed):
  - **Decision:** people sign in with Google, so no sending domain or Resend account is needed now, and no lifecycle campaigns are sent.
  - **Launch check:** `lifecycle-email` is now required only from the standalone-GA stage on. `pnpm launch:check:deployed` passes 19 of 22 for the pilot; the blockers are release owner, support path and the commercial smoke.
  - **Queued email:** trial reminders and invitations were still queued with nowhere to go, and would all have gone out the day an email provider was added, including weeks-old "6 hours left" reminders. The hourly lifecycle run now cancels any queued email more than a day overdue (`NOT_SENT_IN_TIME`), and the 30-day retention removes it.
  - **Sign-in is Google-only in production:** email sign-in links are offered only where `AIRBOARD_EMAIL_SIGN_IN_ENABLED=true`. The setting defaults to off in production and on in local development, where the local mailer captures every message. The API's `/auth/config` reports it, and the sign-in page reads its options from there, falling back to Supabase's settings. Supabase's built-in mailer reaches only the Supabase organization's own members, so the link would never arrive for anyone else.
  - **Invite links:** creating an invitation now returns its link to the inviting admin. The members page shows it with a "Copy invite link" button, once, because the API keeps only a hash of the token. The invitee still has to sign in as the invited address to accept. The invitation email is still queued and lapses after a day without a provider.
- **2026-11-05** — Release and support owners recorded; `launch-e9912d6` deployed (commits `acccc81` and `e9912d6`):
  - **Owners:** the founder confirmed they are the controlled pilot's release owner on both the business and technical side, and its support owner. The support inbox is `hellosigmascience@gmail.com`, already the address every support, status, accessibility and pilot page and sign-in message publishes. `ops/launch-evidence.json` marks `release-owner` and `support-path` verified. `pnpm launch:check:deployed` passes 21 of 22; only `commercial-smoke` remains.
  - **API:** `airboard-pilot-api-launch-e9912d6` at 100%. Staging passed the new migration check (none pending). `/auth/config` reports `emailMagicLink: false`, invitations without sign-in return 401, Luna stays the only model, the image digest matches the tag and the revision logged no errors.
  - **Web:** `airboard-pilot-web-launch-e9912d6` at 100%. On staging, 6 pages returned 200 with no WCAG violations. A tagged revision's origin is not on the API's allow-list, so its sign-in page falls back to Supabase's settings and still showed email there. In production, `/login` and `/signup` show one "Continue with Google" button, no email field and the line "Continue with your Google account."
  - **Not checked in production:** creating an invitation and copying its link, which needs a signed-in admin.
  - **Rollback:** the web to `launch-47e7eb5` and the API to `launch-e8e1644`.
- **2026-11-05** — The controlled pilot passes every launch gate:
  - **Decision:** the founder moved `commercial-smoke` to the standalone-GA stage. The gate runs `pnpm smoke:commercial` against a disposable organization on the release database, which needs an account there.
  - **Result:** `pnpm launch:check:deployed` reports READY, 21 of 21, for the controlled pilot.
  - **Still owed outside the gates:** a manual screen-reader and reduced-motion pass (the `accessibility-audit` gate belongs to standalone GA), and a signed-in check of the invite-link flow.
- **2026-11-06** — No alerts to the support inbox (founder's decision):
  - **Decision:** `hellosigmascience@gmail.com` carries customer help and support mail only, so no outage, error or latency alerts are set up.
  - **Removed:** the earlier Cloud Monitoring policy "Airboard lifecycle run failed" is deleted; the project has no alert policies. Its email notification channel remains unused. The log-based metric `airboard_lifecycle_failed_runs` still counts failed runs.
  - **Launch gate:** the controlled-pilot `lifecycle-schedule` gate now asks for a scheduled, authenticated job whose failed runs are logged. Alerting on them belongs to the standalone-GA `monitoring-alerts` gate. Checked: the job is enabled, and the 16:00, 17:00 and 18:00 UTC runs on 2026-11-05 returned 200. `pnpm launch:check:deployed` still reports READY, 21 of 21.
- **2026-11-06** — RGB-029: view-only share links (on `codex/production-readiness`; deployed as `launch-7fa8ff1`, see below):
  - **API (`apps/api/src/boardShareRoutes.ts`):** the board's owner lists, creates and turns off links at `/boards/:id/share-links`.
    - Links last 7 days by default, or 30 days, or until turned off; a board holds at most 20 live links.
    - Each token is 32 random bytes; only its SHA-256 hash is stored in `board_shares`, so a link is shown once. Creating and turning off a link are audited.
    - `GET /shared-boards/:token` opens the saved board without an account, rate-limited to 120 requests a minute per caller and sent with `no-store` and `noindex`. It strips live-session participants (their names), cursors and half-drawn strokes. Expired, turned-off, unknown and deleted boards all answer 404.
    - Pictures load through `/shared-boards/:token/assets/:id/content` and only for that board. No migration was needed: the table already existed.
  - **Viewer (`/s/<token>`):**
    - It renders the board with the production renderer: drag to move, scroll or the buttons to zoom, **Fit** to frame everything.
    - The words on the board are listed for screen readers. The page is not indexed and sends no referrer.
    - A link that no longer works says so.
  - **Share dialog:** a new "Anyone with the link can view" section lets the owner pick how long the link lasts, create it, copy it once, and turn off any active link. Other members are told only the board's creator can make links.
  - **Tests:**
    - API: create, list, revoke, only the owner, hashes only, participant names stripped, expiry, Trash, unknown tokens, the asset boundary and the 20-link cap.
    - Unit: state, fit bounds and picture routing.
    - Browser, against a board built by the production diagram commands: the canvas paints, the screen-reader text, no editing controls, the turned-off message and zero WCAG 2.2 AA violations.
    - The dialog section is not covered by a browser test, because the test harness has no saved board.
  - **Help:** "Boards, versions, and export" describes view-only links.
- **2026-11-06** — Deployed `launch-7fa8ff1` (view-only share links) to both services:
  - **Order:** API first, then the web. No migration was pending.
  - **Staged API checks:**
    - `/ready` reported the database and `boardFanOut` ready.
    - An unknown well-formed link answered 404 `SHARE_LINK_UNAVAILABLE`, with `no-store`, `noindex` and `no-referrer`. A malformed link and an unknown link's picture also answered 404.
    - Listing or creating links without signing in answered 401.
  - **Staged web checks:** `/`, `/login`, `/signup`, `/app`, the help page and `/s/<token>` answered 200, and the share page carries `noindex` and `no-referrer`.
  - **After promoting:** on the canonical URL, `/s/<unknown token>` reaches the API and shows "This link no longer works".
  - **Tags:** the `launch-e9912d6` tags were removed; only the serving revisions keep one.
  - **Rollback:** both services to `launch-e9912d6`.
  - **Not yet checked in production:** creating, opening and turning off a real link from a signed-in board.
- **2026-11-06** — RGB-038: Airo leaves meeting talk alone (intent prompt 2.12; deployed as `launch-010a9b7`, see below):
  - **Problem:** with prompt 2.11, Luna answered 7 of the 60 meeting-talk cases although nobody spoke to Airo. Four got a question ("the service talks to the database through the queue", "there is a queue between the API and the workers", "the arrow in that diagram points the wrong way I think", "insert a slide about churn after the revenue one"). Two got "can't do that" ("can you make the font bigger in the doc you're sharing", "make it black and white for the printout"). One restated the board and came back as an empty plan the API rejected. None changed the board.
  - **Prompt changes (`apps/api/src/semanticIntent/openaiResponses.ts`):** these sit in the "is this for the board?" test, not in the planning rules. The planning rules were tried first and made real commands ask more often.
    - Speech that restates the board is not_board_command, never an empty plan.
    - A comment or opinion about a diagram or arrow is discussion; Airo doesn't ask which arrow.
    - A statement that doesn't address Airo is a command only when every object it names is an exact visible label and the relationship is new; it never gets a question.
    - A request about fonts, colours, zoom, printing or someone's shared screen, made without addressing Airo or naming the board, is for a person (not_board_command, not "can't do that").
    - Two steadying rules for real commands:
      - "Under my cursor", "where I'm pointing" and "to my pointer" mean the pointer when it is available. Without this, the new rules made "move the selected database under my cursor" ask about 1 time in 5.
      - A cancel or undo is exactly that one action, even while a question is pending. Without this, "Never mind, cancel that" sometimes repeated the question.
    - New examples cover a folder, a slide, a statement about an API on the board, and a request about someone's screen or printout. None repeats a test phrase.
  - **Measured with Luna on the priority tier (final wording):**
    - All 60 meeting cases three times: 180 of 180 quiet, from 54 of 60. "Make it black and white for the printout" was the last to settle: 20 of 20 in a separate run, but it slipped once in about 40 tries across drafts.
    - Real commands three times: 109 of 114, with semantic p95 2,457 ms. The only failures also fail on 2.11: "Airo remove Cache" and "Airo delete Payments API", expected to ask a different question.
    - The truncated "yes and…" branch now passes 5 of 5 (2.11: about 3 in 5).
    - Commands I ran 10 times on each version, with no regression: pointer, 21 circles, align, distribute, grid, reverse, delete, the ambiguous-connector question, cancel and undo.
    - Earlier drafts were rejected because they made "Airo add 21 circles", "place the order before the discount expires" or "add the document to the shared drive" worse.
  - **Test fix:** the brand-narrative case accepts "lands on" and "lands to" for "the user lands to the Airboard page", as its sister case already does. The new prompt picks "lands on" where 2.11 picked "redirects"; the diagram is otherwise identical.
  - **Gate:** the replay is re-recorded (60 quiet) and the known list is empty, so any meeting case that stops being quiet now fails CI. The gate's own test no longer assumes the list has an entry.
- **2026-11-06** — Deployed `launch-010a9b7` (intent prompt 2.12) to the API only:
  - **Unchanged:** the web stays on `launch-7fa8ff1`, and no migration was pending.
  - **Staged checks:** `/ready` reported the database and `boardFanOut` ready. `/intent/config` lists only `gpt-5.6-luna`. An unauthenticated intent request is refused, and share links still answer.
  - **After promoting:** production `/ready` is ready, and `pnpm launch:check:deployed` reports READY, 21 of 21.
  - **Tags:** the `launch-7fa8ff1-api` tag was removed.
  - **Rollback:** the API to `launch-7fa8ff1`.
  - **Not yet checked in production:** a spoken command in a live meeting, which needs a signed-in board.
- **2026-11-06** — The two real voice commands that always failed were test mistakes; all 38 now pass:
  - **"Airo remove Cache"** on a board with a Cache service and a Cache database:
    - Airo correctly asks which Cache and deletes nothing.
    - The test numbered the Cache database as database 2. Production and the test tool both number boxes in reading order, which makes it database 1, so the check looked for a box that doesn't exist.
  - **"Airo delete Payments API"** on a board with only an Orders API:
    - Airo asks "I can't find Payments API. Did you mean Orders API?" and deletes nothing.
    - The model files this as `ambiguous_reference` about 2 times in 3 and `missing_context` otherwise. The app shows Airo's own question either way, so the difference isn't visible.
    - A case may now list `issueCodeAlternatives`; `scripts/eval-voice-intent.mjs` checks the field and rejects unknown codes. This case accepts both codes and keeps `missing_context` as its main code for coverage.
  - **Test boards now match what production sends:** seven cases listed boxes out of reading order, and five of them numbered boxes out of reading order too. Every board in `evals/voice-intent/v1.json` now lists and numbers its boxes, and its selection, as `intentPipeline.ts` does.
  - **Measured with Luna:**
    - Every changed case passed 5 of 5, and the grid case 10 of 10.
    - The full set passed 76 of 76 runs (38 cases, twice).
    - The speed check failed on that run, at a p95 of 2,615 ms against 2,500 ms. It has ranged from 2.0 to 3.2 s across today's runs with no code change, and it is not a CI gate.
- **2026-11-06** — Browser tests for the signed-in app (not yet deployed; one web fix):
  - **Before:** no browser test signed in, so the board library, saving, the Share dialog's view-only links and Admin's invite link were checked only by unit tests or by hand.
  - **Harness (`apps/web/e2e/support/signedInApi.ts`):**
    - The page signs in for real through the E2E API's loopback development identity. Its account and live sessions also come from the real API.
    - The routes that need a database are answered inside the browser with the response shapes of `controlPlaneRoutes.ts` and `boardShareRoutes.ts`: the board list, board load and save, share links, the shared-board viewer, members and invitations. The API's own tests cover those routes' server side.
    - It models version conflicts, link expiry, the 20-link cap and owner-only link management.
  - **Tests (`apps/web/e2e/signedInApp.spec.ts`, 8):**
    - The library opens a saved board with its content.
    - An edit is saved as the next version.
    - A save that loses to another tab shows "Keep my version", and keeping it saves version 3.
    - The owner makes a 30-day link, copies it (checked against the clipboard), opens it as a viewer and turns it off; the viewer then shows "no longer works".
    - The 20-link limit message appears.
    - A teammate's board says only its creator can make links.
    - An admin invites a teammate and copies the invite link.
    - Axe WCAG 2.2 AA passes on the library, the Share dialog and Admin members.
  - **Checked that they catch breakage:** letting anyone make links, and sending the wrong save version, each made the relevant tests fail.
  - **Fix found by the new accessibility test:** the role pickers on Admin › Members had no accessible name ("Invite as", and "Role for <name>" on each member), and the email field relied on its placeholder. All three now have labels.
  - **Result:** 85 browser tests pass, and the 8 new ones passed 24 of 24 across three repeats.
- **2026-11-06** — Deployed `launch-2f31bf2` to the web only (Admin › Members role pickers and email field labelled):
  - **Unchanged:** the API stays on `launch-010a9b7`.
  - **Staged checks:** `/`, `/login`, `/signup`, `/app`, `/app/boards`, `/app/admin/members`, `/s/<token>` and `/help` answered 200. The staged JavaScript contained the new "Invite as" label, and the live one didn't yet.
  - **After promoting:** the live JavaScript has the label. On the canonical URL, `/s/<unknown token>` reaches the API and shows "This link no longer works". `pnpm launch:check:deployed` reports READY, 21 of 21.
  - **Tags:** the `launch-7fa8ff1-web` tag was removed.
  - **Rollback:** the web to `launch-7fa8ff1`.
- **2026-11-06** — The two High risks from the draft threat model: provider spend (X-1) and live-board connection flooding (L-4). Deployed as `launch-09f196e`; see the deploy entry below:
  - **Daily allowances per person (`apps/api/src/dailyUsage.ts`):**
    - The allowances are 500 Airo commands that reach the model (`AIRBOARD_DAILY_AIRO_COMMANDS`) and 240 voice minutes (`AIRBOARD_DAILY_VOICE_MINUTES`) per person per UTC day.
    - They are counted in Postgres (`daily_usage`, through `consume_daily_usage`), so they hold across API instances. The function adds usage only when the total stays within the limit, in one statement. Against Postgres 17, 20 concurrent charges at a limit of 10 left exactly 10.
    - Built-in commands are free. Voice is paid ahead in 15-second blocks, and a stream stops with `DAILY_VOICE_LIMIT` when the minutes run out; Airo answers `DAILY_AIRO_LIMIT`. The browser and the help's error codes explain both.
    - If the count itself fails, the request goes through and a warning is logged. Per-minute limits and provider spend caps still apply.
    - The allowance is per person rather than per workspace, so a team isn't capped by its busiest member. Throwaway accounts are limited the same way either way.
  - **Live-board connection caps (`apps/api/src/server.ts`):**
    - Each instance allows 3 open board sockets per participant, 30 per address and 50 per board (`AIRBOARD_BOARD_SOCKETS_PER_*`).
    - A refused socket closes with 1013 `BOARD_CONNECTION_LIMIT`, and the client retries with backoff. Before this, one caller could fill all 240 request slots (80 per instance × 3) for up to an hour each.
  - **Cursor moves are no longer stored:** they are relayed live, to this instance's sockets and through the cross-instance fan-out, without a sequence number. Board changes are stored and numbered as before. This removes several database writes a second per person drawing.
  - **Still open from the threat model:**
    - Hard monthly spend limits in the OpenAI and Deepgram dashboards (founder).
    - How trials are granted at public launch (founder).
    - A retention period for `board_events`. That is a data-retention decision, not made here.
  - **Tests:**
    - The three socket caps, each one refusing on its own.
    - Cursor moves reaching another participant without being stored.
    - Airo's allowance checked before the model is called, with a failed count letting the command through.
    - Voice stopping mid-stream when the minutes run out, with mocked 15-second timers.
    - The config defaults.
    - The migration was run twice on Postgres 17 and passed its guard check.
    - All checks and 89 browser tests pass.
- **2026-11-06** — Deployed `launch-09f196e` to both services. It carries the daily allowances, the socket caps and cursor moves no longer stored, the incident status page, the browser matrix setting and help, and the Airo limit message:
  - **Order:**
    - Applied migration `20261106120000_daily_usage.sql` with `release.sh migrate`; afterwards the database had every migration in the repository.
    - Staged and promoted the API, then staged and promoted the web.
  - **Staged API checks:**
    - `/ready` reported the database and `boardFanOut` ready, and `/intent/config` lists only Luna.
    - Unauthenticated Airo and share-link calls answered 401, and an unknown share link 404.
    - The only warnings in the revision's logs were those test requests.
  - **Staged web checks:** `/`, `/status`, `/login`, `/app`, `/app/boards`, two help pages and `/s/<token>` answered 200. The new status page, the `DAILY_AIRO_LIMIT` message and the supported-browsers help were in the staged build.
  - **After promoting:**
    - The live `/status` shows Website, Boards and Airo, and Saved boards as Working, and "No incidents in the last 90 days", read from GitHub.
    - `pnpm launch:check:deployed` reports READY, 21 of 21.
    - The old tags `launch-010a9b7-api` and `launch-2f31bf2-web` were removed.
  - **Rollback:** the web to `launch-2f31bf2` and the API to `launch-010a9b7`. The old API ignores the new table.
  - **Not yet checked in production:**
    - A signed-in command hitting the allowance.
    - A voice stream being charged.
- **2026-11-06** — Fixed the eight medium-risk gaps from the threat model (committed as `19ddecb`):
  - **Viewer and Billing are read-only:** the API refuses their board create, save, trash, restore, upload, asset delete, share-link and live-session start (`BOARD_READ_ONLY_ROLE`); the web opens boards for them view-only.
  - **Admin switches enforced:** External guests on live joins and view-only links; Voice on voice tickets; camera, gestures and exports in the browser. `/me` now returns the policy.
  - **Session history:** migration `20261106150000` keeps board-less sessions to their owner and deletes a board's sessions when it is purged.
  - **Security headers:** per-request nonce CSP, framing refused except the Meet overlay engine, nosniff, Referrer-Policy, Permissions-Policy, HSTS (`Docs/Security Headers.md`).
  - **Photos:** every image is re-encoded without metadata.
  - **Share links:** stop when their maker leaves, is suspended or loses the editing role; admins list and turn off every link.
  - **Uploads:** 2 GiB per workspace (migration `20261106160000`), 30 starts a minute per person, hourly sweep of abandoned uploads, HEIC sized before decoding.
  - **Live links:** 2 hours instead of 6, and kept out of the address bar.
  - **Still open:** guests view-only by default and a "New link" button for live links; a 90-day cap for "until turned off" view-only links.
- **2026-11-06** — Deployed `launch-19ddecb` to both services, closing the eight medium-risk gaps:
  - **Order:**
    - Applied migrations `20261106150000_session_history_access.sql` and `20261106160000_board_asset_quota.sql` with `release.sh migrate`. Both had been run twice on local Postgres 17, and the database then had every migration in the repository.
    - Staged and promoted the API, then staged and promoted the web.
  - **Staged API checks:**
    - `/ready` reported the database, transcription, the intent model and `boardFanOut` ready.
    - Without a sign-in, `/me`, the admin link list and turn-off, board create, save, share and upload, voice tickets and session start answered 401. Joining with a bad link answered 401, an unknown share link 404, and Airo without an allowed origin 403.
    - The only warnings in the revision's logs were those test requests.
  - **Staged web checks:**
    - `/`, `/login`, `/status`, `/help`, `/pilot/privacy`, `/s/<token>`, `/meet/overlay-engine` and `/app/boards` answered 200.
    - The security headers were right for normal pages, the share page and the overlay engine, with the production API and Supabase addresses allowed.
    - In a browser, the pages started up under the new script rules: every script carried that load's key, and nothing was refused.
    - The view-only board, the admin link list, the members-only join message and the upload limit messages were in the build.
  - **After promoting:**
    - The live `/status` shows Website, Boards and Airo, and Saved boards as Working.
    - The sign-in page loads with no console errors.
    - Neither new revision logged an error.
    - `pnpm launch:check:deployed` reports READY, 21 of 21.
    - The old tags `launch-09f196e-api` and `launch-09f196e-web` were removed.
  - **Rollback:** both services to `launch-09f196e`, which works with both new migrations.
  - **Not yet checked in production with a signed-in account:**
    - A Viewer's view-only board.
    - The admin switches.
    - The admin link list.
    - Photo cleaning.
    - Upload limits.
- **2026-11-06** — Live-link controls, the accessibility audit and RGB-016 (committed as `91d1c63`; RGB-016 held on its own branch):
  - **Live links** (threat model L-2):
    - On saved boards, people who join with the live link can only view by default. The owner picks **Can view** or **Can edit** in Share, and people already in follow at once.
    - **New link** stops older links letting anyone new in (migration `20261106170000`); people already in stay.
    - After a reload, the owner rejoins their session as its owner, not as a guest, and keeps the same link.
  - **Accessibility audit** (`Docs/Accessibility Audit.md`):
    - 17 failures fixed across the public site, the app, the board's chrome and the live and shared boards.
    - The board now tells a screen reader which object Tab selects and lists the board's words.
    - Locked in by `e2e/accessibilityAudit.spec.ts` and `test/accessibilityStyles.test.mjs`.
    - Still open:
      - no real screen-reader pass;
      - drawing needs a pointer;
      - the selection toolbar sits early in the Tab order.
  - **RGB-016:** done on branch `codex/remove-legacy-access-token`, held until after 8 November.
- **2026-11-06** — Deployed `launch-91d1c63` to both services (live-link controls and the accessibility fixes):
  - **Order:**
    - Applied migration `20261106170000_live_link_reset.sql`; the database then had every migration in the repository.
    - Staged and promoted the API, then the web.
  - **Staged API checks:**
    - `/ready` reported every dependency ready.
    - Without a sign-in, the new `/sessions/:id/resume` and `/sessions/:id/join-link` answered 401, along with every other signed-in route.
    - No errors in its logs.
  - **Staged web checks:**
    - Every main page answered 200 with the security headers and its own page title.
    - The live-link choice, New link, the replaced-link message, the view-only live board and the board's screen-reader text were in the build.
    - In a browser, pages started with no blocked scripts or start-up errors.
  - **After promoting:**
    - The live `/status` shows all three Working.
    - Neither new revision logged an error.
    - `pnpm launch:check:deployed` reports READY, 21 of 21.
    - The tags `launch-19ddecb-api` and `launch-19ddecb-web` were removed.
  - **Rollback:** both services to `launch-19ddecb`, which ignores the new column.
  - **Not yet checked in production with a signed-in account:**
    - The Can view / Can edit switch.
    - New link.
    - The owner rejoining after a reload.
- **2026-11-07** — RGB-016 deployed, and the live sign-up journey:
  - **RGB-016:** the branch was merged and the API promoted as `launch-fc7bc79`; the web stays on `launch-91d1c63`.
    - The staged API was healthy and refused requests without a sign-in, including `/me?access_token=…`.
    - No errors were logged.
    - The tag `launch-91d1c63-api` was removed.
    - Rollback: the API to `launch-91d1c63`.
  - **Live journey**, run in the browser on the live site in the owner's signed-in account, on one test board that is now in Trash (recoverable):
    - **Board:** created a board; added shapes and a connector by typed commands; ran a free-form Airo command (the AI model and the daily allowance path) and it applied; renamed the board; a reload kept the content.
    - **Live links:** Share defaults to Can view, with no live link in the address bar. A guest saw the view-only live board, switched to the editor on Can edit and back on Can view without reloading. New link made the old link answer "This live link was replaced", while the guest already in stayed. After a reload the owner kept the owner controls.
    - **View-only link:** opened read-only, then stopped working once turned off.
    - **Library:** search by board content worked; Move to Trash and Restore worked.
    - **Settings:** Sessions listed the sessions and ended one.
    - **Other pages:** Billing showed the pilot until 5 December, and Privacy & data loaded.
    - **Clipboard:** the browser blocked copying, and Share's fallback showed the link to copy by hand.
  - **Defect found and fixed (`abc3725`, deployed the same day):** the Airo command's result reached the live session but was never saved, so the saved board and its view-only link lacked it. Commands applied as one batch (Airo plans and compound typed commands) and undoing them never scheduled a save. They do now, and a browser test that stands in for the Airo model fails without the fix.
- **2026-11-07** — Deployed the save fix to the web as `launch-abc3725`; the API stays on `launch-fc7bc79`:
  - **Staged checks:** every main page answered 200 with the security headers.
  - **After promoting:**
    - On the live site, a free-form Airo command ("a little cache that the API reads from") applied, and a fresh tab showed it saved.
    - Neither revision logged an error.
    - The launch check reports READY, 21 of 21.
    - The tag `launch-91d1c63-web` was removed.
  - **Rollback:** the web to `launch-91d1c63`.
  - **Second defect from the journey, fixed in `c2aa572` (deployed in `launch-8eff5db`):** ending a session in Settings didn't stick while the owner had the board open. The owner's 30-second heartbeat set it back to active, so the live link kept letting people in. A heartbeat now leaves an ended session alone; tests cover both session stores.
  - **Cleanup:** the test board is in Trash, and its three test sessions are ended. The owner's older session from 5 November was left alone.
- **2026-11-07** — Deployed `launch-8eff5db` to both services: the ended-session fix (API) and the 320px card fix (web, which had failed PR #43's CI on Linux fonts):
  - **Staged API checks:**
    - Every dependency was ready, and every signed-in route refused requests without a sign-in, the same as the live API.
    - Malformed JSON is answered with 500 rather than 400 on the live API too. That's an existing quirk, noted as a follow-up.
  - **Staged web checks:**
    - Every main page answered 200 with the security headers.
    - The new card styles were in the stylesheet.
  - **After promoting:**
    - On the live site, a session ended in Settings stayed ended 45 seconds later, with the owner's board tab still open.
    - No errors were logged after the malformed test requests.
    - The launch check reports READY, 21 of 21.
    - The tags `launch-fc7bc79-api` and `launch-abc3725-web` were removed.
  - **Cleanup:** the test board is back in Trash and its sessions are ended.
- **2026-11-07** — Malformed JSON request bodies now get 400 `INVALID_JSON_BODY` instead of 500 (not deployed yet). Opened RGB-039: Airo is blind to shapes made by typed commands or the toolbar, so it can duplicate them.
- **2026-11-07** — RGB-039, Airo uses the shapes already on the board (not deployed yet):
  - **What Airo sees:** its board summary now lists shapes, stickies, text and mind-map nodes added from the toolbar or by typed commands, and the connectors between them (`semanticBoardObjects.ts`). Names, ordinals, "this one" and placement next to a shape all reach them, and automatic placement keeps new nodes off them.
  - **What Airo can change:** connect, branch, rename, move, delete, reverse a connection and remove a connection now work on those shapes through new scene commands in `packages/core/src/sceneDiagramCommands.ts`, with undo. A connector can join one of Airo's own nodes to a typed shape. Connectors follow when either end moves, and go when either end is deleted.
  - **Not yet:** align, distribute, layout, duplicate and group on typed or toolbar shapes return "Airo can't … yet. Select them and use the toolbar." instead of guessing.
  - **Staleness check:** the selection Airo plans against now includes selected typed shapes, so selecting one no longer reads as "the board changed".
  - **Tests:** core 70, web 419, API 197, scripts 189 and the other packages pass; lint and typecheck are clean. The new browser test `airoSceneObjects.spec.ts` replays the live journey: one API, connected to the new database, and saved. The full browser suite passed 170 of 171 under load; the one miss (Help Center search) passes alone. The PR evals pass, including the meeting-talk replay. The voice-intent eval against Luna passed 38 of 38 twice; p95 was 2.9 s the first time (over the 2.5 s gate) and 2.5 s the second, which is the model's response time.
- **2026-11-07** — Deployed `launch-376f31e` to both services (the Airo fix for RGB-039 and the 400 for malformed JSON):
  - **Checks before traffic:**
    - No migrations were pending.
    - The staged API reported ready, answered malformed JSON with 400 `INVALID_JSON_BODY`, and refused unauthenticated calls and a token in the query with 401.
    - The staged web served its pages with the security headers and the new Airo help section.
  - **After promotion:**
    - The launch check reports READY, 21 of 21.
    - The live API answers malformed JSON with 400.
    - The new revisions logged no errors.
    - The tags `launch-8eff5db-api` and `launch-8eff5db-web` were removed.
  - **Live journey:** in the owner's signed-in account, a new board got "add a user" and "add an API next to the user", then "could you sketch a little database that the API talks to". Luna added one Database and a "talks to" connector from the existing API; there was still one API. A reload showed the same board, so it saved. The test board is in Trash.
  - **Rollback:** both services to `launch-8eff5db`.
- **2026-11-07** — Five engineering items (not deployed yet):
  - **Airo arranges, copies and groups typed shapes (RGB-039):**
    - Align, distribute and layout move shapes from typed commands and the toolbar alongside Airo's own nodes, and v2 connectors follow.
    - `scene.duplicate` copies them as the toolbar does, and `scene.group` draws a section around them.
    - Grouping Airo's nodes together with typed shapes still says "not yet".
    - Typed shapes Airo changed stay selected for a follow-up.
  - **Shared per-minute limits (RGB-019):**
    - Migration `20261107120000_shared_rate_limits` adds `rate_limit_windows` and `consume_rate_limit` (service role only).
    - The API counts each per-minute limit there after its own local check, so three instances allow the limit, not three times it.
    - Keys are keyed hashes (HMAC with the session signing secret). The hourly lifecycle job deletes windows older than an hour, and a database error lets the request through.
    - Each limited request makes one database call. The migration must reach production before the API.
  - **Re-runnable migrations (RGB-028):** every migration now has guards. Re-applying all 21 on a local Supabase stack gave no errors, and the schema and data dumps were unchanged. The guard check covers every file and more statement kinds.
  - **Chrome extension targets (RGB-033):**
    - `targets.json` and `AIRBOARD_EXTENSION_TARGET` (or explicit address overrides) set the addresses the packager stamps in.
    - The pilot package is byte-identical to before.
    - CI keeps the zip, checksum and permission review as an artifact.
  - **Desktop packaging (RGB-032):**
    - electron-builder 26.18.0 and electron-updater 6.8.11.
    - `.github/workflows/desktop.yml` builds on macOS and Windows on a `desktop-v*` tag or by hand, signing only when the secrets exist.
    - The overlay now grants the camera, microphone and clipboard only to the Airboard origin.
    - An unsigned macOS package built and passed its smoke run locally.
  - **Tests:**
    - Unit: API 203, web 422, core 73, desktop 19, scripts 196. Lint, typecheck, docs and the production audit are clean.
    - The full browser suite: 171 passed, 2 skipped.
    - The offline PR evals pass.
    - The live voice-intent eval against Luna scored 36 and 37 of 38 on two runs, a different case each time, with the model returning no actions. Nothing the model sees changed, so this is model variance (38 of 38 twice earlier the same day).
- **2026-11-07** — Deployed `launch-bd5de96` to both services, after applying migration `20261107120000_shared_rate_limits` to Mumbai:
  - **Migration:**
    - Only that file was pending.
    - Afterwards, row-level security is on, and only `service_role` can execute `consume_rate_limit` or read `rate_limit_windows`; `anon` and `authenticated` can do neither.
  - **First build failed:** the web image build failed because the desktop help article cited `apps/desktop/README.md`, which the web image doesn't copy, and the help generator checks every cited file exists. Fixed in `bd5de96` by citing only `apps/desktop/src` files.
  - **Staged API:**
    - It reported ready, answered malformed JSON with 400 and refused unauthenticated calls with 401.
    - Three unknown share-link requests showed up in production as one `shared_board` window with 3 hits, stored as a 64-character hash.
    - It logged no counting warnings.
  - **Staged web:** pages served with the security headers and the new help text.
  - **After promotion:** the launch check reports READY, 21 of 21, and the new revisions logged no errors. The tags `launch-376f31e-api` and `launch-376f31e-web` were removed.
  - **Live journey:** in the owner's signed-in account, "add a user" and "add an API below the user", then "could you line the user and the API up side by side and group them as front end".
    - Luna applied two actions: User and API side by side in a section titled "front end". The two shapes stayed selected, and a reload showed the same board.
    - A first wording starting with "put …" was caught by the typed-command parser instead, which added a Front End shape (undone; logged as RGB-040).
    - The test board is in Trash.
  - **Rollback:** both services to `launch-376f31e`.
- **2026-11-07** — RGB-040 fixed (not deployed yet):
  - **What changed:** the typed-command parser in `packages/core/src/sceneIntent.ts` treats "add/create/insert/make/put … <shape>" as a create only when at most three describing words come before the shape name ("a payment service", "the Orders queue"), none of them a conjunction, pronoun, relation or second verb. The live sentence that added a Front End shape now goes to Airo.
  - **How I checked:**
    - Every corpus and test phrase the parser accepted as a create was listed first; all of them use at most one describing word.
    - New regression cases in `packages/core/test/sceneIntent.test.mjs` cover the live sentence and the short forms that must still work.
  - **Tests:**
    - Unit suites all pass, including core 74.
    - The grammar contract passes 223 of 223, and the meeting-talk false-accept check finds 0.
    - All 21 offline PR evals pass, and 17 browser tests for typed commands, the catalog and Airo pass.
- **2026-11-07** — Deployed the RGB-040 fix: the web serves `launch-460cd8d`, and the API stays on `launch-bd5de96`, because the API doesn't use the typed-command parser.
  - **Checks:** no migrations were pending, the staged web served its pages with the security headers, and after promotion the launch check reports READY, 21 of 21, with no errors. The `launch-bd5de96-web` tag was removed.
  - **Live check:** on a new board with "add a user" and "add an API below the user", the sentence that had added a Front End shape no longer adds any shape and goes to Airo.
  - **New finding (RGB-041):** Airo then answered "the intent provider returned an invalid plan" twice, and the board was left unchanged. The API log shows the model asked to distribute two objects; the schema allows that, but the validator requires three and rejects the whole plan. The other wording ("could you line … up side by side and group them as front end") works.
  - **Cleanup:** the test board is in Trash.
- **2026-11-07** — RGB-041 fixed (not deployed yet):
  - **Plan schema:** `referenceArraySchemaWithMinimum` in `packages/core/src/semanticPlan.ts` gives align and layout targets at least 2 references, and distribute at least 3. The selection alone still counts, as the validator allows. The model can no longer write a step the validator refuses, which used to discard the whole plan. A new test keeps the schema and the validator in step for these three actions.
  - **Prompt 2.13:** distribute needs three or more objects. Two objects "side by side", "next to each other", "in a row" or "lined up" is a layout (left to right, or top to bottom when stacked) or an align.
  - **Evidence against Luna (local API):**
    - The live sentence ("put the user and the API side by side, lined up along the top, and group them as front end") gave a valid plan 3 times out of 3: layout and group, twice with an extra move. OpenAI accepted the new schema.
    - The voice-intent eval passed 39 of 39, including the new case `two-shapes-side-by-side` (a layout that leaves the shapes' tops lined up), with p95 at 2.2 s and every gate passing.
    - The 60 meeting-talk answers were re-recorded under 2.13: all 60 quiet, known list empty, and the replay gate passes.
  - **Tests:** unit suites all pass (core 75, API 203, web 422), along with 196 script tests, the 21 offline PR evals, and lint and typecheck.
- **2026-11-07** — Deployed the RGB-041 fix: the API serves `launch-637bd84` (prompt 2.13); the web stays on `launch-460cd8d`.
  - **Checks:** no migrations were pending. The staged API reported ready, answered malformed JSON with 400, and refused unauthenticated calls with 401.
  - **After promotion:** the launch check reports READY, 21 of 21, and the new revision logged no errors. The `launch-bd5de96-api` tag was removed.
  - **Live journey:** on a new board, "add a user" and "add an API below the user", then "put the user and the API side by side, lined up along the top, and group them as front end".
    - It failed twice before this fix. Now Luna applied three actions: the API and User side by side with their tops lined up, in a section titled "front end".
    - A reload showed the same board. The test board is in Trash.
- **2026-11-07** — Deployed `launch-63a10b8` to both services, so production matches `main` after PR #45 (merge `db6630a`). The web had been one shared-package change behind: the plan schema minimums from RGB-041.
  - **Checks:** no migrations were pending. Both staged revisions passed the smoke checks: API ready, 400 for malformed JSON, 401 without a sign-in, web pages 200 with security headers.
  - **After promotion:** the launch check reports READY, 21 of 21, and both revisions logged no errors. The signed-in board library loads. The tags `launch-637bd84-api` and `launch-460cd8d-web` were removed.
  - **Rollback:** the API to `launch-637bd84` and the web to `launch-460cd8d`.
  - **Project Status:** rewritten to match, including what is left for an open and a paid launch.
- **2026-11-07** — RGB-042 fixed (not deployed yet): Airo voice reaches 50 people per API instance and comes back on its own.
  - **Found in the MLP launch audit:**
    - Production used the default of 4 voice streams per instance, so the fifth person anywhere got "at capacity".
    - Voice ended for good at the 30-minute stream limit, on every deploy (the API closes sockets with 1012), on a network drop or when Deepgram closed or reset the stream. Getting it back took two clicks of the Airo button.
  - **Server:**
    - `AIRBOARD_TRANSCRIPTION_MAX_CONCURRENT_STREAMS` now defaults to 50. Deepgram allows 150 live streams per project on Pay As You Go (Flux included), and the API runs at most 3 instances.
    - `release.sh stage api` deploys with Cloud Run concurrency 250 (was 80). Each voice user holds a board socket and a voice socket, so at 80 an instance filled at about 40 voice users and blocked typed commands with it.
    - A local load test of the real routes relaying to a stand-in for Deepgram: 50 streams used about 5–8% of one core and 155 MB; 100 streams about 8–14% and 150 MB.
    - The time-limit message now says a new stream opens automatically.
  - **Browser (`realtimeSpeech.ts`, `reconnect` option):**
    - A dropped stream is replaced with a fresh ticket from the latest sign-in token while the microphone stays open. This covers a deploy, a network drop, Deepgram closing or resetting the stream, a busy server (capacity, provider breaker, rate limit) and a sign-in token that expired during a long sleep.
    - Waits grow from 1 to 30 seconds, each spread between half and all of the step so clients dropped together don't return together, over 7 attempts that outlast the API's 30-second provider breaker. A stream that stayed up 30 seconds starts a fresh run, so a stream that keeps dropping gives up instead of paying for a new provider stream every second.
    - At the 30-minute limit, voice rolls over at once if anyone spoke in the last 20 minutes; otherwise it pauses, so a forgotten tab stops streaming. An open palm, or **⏻**, which reads "Resume voice" while hands stay on, wakes it. Refusals no new stream can fix (daily allowance, admin switch, ended access, blocked microphone) still end voice and never restart it on a palm.
    - The Meet overlay keeps its own retry loop.
  - **Help:** the error-code table and the Airo voice article describe the rollover, the pause and the new codes.
  - **Review:** three independent reviewers, each finding challenged by a verifier. Six findings held up and were fixed: Deepgram errors mid-stream, an expired token during a reconnect, the power button restarting voice instead of turning it off, palm restarts after a final refusal, a first-run hint lost after a busy start, and reconnect waits in lockstep. Known limit: background talk near a forgotten tab counts as speech, so such a tab keeps streaming until the daily allowance runs out.
  - **Tests:**
    - New voice client tests: drop and reconnect, rollover and pause, busy retries and give-up, final refusals, stopping mid-reconnect, flapping, provider errors and expired sign-in, spread waits.
    - New API tests: the default of 50, and a time-limited stream freeing its slot for the same person's replacement.
    - A contract test runs the real browser voice client against the real API routes through a rollover and a simulated deploy.
- **2026-11-07** — Deployed RGB-042: both services serve `launch-306c7a5`.
  - **Checks:**
    - No migrations were pending.
    - The staged API reported ready, with boardFanOut ready and transcription on. It refused signed-out calls with 401 and malformed JSON with 400.
    - The staged revision runs with concurrency 250, max 3 instances, and no override of the voice stream limit, so the new default of 50 applies.
    - The staged web served its pages with the security headers, and its bundle carries the reconnect code and the "Resume Airo voice" label.
  - **Promotion:** web first, so the reconnecting client was live before the API changed; then the API.
  - **After promotion:**
    - The launch check reports READY, 21 of 21, and the new revisions logged no errors or 5xx responses.
    - The `launch-63a10b8-api` and `launch-63a10b8-web` tags were removed.
  - **Not yet checked live:** a real voice session, because voice needs a real microphone and a signed-in person. That stays part of the real-device test in the launch list.
  - **Rollback:** both services to `launch-63a10b8`. API concurrency stays at 250 unless it is set back to 80.
- **2026-11-07** — Templates removed for minimum scope, at the founder's request (RGB-043):
  - **Removed:** the Templates sidebar and phone-menu item, the `/app/templates` page, the public `/templates` page, the "Starter templates" changelog entry, the `?template=` board link and the code that built a template on a new board (`boardTemplates.ts` and its test).
  - **Effect:** a new board always starts empty from New Airboard, which starts the free trial. The MLP audit's dead end, where a new user who opened Templates first was told their pilot had ended, can no longer happen. Old Templates links now show the existing "page not found" screens.
  - **Kept:** typed commands, Airo and the first-board guide, which are how a new user builds a diagram.
- **2026-11-07** — Deployed RGB-043: the web serves `launch-4ae4227`; the API stays on `launch-306c7a5`, because it didn't change.
  - **Checks:**
    - The staged web served its pages with the security headers, and `/templates` returned 404.
    - The changelog no longer mentions templates.
    - Its bundle has no template code and still carries the RGB-042 voice fix.
    - The full browser suite passed (170, 2 skipped by design) after the phone More-menu test was updated.
  - **After promotion:**
    - The launch check reports READY, 21 of 21, and the new revision logged no errors.
    - The owner's signed-in sidebar shows Overview, Boards, Integrations and Activity.
    - The `launch-306c7a5-web` tag was removed.
  - **Rollback:** the web to `launch-306c7a5`.
- **2026-11-07** — RGB-044 (not deployed yet): a ceiling on total provider spend, and voice audio opted out of Deepgram's model training.
  - **Service-wide daily ceiling:**
    - Migration `20261107150000_service_daily_usage` adds `service_daily_usage` and `consume_daily_usage_with_service_limit`.
    - In one transaction, the function charges the person's allowance and the service's daily total together, both or neither. A person refused for their own allowance never counts against the service. A person refused for the service gets their own charge back.
    - The defaults are 5,000 Airo model commands and 3,000 voice minutes a day for everyone together (`AIRBOARD_SERVICE_DAILY_AIRO_COMMANDS`, `AIRBOARD_SERVICE_DAILY_VOICE_MINUTES`). 3,000 minutes is about US$23 a day at Deepgram's Flux rate of US$0.0077 a minute.
    - Past the ceiling, Airo answers `SERVICE_AIRO_LIMIT` and built-in commands keep working. Voice answers `SERVICE_VOICE_LIMIT` and doesn't retry. Each instance logs a warning the first time a day it reaches either ceiling.
    - An Airo command turned away because an instance is busy now claims its slot before charging, so it costs no one's allowance.
  - **Deepgram:** every stream URL carries `mip_opt_out=true` (a documented Flux `/v2/listen` parameter), so meeting audio stays out of Deepgram's Model Improvement Program. OpenAI requests already use `store: false`.
  - **Review:** two independent reviewers, each finding challenged by a verifier. Three findings held up and were fixed: busy refusals counting against the total, a person charged when the service refused them, and a voice test that didn't check Deepgram was never dialled.
  - **Known limit:** a 15-second voice block charged just before a failed Deepgram open isn't given back. That needs a Deepgram outage, and the API's circuit breaker stops new opens after three failures.
  - **Local database:** the migration applied twice without error. Every outcome was checked: allowed, the person's own limit, the service limit with the charge given back, and a block larger than the ceiling. anon cannot call the function.
  - **Tests:** a service-wide ceiling test each for Airo and voice, a test that a busy refusal charges nothing, config defaults, and the opt-out parameter. API 209, web 426, scripts 196.
  - **Still needed, founder's sign-in:**
    - A monthly spend limit in the OpenAI console (Settings → Limits).
    - A budget or no automatic top-up in the Deepgram console.
