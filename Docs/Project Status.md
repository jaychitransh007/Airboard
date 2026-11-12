# Airboard project status

> **As of:** 12 November 2026
> **Stage:** controlled production pilot (standalone web, plus the Google Meet private preview)
> **Owns:** what is live, where to roll back, and what is left before each launch stage. [Docs/README](README.md) says which doc owns every other topic; how to release and roll back is in the [Commercial Platform Runbook](Commercial%20Platform%20Runbook.md#release).

## What is live

| Part | Where | Notes |
| --- | --- | --- |
| Web | Cloud Run `airboard-pilot-web`, revision `launch-3a5c7ab` | `https://airboard-pilot-web-634900453473.asia-south1.run.app`; one instance, kept warm |
| API | Cloud Run `airboard-pilot-api`, revision `launch-3a5c7ab` | Up to 3 instances, one kept warm, each taking up to 250 connections and 50 live voice streams; live boards and per-minute limits are shared across instances. Each person gets 500 Airo model commands and 240 voice minutes a day (since RGB-049, minutes count only while someone speaks), and everyone together at most 5,000 and 3,000 a day (RGB-044) |
| Database and sign-in | Supabase `ujotgzjpkocuhtfrvbzu` (ap-south-1, Mumbai) | Every migration in `supabase/migrations` applied, the last `20261112120000` (drops the nine tables nothing uses: extension installations, board history, SSO/SCIM, and four first-schema leftovers) |
| Google sign-in | Google Auth Platform in the pilot Google Cloud project | Consent screen "Airboard", published to every Google account; client "Airboard sign-in (Supabase)" |
| Lifecycle jobs | Cloud Scheduler `airboard-lifecycle-hourly` | Failed runs are logged; no alerts (the support inbox carries customer mail only) |

- **Voice commands:** the built-in grammar handles exact phrasings instantly; anything else goes to OpenAI `gpt-5.6-luna`, the only allowed intent model since 5 November 2026, on OpenAI's priority tier (typically 1.7 s, the slowest 5% about 2.5 s). Since prompt 2.12 (6 November 2026) Airo leaves all 60 recorded meeting-talk cases alone; prompt 2.13 (7 November 2026) keeps that and stops a two-shape "spread out" from losing a whole plan. Since `launch-376f31e` (7 November 2026) Airo sees and reuses shapes added from the toolbar or by typed commands, and since `launch-bd5de96` it also lines them up, spreads them out, tidies, copies and groups them. Since `launch-306c7a5` (7 November 2026, RGB-042) voice reaches 50 people per instance instead of 4. It also reconnects on its own after a deploy, a network drop, a Deepgram reset or the 30-minute stream limit. After 20 quiet minutes it pauses at that limit, and an open palm or **⏻** (Resume voice) wakes it.
- **Hands-free meetings (RGB-049):** voice never writes into the typing box; failures and Airo's questions show on the board with quiet sounds; only speech meant for Airo is shown; follow-ups need no wake word for board edits; pointing resolves "here/this/that"; the planner (prompt 2.14) guesses instead of asking and takes 40 steps / 2,000 characters; hands work on every shape with no keyboard; voice minutes count only speech, with warnings at 15 and 5 minutes left. Not yet tried with a real microphone and camera in a meeting.
- **Health:** the API's `/ready` reports the database and `boardFanOut` (live boards across instances). Cloud Run restarts an instance that stops answering its health path (API `/health`, web `/favicon.ico`) for 90 seconds.
- **Launch check:** `pnpm launch:check:deployed` checks the live revisions and reports **READY, 21 of 21** for the controlled pilot. The commercial smoke test, which needs a disposable account on the release database, is a standalone-GA gate (decided 5 November 2026). The founder is the release owner and support owner, on `hellosigmascience@gmail.com`. The pilot signs people in with Google and sends no email, so it needs no email sender (decided 5 November 2026).
- **Code:** `main` matches production (both services `launch-9d5bd39`) since PR #51 merged on 12 November 2026. Every earlier pull request and deploy is in the change log.

## Roll back to

- **Web:** live `launch-3a5c7ab`; roll back to `launch-9d5bd39`.
- **API:** live `launch-3a5c7ab`; roll back to `launch-9d5bd39` (the floor).
- **Rollback floor:** no API revision older than `launch-9d5bd39`. Migration `20261112120000` dropped tables older APIs use (their board saves return 500). Restoring dropped data needs the 12 Nov 02:36 UTC Supabase backup.
- **Images:** Artifact Registry keeps `live` and the 10 newest per image, and deletes any other image older than 3 days.

## Recent deploys

Newest first; the [change log](Release%20Readiness%20Backlog.md#change-log) has every deploy with its evidence and rollback target.

- `launch-3a5c7ab` (both, 12 Nov): refactoring steps 1–3; operator token header-only, CI trimmed, test safety net. No user-facing change.
- `launch-9d5bd39` (both, 12 Nov): Touchpad Writing removed; then migration `20261112120000` dropped the nine unused tables.
- `launch-553e83b` (web, 12 Nov): `/pilot/*` pages describe presenting the tab, with nothing to install.
- `launch-2ddda24` (both, 12 Nov): Chrome extension, Meet add-on, Electron app, SSO/SCIM and board-history writes removed.
- `launch-a4c7947` (web, 12 Nov): `/meet/overlay-engine` refuses all framing; board planning uses the tested helpers.

## What is left

This is the one hand-written list of what is left before each launch stage; other docs link here. The machine-checked source is the gate ledger [`ops/launch-evidence.json`](../ops/launch-evidence.json), which `pnpm launch:check` reads: where this list and the ledger disagree, the ledger wins. A gate is done only when its status is `verified` and its evidence points to a durable report, deployment, dashboard, ticket or repository artifact.

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
  - Prove the public incident page and its update process (gate `public-status-process`).
  - Publish support hours you can staff.
- **Email:**
  - Verify a sending domain (SPF, DKIM, DMARC).
  - Configure the lifecycle email sender.
- **Testing:**
  - Run the sign-up journey with a spare Google account.
  - Test Google sign-in in production: redirect, sign-out, expiry and recovery.
  - Run the Windows browsers in the browser matrix.
  - Have a screen-reader user try the core flows, and sign off the accessibility audit.
- **Not in any gate yet (owner to decide):** a real two-account test of presenting the Airboard tab in Google Meet; checking that ingress, load-balancer and log-sink logs redact realtime ticket query parameters, not only the application logger; container image scanning.

### Housekeeping (owner)

- Set spending limits in the OpenAI and Deepgram consoles, which need the founder's sign-in. Since `launch-99ae9d0` the app also caps total daily use, and every Deepgram stream opts out of model improvement (RGB-044).
- Turn on two-step sign-in for every admin account.
- Decide the trial rules.
- Delete the unused Seoul secret `airboard-supabase-secret-key` in Secret Manager. It still exists; the API uses `airboard-supabase-secret-key-mumbai`.
- Keep the API on the legacy service-role key. In testing, the new `sb_secret_` key failed to join the private Realtime channels that live boards use.

### Later, not needed for the pilot

- **Paid launch:**
  - Stripe keys and prices, the billing switch and approved offer wording.
  - Tax, refunds and a live-mode Stripe test.
  - Then the Stripe expiry field (RGB-008), team-seat enforcement (RGB-009) and failed-webhook alerting with daily reconciliation (RGB-010).
- **Airo:** grouping its own diagram nodes together with toolbar shapes still says "not yet".
- **Dependencies:** one moderate, development-only advisory (`minimatch` under typescript-eslint) needs a major upgrade.
