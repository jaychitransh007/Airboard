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
| RGB-034 | `Platform Support Matrix.md` still describes the retired Meet add-on architecture, not the shipped 0.8.0 camera overlay | Product | Reported | `Docs/Platform Support Matrix.md` vs `extensions/chrome-meet-bridge` | Update to the shipped Meet channel. |
| RGB-035 | `Intent Canvas Implementation Notes.md` still documents a removed Preview→Apply confirmation step (contradicts README + code) | Product | Reported | `Docs/Intent Canvas Implementation Notes.md` | Update to the no-confirmation model. |
| RGB-036 | README understates voice-trace storage as "in-memory only" — durable, org-scoped, 14-day storage is implemented | Product | Verified | `README.md` vs `voice_trace_events` schema + lifecycle purge | Correct the README. |
| RGB-037 | Two conflicting readiness sources of truth | Founder / Product | Verified | `Public Beta Readiness…` (stale: "identity not started") vs `Official Launch Readiness.md` + shipped `auth.ts` | Mark the Public Beta checklist historical/superseded; keep one source of truth. |

---

## Tier 4 — External evidence & deploy-config gates (not code)

These are already enforced fail-closed by `ops/launch-evidence.json` / `pnpm launch:check` and are **not** duplicated as backlog items. Summary of what remains human/legal/ops/deploy:

- Production config: `NODE_ENV=production`, non-local HTTPS/WSS URLs, real Supabase keys, ≥32-char signing/API/cron secrets, `AIRBOARD_LOCAL_ENTITLEMENTS=false`, Resend key.
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
