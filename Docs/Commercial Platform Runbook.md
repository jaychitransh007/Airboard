# Airboard commercial platform runbook

This document describes the implemented customer journey, its operating data, and the launch controls that still require external providers or human approval. It is an implementation runbook, not a legal or security certification.

## Customer journey now implemented

1. **Discover** — public product, integration, use-case, template, pricing, enterprise, security, documentation, support, status, changelog, privacy, terms, DPA, subprocessors, cookie and accessibility pages explain the two Airboard modes: a persistent standalone workspace and an audience-safe meeting overlay. Contact-sales submissions are stored as deduplicated leads with a spam honeypot.
2. **Create an account** — email magic-link, Google and Microsoft authentication use Supabase Auth. The database bootstrap creates a profile, personal organization, owner membership, default workspace, policy, trial eligibility and pending entitlement. An invitation can add the same identity to another organization without duplicating the user.
3. **Onboard** — the product records role, company-size band, primary use case and target platform. It stores no board content, transcript or meeting title in analytics. Organization switching is explicit and remembered as the user's default tenant.
4. **Reach first value** — the 72-hour trial is not consumed at signup. It activates after a successful standalone canvas preflight or a Meet extension preflight that proves consent, sender attachment, encoded composite frames and outbound bytes.
5. **Use Airboard** — users create persistent, versioned boards; open recent/shared/archived/trash views; start live sessions; use typed, pointer, gesture or Airo input; present over a selected screen; or run the native click-through desktop overlay. A failed background save reports a non-blocking warning and preserves the working canvas.
6. **Integrate with Meet** — the Chrome extension is linked to the signed-in organization with a one-time link token. It keeps its drawing engine private and replaces the outgoing camera track with the camera-plus-neon composite. There is no dedicated Airboard activity or shared canvas inside Meet.
7. **Buy and manage** — Personal and Team checkout sessions are created by Stripe; signed, idempotent webhooks update customers, subscriptions and entitlements; the Stripe portal handles payment-method, invoice and cancellation workflows. Enterprise leads enter the managed evaluation path.
8. **Administer** — owners/admins manage members, invitations, organization policy, installation settings/revocation, usage, audit events, SAML/OIDC metadata and SCIM tokens. SSO enforcement remains off until an operator activates and verifies the matching identity provider, preventing tenant lockout.
9. **Get help or leave** — authenticated support requests and explicitly consented, seven-day diagnostic bundles are available. Users can request a data export, schedule account/workspace deletion with a seven-day cancellation window, cancel a queued request, end sessions and control notification/analytics consent.

## Product pages

### Public

- `/`, `/product`, `/pricing`, `/enterprise`, `/templates`, `/demo`, `/download`
- `/integrations` and `/integrations/google-meet|zoom|teams|standalone`
- `/use-cases/sales|engineering|teaching|consulting|workshops`
- `/security`, `/docs`, `/support`, `/status`, `/changelog`
- `/privacy`, `/terms`, `/dpa`, `/subprocessors`, `/cookies`, `/accessibility`
- `/contact-sales`, `/signup`, `/login`, `/auth/callback`, `/invite/:token`

### Authenticated product

- `/onboarding`, `/app`, `/app/boards`, `/app/boards/:id`, `/app/boards/new`, `/app/boards/live`
- `/app/templates`, `/app/activity`, `/app/integrations`, `/app/billing`
- `/app/settings/profile|preferences|connected-apps|notifications|privacy-data|sessions`
- `/app/admin/overview|members|policies|identity-directory|installations|audit-logs`

## Data collected and why

| Category | Examples | Purpose | Default retention/control |
| --- | --- | --- | --- |
| Identity | email, display name, auth provider, locale, timezone | authentication, account recovery and display | user export/deletion; provider session revocation |
| Organization | name, size band, country, role, membership | tenancy, onboarding, access and growth segmentation | organization lifecycle policy |
| Product content | board title, versioned state, visibility | core standalone and live-board service | organization retention and deletion workflow |
| Installation | platform, version, settings, consent time, last seen/success/error | setup health and support | revocable per installation |
| Billing | Stripe customer/subscription IDs, plan, seats, periods, status | entitlement and revenue operations | Stripe remains payment system of record |
| Consent | document version, consent type, granted state and source | prove media/privacy choice | append-only record; included in export |
| Product events | allowlisted event name, timestamps and bounded content-free properties | activation, reliability, conversion and cohort analysis | no labels, transcripts, meeting URLs, raw media or credentials |
| Audit | actor, action, target, request/trace ID, bounded metadata | enterprise accountability and incident investigation | organization policy; admin-visible |
| Diagnostics | versions, capabilities, timings, error codes and trace IDs | time-bounded support | seven days; content requires separate opt-in |
| Voice traces | turn ID, bounded transcript/stage metadata and provider request IDs | reliability diagnosis | access-controlled operational retention; no raw audio |

IP addresses are not stored in product analytics. The lead form stores only a short one-way IP hash for abuse correlation. API logs use request/trace IDs and route/status/latency fields; they must not log bearer tokens or request bodies.

## Operational controls

- `/health` is a liveness check; `/ready` verifies database/control-plane readiness and reports provider availability without secrets.
- `/metrics` exports request counts, status classes and aggregate latency and requires an operational bearer token.
- Every API response carries `x-request-id`; an incoming W3C `traceparent` is echoed and structured request logs correlate the route and duration.
- `/internal/lifecycle/run` requires the cron secret. It expires trials and entitlements, executes queued exports/deletions, delivers lifecycle notifications and purges expired diagnostics/operational data.
- Stripe webhook payloads are signature-verified and first persisted to an idempotent inbox. Unknown configured price IDs fail closed rather than granting an arbitrary plan.
- The reusable local acceptance test is `pnpm smoke:commercial`. It verifies account bootstrap, preferences, trial activation, persistent boards, a live session, extension linking/consent/sender verification, invitations, SCIM, privacy requests, usage, audit and product telemetry; temporary credentials are revoked at the end.

## Required production configuration

Core service:

- `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`
- `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `AIRBOARD_SESSION_SIGNING_SECRET`, `AIRBOARD_ALLOWED_ORIGINS`, `AIRBOARD_APP_URL`
- `NEXT_PUBLIC_AIRBOARD_API_URL`, `AIRBOARD_API_TOKEN`, `AIRBOARD_CRON_SECRET`

Commercial providers:

- `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PERSONAL_PRICE_ID`, `STRIPE_TEAM_PRICE_ID`
- `RESEND_API_KEY`, `AIRBOARD_EMAIL_FROM`

Optional live intelligence:

- `DEEPGRAM_API_KEY` for Airo transcription
- `AIRBOARD_INTENT_API_KEY` (or `OPENAI_API_KEY`) for bounded semantic recovery

## External launch gates

The repository cannot complete these without the relevant account owner, credentials or independent party:

- create/approve production Stripe products, tax policy, refund policy and webhook endpoint;
- verify the sending domain and lifecycle templates in Resend;
- configure Supabase production OAuth redirect URIs and Google/Microsoft provider credentials;
- activate and test each enterprise SAML/OIDC provider after metadata/domain verification;
- publish the Chrome extension through Chrome Web Store review and distribute signed desktop installers;
- complete receiver-side Google Meet evidence with two real accounts/devices; repeat the marketplace approval process before describing Zoom or Teams as generally available;
- counsel approval for terms, privacy notice, DPA, subprocessors, trial/renewal language and deletion obligations;
- independent penetration test, dependency/container scanning, backup-restore exercise, incident response exercise and accessibility audit;
- production alert routing, on-call ownership, status-provider integration, support SLA and CRM routing.

Until these gates are signed off, the honest release label is a controlled production pilot: the application and control plane are deployable, but commerce, identity-provider enforcement and marketplace distribution depend on configured external systems.
