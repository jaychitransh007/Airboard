# Airboard commercial platform runbook

This document describes the implemented customer journey, its operating data, and the launch controls that still require external providers or human approval. It is an implementation runbook, not a legal or security certification.

## Customer journey now implemented

1. **Discover** — public pages identify the standalone web product as a controlled pilot, Google Meet (by presenting the Airboard tab) as part of it, and Zoom/Teams as unavailable. Contact-sales submissions are stored as deduplicated leads with a spam honeypot.
2. **Create an account** — the pilot signs people in with Google through Supabase Auth. The email-link form and a Microsoft button appear only when `/auth/config` reports them, and the pilot enables neither. The database bootstrap creates a profile, personal organization, owner membership, default workspace, policy, trial eligibility and pending entitlement. An invitation can add the same identity to another organization without duplicating the user.
3. **Onboard** — the product records role, company-size band, primary use case and target platform. It stores no board content, transcript or meeting title in analytics. Organization switching is explicit and remembered as the user's default tenant.
4. **Reach first value** — the one-month (30-day) pilot is not consumed at signup. It activates after a successful standalone canvas preflight.
5. **Use Airboard** — users create persistent boards (each save is compare-and-swap on a version number; no history copies are kept); open them from the one Airboards home page (`/app`); start live sessions; use typed, pointer, gesture or Airo input; and show a selected screen behind the board. A failed background save reports a non-blocking warning and preserves the working canvas.
6. **Use it in Meet** — the presenter shares the Airboard tab (**Present now → A tab**); nothing is installed. The Chrome extension, the Meet add-on and the Electron desktop app were removed on 12 Nov 2026.
7. **Buy and manage** — the billing page checks a secret-free commercial capability response. Unless Stripe checkout, prices and signed webhook processing are all configured, prices are labeled proposals, checkout stays unavailable and users enter a managed evaluation path. When enabled, signed idempotent webhooks update customers, subscriptions and entitlements and Stripe remains the payment system of record.
8. **Administer** — owners/admins manage members, invitations, organization policy, usage and audit events. SSO and SCIM were removed on 12 Nov 2026; migration `20261112120000_drop_unused_tables` drops their tables.
9. **Get help or leave** — authenticated support requests and user-created, content-free seven-day diagnostic bundles are available. Users can request a data export, schedule account/workspace deletion with a seven-day cancellation window, cancel a queued request, end sessions and control notification/analytics consent.

## Product pages

### Public

- `/`, `/product`, `/pricing`, `/enterprise`
- `/integrations`; `/integrations/google-meet` redirects to `/help/integrations/google-meet`
- `/security`, `/help`, `/help/:category/:article`, `/support`, `/status`, `/changelog`
- `/docs` is a legacy redirect to `/help`
- `/privacy`, `/terms`, `/dpa`, `/subprocessors`, `/cookies`, `/accessibility`
- `/contact-sales`, `/signup`, `/login`, `/auth/callback`, `/invite/:token`

### Authenticated product

- `/onboarding`; `/app`, the home page: every Airboard you can open, with Create Airboard
- `/app/boards/:id`, `/app/boards/new`, `/app/billing`
- `/app/settings/profile|preferences|connected-accounts|notifications|privacy-data|sessions`
- `/app/settings/workspace`, and for team owners and admins `/app/settings/members|policies|audit-logs`
- Signed-in pages have no sidebar: a top header with the profile menu (Profile, Help Center, Plan & Billing, Settings, Sign out). Old addresses redirect: `/app/boards`, `/app/shared`, `/app/activity` and `/app/trash` to `/app`; `/app/integrations` to the Google Meet help article; `/app/admin/*` to the same page in Settings; the removed SSO & SCIM page (`identity-directory`, under either path) to `/app/settings/workspace`.

## Data collected and why

| Category | Examples | Purpose | Default retention/control |
| --- | --- | --- | --- |
| Identity | email, display name, auth provider, locale, timezone | authentication, account recovery and display | user export/deletion; provider session revocation |
| Organization | name, size band, country, role, membership | tenancy, onboarding, access and growth segmentation | organization lifecycle policy |
| Product content | board title, description, latest state, visibility | core standalone and live-board service | active until deletion; deletion is immediate and permanent (boards soft-deleted before 2026-11-11 are purged after the organization retention window) |
| Billing | Stripe customer/subscription IDs, plan, seats, periods, status | entitlement and revenue operations | Stripe remains payment system of record |
| Consent | document version, consent type, granted state and source | prove media/privacy choice | append-only record; included in export |
| Product events | allowlisted event name, timestamps and bounded content-free properties | activation, reliability, conversion and cohort analysis | 90 days; no labels, transcripts, meeting URLs, raw media or credentials |
| Audit | actor, action, target, request/trace ID, bounded metadata | enterprise accountability and incident investigation | 365 days; personal fields anonymized on account deletion |
| Diagnostics | versions, capabilities, timings, error codes and trace IDs | time-bounded support | content-free bundle expires after seven days |
| Voice traces | turn ID, stage, outcome, timing, counts and action types | reliability diagnosis | content-redacted before logging/storage; hard-deleted by 14 days; no raw audio |
| Leads and support | contact details, company/use case, short IP hash; user-written support subject/message | evaluation follow-up and support | leads 365 days; resolved/closed support 365 days |
| Data exports | portable JSON of the requesting user’s stored data | access and portability | export payload seven days; terminal request metadata 30 days |

IP addresses are not stored in product analytics. The lead form stores only a short one-way IP hash for abuse correlation. API logs use request/trace IDs and route/status/latency fields; they must not log bearer tokens or request bodies.

## Operational controls

- `/health` is a liveness check; `/ready` verifies database/control-plane readiness and reports provider availability without secrets.
- `/metrics` exports request counts, status classes and aggregate latency and requires an operational bearer token.
- Every API response carries `x-request-id`; an incoming W3C `traceparent` is echoed and structured request logs correlate the route and duration.
- `/internal/lifecycle/run` requires the cron secret. It expires trials and entitlements, executes queued exports/deletions, delivers lifecycle notifications, purges expired deleted boards and enforces operational retention.
- Stripe webhook payloads are signature-verified and first persisted to an idempotent inbox. Unknown configured price IDs fail closed rather than granting an arbitrary plan.
- Two smoke tests run against a live or local API (`AIRBOARD_API_URL`).
  - `pnpm smoke:deploy` (also needs `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`) creates a throwaway account with the Supabase admin key. It checks the entitlement gate (402 until the pilot starts), a board save, the stale-version 409, the reload, a data-export request and permanent delete: afterwards the board returns 404 and is gone from the list. It removes the account whether or not the run passed.
  - `pnpm smoke:commercial` is the wider acceptance test. Give it a disposable account's `AIRBOARD_ACCESS_TOKEN` and an API backed by Supabase; the in-memory API keeps no boards. It covers account bootstrap, preferences, the board-opening preflight and pilot activation, compare-and-swap saves, reload and rename, and a live session: start, a guest joining on the live link, ticket renewal, and ending it from Settings. It also covers invitations, a privacy request, usage and audit, and permanent delete, which also removes the board's live session. Temporary credentials are revoked as it goes.

## Required production configuration

Core service:

- `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`
- `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `AIRBOARD_SESSION_SIGNING_SECRET`, `AIRBOARD_ALLOWED_ORIGINS`, `AIRBOARD_APP_URL`
- `NEXT_PUBLIC_AIRBOARD_API_URL`, `AIRBOARD_API_TOKEN`, `AIRBOARD_CRON_SECRET`

Commercial providers:

- `AIRBOARD_BILLING_ENABLED=true` only after the paid release gate passes
- `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PERSONAL_PRICE_ID`, `STRIPE_TEAM_PRICE_ID`
- `RESEND_API_KEY`, `AIRBOARD_EMAIL_FROM`

Sign-in email (Supabase Auth SMTP), only if email sign-in is enabled:

The pilot signs in with Google only and sends no sign-in email, so it needs none of this. If email sign-in is turned on later: Supabase's built-in mailer delivers only to members of the project's team and
is capped at 2 messages an hour, so a stranger's sign-up link fails with
`Email address not authorized`. Email sign-in then needs custom SMTP before anyone
outside the team can use it. One Resend account can serve both this and the
lifecycle email above.

1. In Resend, add a sending domain you control (for example
   `mail.<your-domain>`). Add the DNS records it lists, then wait for it to
   show as verified.
2. Create a Resend API key with sending access.
3. Open Supabase → Authentication → Emails → SMTP Settings. Enable custom SMTP:
   - host `smtp.resend.com`, port `465`;
   - username `resend`, password set to the API key;
   - sender `no-reply@mail.<your-domain>`, sender name `Airboard`.
4. Open Supabase → Authentication → Rate Limits. Raise the email limit, which
   starts low with custom SMTP, to what the pilot needs.
5. Open Supabase → Authentication → Emails → Templates and use the
   repository's branded templates:
   - **Magic link:** `supabase/templates/magic_link.html`, subject "Your
     Airboard sign-in link".
   - **Confirm signup:** `supabase/templates/confirmation.html`, subject
     "Confirm your email to open Airboard".

   `supabase/config.toml` applies the same templates locally.
6. Store the same key in Secret Manager. Set `RESEND_API_KEY` and
   `AIRBOARD_EMAIL_FROM` on the API service.
7. Ask a non-team address for a sign-in link and confirm it arrives.

Stopgap without a domain: Gmail SMTP.
- Host `smtp.gmail.com`, port `465`.
- Username: the Gmail address. Password: a Google app password, which needs
  2-Step Verification.
- Sender: the same address.
- Gmail allows roughly 500 recipients a day and shows the Gmail address as the
  sender.

Optional live intelligence:

- `DEEPGRAM_API_KEY` for Airo transcription
- `AIRBOARD_INTENT_API_KEY` (or `OPENAI_API_KEY`) for bounded semantic recovery

## Release

1. **Check:** run the checks CI runs (`pnpm docs:check`, `pnpm build`, `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm test:scripts`, `pnpm audit --prod`, `pnpm eval:pr`, `pnpm --filter @airboard/web e2e`). Commit the change.
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

## Rollback

Roll back only to the release named in [Project Status](<Project Status.md#roll-back-to>), and never take the API below the rollback floor stated there: a migration that drops tables makes older APIs fail. Promote the API first unless Project Status says otherwise:

```
AIRBOARD_RELEASE=launch-<hash> infra/cloud-run/release.sh promote api
AIRBOARD_RELEASE=launch-<hash> infra/cloud-run/release.sh promote web
```

Migrations are not rolled back. Then check production `/ready`, the error logs and `pnpm launch:check:deployed`, and record the rollback in the change log.

## Launch gates

What is left before each launch stage is listed once, in [Project Status](<Project Status.md#what-is-left>), and checked by `pnpm launch:check` against the gate ledger [`ops/launch-evidence.json`](../ops/launch-evidence.json). Until the standalone-GA gates pass, the honest release label is a controlled production pilot; [Official Launch Readiness](<Official Launch Readiness.md>) sets what each stage may promise.
