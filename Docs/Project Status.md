# Airboard project status

> **As of:** 5 November 2026
> **Stage:** controlled production pilot (standalone web, plus the Google Meet private preview)
> **Detail:** the change log in [Release Readiness Backlog](Release%20Readiness%20Backlog.md) records every fix and deploy; [Official Launch Readiness](Official%20Launch%20Readiness.md) sets what each release stage may promise.

## What is live

| Part | Where | Notes |
| --- | --- | --- |
| Web | Cloud Run `airboard-pilot-web`, revision `launch-6c4ca43` | `https://airboard-pilot-web-634900453473.asia-south1.run.app`; one instance, kept warm |
| API | Cloud Run `airboard-pilot-api`, revision `launch-87aec6f` | Up to 3 instances, one kept warm; live boards are shared across instances |
| Database and sign-in | Supabase `ujotgzjpkocuhtfrvbzu` (ap-south-1, Mumbai) | Every migration in `supabase/migrations` applied, the last `20261105140000` |
| Google sign-in | Google Auth Platform in the pilot Google Cloud project | Consent screen "Airboard", published to every Google account; client "Airboard sign-in (Supabase)" |
| Lifecycle jobs | Cloud Scheduler `airboard-lifecycle-hourly` | Alert on a failed run |

- **Health:** the API's `/ready` reports the database and `boardFanOut` (live boards across instances).
- **Launch check:** `pnpm launch:check:deployed` checks the live revisions and passes **19 of 23**.
- **Rollback:** web to `launch-f33b2cb`, API to `launch-34df218` (`AIRBOARD_RELEASE=launch-<hash> infra/cloud-run/release.sh promote web|api`).
- **Code:** `main`. The working branch `codex/production-readiness` reached it on 5 November 2026 through these pull requests:
  - #1: launch hardening.
  - #11: Google sign-in.
  - #12: status update.
  - #13: camera start.
  - #14: calmer board.

  Both live revisions match `main`'s code.

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
- Review Dependabot's 9 update pull requests:
  - #2 to #6 are routine (GitHub Actions versions and 12 minor or patch packages).
  - #7 (MediaPipe 1.2, which drives gestures), #8 (React Hooks lint 7), #9 (Electron 45) and #10 (Node types 26) are major upgrades that each need testing.
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
