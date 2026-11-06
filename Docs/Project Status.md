# Airboard project status

> **As of:** 5 November 2026
> **Stage:** controlled production pilot (standalone web, plus the Google Meet private preview)
> **Detail:** the change log in [Release Readiness Backlog](Release%20Readiness%20Backlog.md) records every fix and deploy; [Official Launch Readiness](Official%20Launch%20Readiness.md) sets what each release stage may promise.

## What is live

| Part | Where | Notes |
| --- | --- | --- |
| Web | Cloud Run `airboard-pilot-web`, revision `launch-91d1c63` | `https://airboard-pilot-web-634900453473.asia-south1.run.app`; one instance, kept warm |
| API | Cloud Run `airboard-pilot-api`, revision `launch-fc7bc79` | Up to 3 instances, one kept warm; live boards are shared across instances. Each person gets 500 Airo model commands and 240 voice minutes a day |
| Database and sign-in | Supabase `ujotgzjpkocuhtfrvbzu` (ap-south-1, Mumbai) | Every migration in `supabase/migrations` applied, the last `20261106170000` (live link reset) |
| Google sign-in | Google Auth Platform in the pilot Google Cloud project | Consent screen "Airboard", published to every Google account; client "Airboard sign-in (Supabase)" |
| Lifecycle jobs | Cloud Scheduler `airboard-lifecycle-hourly` | Failed runs are logged; no alerts (the support inbox carries customer mail only) |

- **Voice commands:** the built-in grammar handles exact phrasings instantly; anything else goes to OpenAI `gpt-5.6-luna`, the only allowed intent model since 5 November 2026, on OpenAI's priority tier (typically 1.7 s, the slowest 5% about 2.5 s). Since prompt 2.12 (6 November 2026) Airo leaves all 60 recorded meeting-talk cases alone.
- **Health:** the API's `/ready` reports the database and `boardFanOut` (live boards across instances). Cloud Run restarts an instance that stops answering its health path (API `/health`, web `/favicon.ico`) for 90 seconds.
- **Launch check:** `pnpm launch:check:deployed` checks the live revisions and reports **READY, 21 of 21** for the controlled pilot. The commercial smoke test, which needs a disposable account on the release database, is a standalone-GA gate (decided 5 November 2026). The founder is the release owner and support owner, on `hellosigmascience@gmail.com`. The pilot signs people in with Google and sends no email, so it needs no email sender (decided 5 November 2026).
- **Rollback:** the API to `launch-91d1c63`, which accepts a sign-in token in a URL again (RGB-016). Then both services to `launch-19ddecb` (live guests edit by default, no New link, owner rejoins after a reload as a guest, before the accessibility fixes). It ignores the new `join_links_reset_at` column, so no database change is needed. Then both to `launch-09f196e` (no read-only roles, admin switches, security headers, photo cleaning, upload limits or share-link checks; 6-hour live links), which works with every migration since. Further back: the web to `launch-2f31bf2` (old status page) and the API to `launch-010a9b7` (no daily allowances or socket caps); the old API ignores the `daily_usage` table. Then: the web to `launch-7fa8ff1` (Admin role pickers unlabelled); the API to `launch-7fa8ff1` (intent prompt 2.11, which answers some meeting talk); both services to `launch-e9912d6` to remove view-only links (links already made stop opening until the release returns). Earlier API revisions restore older intent prompts.
- **Code:** `main`. The working branch `codex/production-readiness` reached it on 5 November 2026 through these pull requests:
  - #1: launch hardening.
  - #11: Google sign-in.
  - #12: status update.
  - #13: camera start.
  - #14: calmer board.

  #16 (cleanup), #18 (dependency updates and docs), #21 (security, robustness, erasure and image hardening), #23 (CI gates) and #24 (Luna as the only intent model) followed. View-only share links reached `main` through #36, intent prompt 2.12 (the API, `launch-010a9b7`) through #37, and the signed-in browser tests with the Admin label fix (the web, `launch-2f31bf2`) through #39. Both services now run `launch-09f196e`, which adds daily allowances, socket caps, the incident status page and the browser matrix; it is on `codex/production-readiness` and not yet merged to `main`. Both services then moved to `launch-19ddecb` (6 November 2026), which closes the eight medium-risk gaps from the threat model: read-only Viewer and Billing roles, enforced admin switches, private session history, security headers, photo metadata removal, share links tied to their maker, upload limits and 2-hour live links. Then to `launch-91d1c63` (6 November 2026): live guests view by default with an owner Can view / Can edit switch, New link, the owner rejoining after a reload, and the accessibility audit's fixes. On 7 November the API moved to `launch-fc7bc79`, which no longer reads a sign-in token from any URL (RGB-016).
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
  - Electron 43.8.7 for the desktop preview.

## What is left

### Blocking the pilot launch (owner)

1. **Sign-in email:** set up Resend on the company domain with a sender address. Anyone can sign in with Google today. Until Resend is set up, email-link sign-in reaches only members of the Supabase organization.
2. **Release owner:** name a business owner and a technical owner. Both accept the pilot's scope and can stop a release.
3. **Support path:** publish a pilot inbox that someone monitors, with an escalation owner.
4. **Commercial smoke test:** run the signed-in customer journey against production.

### Housekeeping (owner)

- Sign in once on the live site with **Continue with Google**: the first real end-to-end test of Google sign-in. Then confirm your boards came across to Mumbai.
- Delete the unused Seoul secret `airboard-supabase-secret-key` in Secret Manager.
- Keep the API on the legacy service-role key. In testing, the new `sb_secret_` key failed to join the private Realtime channels that live boards use.

### Later, not needed for the pilot

- **Paid launch:** billing is not configured. Then come the Stripe expiry field (RGB-008), team-seat enforcement (RGB-009) and failed-webhook alerting (RGB-010).
- **Desktop public release:** packaging, signing, notarization and updates (RGB-032).
- **Dependencies:** one moderate, development-only advisory (`minimatch` under typescript-eslint) needs a major upgrade.

## How to release

1. **Check:** run the checks CI runs (`pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm test:scripts`, `pnpm docs:check`, `pnpm --filter @airboard/web e2e`). Commit the change.
2. **Migrate:** apply new migrations: `supabase db push --dry-run`, then `supabase db push`. Do this before promoting an API that needs them.
3. **Build:** `infra/cloud-run/release.sh build` builds both images for the commit.
4. **Stage:** `infra/cloud-run/release.sh stage api` and `… stage web` create revisions with no traffic, each on its own tagged URL.
5. **Smoke the tagged URLs:**
   - `/ready` passes, including `boardFanOut`.
   - Signed-out calls get 401.
   - The pages return 200.
6. **Promote:** `infra/cloud-run/release.sh promote api` and `… promote web`. Then check production `/ready`, the error logs and `pnpm launch:check:deployed`.

`DRY_RUN=1` prints a step's commands without running them.
