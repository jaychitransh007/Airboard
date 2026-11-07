# Airboard project status

> **As of:** 7 November 2026
> **Stage:** controlled production pilot (standalone web, plus the Google Meet private preview)
> **Detail:** the change log in [Release Readiness Backlog](Release%20Readiness%20Backlog.md) records every fix and deploy; [Official Launch Readiness](Official%20Launch%20Readiness.md) sets what each release stage may promise.

## What is live

| Part | Where | Notes |
| --- | --- | --- |
| Web | Cloud Run `airboard-pilot-web`, revision `launch-306c7a5` | `https://airboard-pilot-web-634900453473.asia-south1.run.app`; one instance, kept warm |
| API | Cloud Run `airboard-pilot-api`, revision `launch-306c7a5` | Up to 3 instances, one kept warm, each taking up to 250 connections and 50 live voice streams; live boards and per-minute limits are shared across instances. Each person gets 500 Airo model commands and 240 voice minutes a day |
| Database and sign-in | Supabase `ujotgzjpkocuhtfrvbzu` (ap-south-1, Mumbai) | Every migration in `supabase/migrations` applied, the last `20261107120000` (shared per-minute limits) |
| Google sign-in | Google Auth Platform in the pilot Google Cloud project | Consent screen "Airboard", published to every Google account; client "Airboard sign-in (Supabase)" |
| Lifecycle jobs | Cloud Scheduler `airboard-lifecycle-hourly` | Failed runs are logged; no alerts (the support inbox carries customer mail only) |

- **Voice commands:** the built-in grammar handles exact phrasings instantly; anything else goes to OpenAI `gpt-5.6-luna`, the only allowed intent model since 5 November 2026, on OpenAI's priority tier (typically 1.7 s, the slowest 5% about 2.5 s). Since prompt 2.12 (6 November 2026) Airo leaves all 60 recorded meeting-talk cases alone; prompt 2.13 (7 November 2026) keeps that and stops a two-shape "spread out" from losing a whole plan. Since `launch-376f31e` (7 November 2026) Airo sees and reuses shapes added from the toolbar or by typed commands, and since `launch-bd5de96` it also lines them up, spreads them out, tidies, copies and groups them. Since `launch-306c7a5` (7 November 2026, RGB-042) voice reaches 50 people per instance instead of 4. It also reconnects on its own after a deploy, a network drop, a Deepgram reset or the 30-minute stream limit. After 20 quiet minutes it pauses at that limit, and an open palm or **⏻** (Resume voice) wakes it.
- **Health:** the API's `/ready` reports the database and `boardFanOut` (live boards across instances). Cloud Run restarts an instance that stops answering its health path (API `/health`, web `/favicon.ico`) for 90 seconds.
- **Launch check:** `pnpm launch:check:deployed` checks the live revisions and reports **READY, 21 of 21** for the controlled pilot. The commercial smoke test, which needs a disposable account on the release database, is a standalone-GA gate (decided 5 November 2026). The founder is the release owner and support owner, on `hellosigmascience@gmail.com`. The pilot signs people in with Google and sends no email, so it needs no email sender (decided 5 November 2026).
- **Rollback:** both services to `launch-63a10b8`. Voice then goes back to 4 streams per instance and ends for good on any drop. To also put API concurrency back to 80, run `gcloud run services update airboard-pilot-api --concurrency=80` on the restored revision; otherwise the setting stays at 250, which the older code tolerates. Further back, the API to `launch-637bd84` and the web to `launch-460cd8d`, which run the same code from earlier commits. Further back still, the API to `launch-bd5de96` (prompt 2.12: "put … side by side … and group them" can lose the whole plan, RGB-041). The web to `launch-bd5de96`, where a long typed sentence starting with "put" or "add" can add the wrong shape (RGB-040). Further back, both services to `launch-376f31e`: per-minute limits go back to per instance (the new table is simply unused), and Airo says "not yet" to arranging typed shapes. Further back, both to `launch-8eff5db`: Airo draws a second copy of a typed or toolbar shape, and a malformed JSON request gets 500 instead of 400. Then the web to `launch-abc3725` and the API to `launch-fc7bc79`: the owner's open tab revives an ended session, and wide fonts push the cards past 320px. Then the web to `launch-91d1c63`, which doesn't save Airo or compound commands until a later edit. The API to `launch-91d1c63`, which accepts a sign-in token in a URL again (RGB-016). Then both services to `launch-19ddecb` (live guests edit by default, no New link, owner rejoins after a reload as a guest, before the accessibility fixes). It ignores the new `join_links_reset_at` column, so no database change is needed. Then both to `launch-09f196e` (no read-only roles, admin switches, security headers, photo cleaning, upload limits or share-link checks; 6-hour live links), which works with every migration since. Further back: the web to `launch-2f31bf2` (old status page) and the API to `launch-010a9b7` (no daily allowances or socket caps); the old API ignores the `daily_usage` table. Then: the web to `launch-7fa8ff1` (Admin role pickers unlabelled); the API to `launch-7fa8ff1` (intent prompt 2.11, which answers some meeting talk); both services to `launch-e9912d6` to remove view-only links (links already made stop opening until the release returns). Earlier API revisions restore older intent prompts.
- **Code:** `main` matches what is deployed.
  - `codex/production-readiness` reached `main` through PR #45 (merge `db6630a`, 7 November 2026), and production ran `launch-63a10b8`, built from the branch tip. Production now runs `launch-306c7a5` (the RGB-042 voice fix), which is on `codex/production-readiness` and reaches `main` with PR #46.
  - Earlier pull requests, from #1 (launch hardening) to #44, and every deploy are listed in the change log of the [Release Readiness Backlog](Release%20Readiness%20Backlog.md).
- **Image retention:** Artifact Registry keeps images tagged `live`, plus the 10 newest per image, and deletes anything older than 3 days. `release.sh promote` moves the `live` tag.

## Shipped in the launch hardening (November 2026)

- **Database move:** the database and sign-in moved from Seoul to Mumbai, close to the pilot users. The Seoul project is deleted.
- **Speed:**
  - A saved board opens and is live in about 1.75 s warm, from about 9.3 s.
  - The landing page loads 113 KB of JavaScript, from 298 KB.
- **Reliability:**
  - Graceful shutdown on deploys.
  - Timeouts on every outside call.
  - A read-only switch for maintenance.
- **Shared live boards:**
  - Live boards stay in step across API instances, catching up from the database after any missed update.
  - A new session starts in one database call.
- **Product:**
  - Library previews and search.
  - PDF and copy-image export.
  - The landing-page demo.
  - Keyboard menus and dialog focus.
- **Calmer board:**
  - The top bar is Share plus one menu.
  - Airo shrinks to a corner strip while it listens.
  - The selected element gets a compact floating toolbar.
  - Zoom sits in the tool dock.
- **Faster camera start:** hand tracking downloads while the browser asks for the camera, and a slow prompt is explained.
- **Google sign-in:** "Continue with Google" works for everyone, with no email setup needed.
- **Engineering hygiene:**
  - CI runs lint, audit, a secret scan and Dependabot.
  - No high or critical dependency advisories.
  - Electron 45.2.1 for the desktop preview.

## Shipped since 6 November 2026

- **Security:** the eight medium-risk gaps from the threat model are closed:
  - read-only Viewer and Billing roles;
  - enforced admin switches;
  - private session history;
  - security headers;
  - photo metadata removal;
  - share links tied to their maker;
  - upload limits;
  - 2-hour live links.

  No sign-in token is read from a URL (RGB-016), and a malformed request gets 400.
- **Live boards:** guests view by default, with an owner Can view / Can edit switch and New link. The owner rejoins after a reload, and an ended session stays ended.
- **Accessibility:** the audit's fixes for keyboard use, focus, contrast and screen readers.
- **Airo:**
  - It saves its own changes and their undo.
  - It sees and reuses shapes from the toolbar and typed commands. It can also line them up, spread them out, tidy, copy and group them.
  - A long typed sentence is no longer mistaken for "add a shape" (RGB-040), and a two-shape "spread out" no longer loses a plan (RGB-041).
- **Shared limits:** per-minute limits hold across API instances (RGB-019).
- **Tooling:**
  - Every migration is safe to run twice (RGB-028).
  - The Chrome extension is packaged per release target, and CI keeps each package (RGB-033).
  - The desktop app can be packaged, signed and updated once signing accounts exist (RGB-032).

## What is left

The launch check reports **READY, 21 of 21** for the controlled pilot. An open (standalone GA) launch passes 21 of 36, and a paid launch 21 of 45.

### For an open launch (owner)

- **Legal and providers:**
  - Counsel approves the company details, privacy notice, terms and data processing agreement.
  - The providers' contract terms and data locations are approved.
- **Security review:**
  - Review and sign off the private threat model.
  - Commission an independent security test and fix anything critical or high.
- **Operations:**
  - Choose a backup method and prove a restore.
  - Run an incident and breach-notification drill.
  - Route alerts to an accountable responder, not the support inbox.
  - Replace the status page placeholder with a real incident process.
  - Publish support hours you can staff.
- **Email:**
  - Verify a sending domain (SPF, DKIM, DMARC).
  - Configure the lifecycle email sender.
- **Testing:**
  - Run the sign-up journey with a spare Google account.
  - Test Google sign-in in production: redirect, sign-out, expiry and recovery.
  - Run the Windows browsers in the browser matrix.
  - Have a screen-reader user try the core flows, and sign off the accessibility audit.

### Housekeeping (owner)

- Set spending limits in OpenAI and Deepgram, and turn off Deepgram's model-improvement option.
- Turn on two-step sign-in for every admin account.
- Decide the trial rules.
- Delete the unused Seoul secret `airboard-supabase-secret-key` in Secret Manager. It still exists; the API uses `airboard-supabase-secret-key-mumbai`.
- Keep the API on the legacy service-role key. In testing, the new `sb_secret_` key failed to join the private Realtime channels that live boards use.

### Later, not needed for the pilot

- **Paid launch:**
  - Stripe keys and prices, the billing switch and approved offer wording.
  - Tax, refunds and a live-mode Stripe test.
  - Then the Stripe expiry field (RGB-008), team-seat enforcement (RGB-009) and failed-webhook alerting with daily reconciliation (RGB-010).
- **Desktop public release:**
  - Add the Apple Developer ID and Windows signing secrets listed in `apps/desktop/README.md`, then tag `desktop-v*` for the first signed draft release.
  - The Windows build hasn't run yet.
  - Confirm the app id and copyright holder before the first public release.
- **Airo:** grouping its own diagram nodes together with toolbar shapes still says "not yet".
- **Dependencies:** one moderate, development-only advisory (`minimatch` under typescript-eslint) needs a major upgrade.

## How to release

1. **Check:** run the checks CI runs (`pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm test:scripts`, `pnpm docs:check`, `pnpm --filter @airboard/web e2e`). Commit the change.
2. **Migrate:** `DRY_RUN=1 infra/cloud-run/release.sh migrate` lists pending migrations, and `infra/cloud-run/release.sh migrate` applies them. Do this before staging an API that needs them; `stage api` refuses while any are pending.
3. **Build:** `infra/cloud-run/release.sh build` builds both images for the commit.
4. **Stage:** `infra/cloud-run/release.sh stage api` and `… stage web` create revisions with no traffic, each on its own tagged URL.
5. **Smoke the tagged URLs:**
   - `/ready` passes, including `boardFanOut`.
   - Signed-out calls get 401.
   - The pages return 200.
6. **Promote:** `infra/cloud-run/release.sh promote api` and `… promote web`. Then check production `/ready`, the error logs and `pnpm launch:check:deployed`.

`DRY_RUN=1` prints a step's commands without running them.

Two things that have caught releases out:
- **Help articles:** a help article may cite only files the web image copies (see `infra/cloud-run/web.Dockerfile`). The help generator checks every cited file during the web build.
- **Airo's prompt or plan schema:** a change to either makes the recorded meeting-talk answers stale. Re-record them with `node --env-file-if-exists=.env scripts/eval-semantic-negatives.mjs --record`, and run the voice-intent eval against a local API.
