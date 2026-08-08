# Airboard official launch readiness

> **Status:** Active source of truth for commercial release decisions
> **Last updated:** 25 July 2026
> **Current honest label:** Controlled production pilot
> **Current public channels:** Standalone web pilot; Google Meet private preview; desktop development preview
> **Not supported channels:** Zoom and Microsoft Teams product integrations
> **Payment status:** Checkout is environment-gated and must be described as unavailable until the paid-GA gate passes

This plan separates an implemented capability from an operationally and legally supportable market promise. A page, route, table or provider adapter existing in source code is not by itself launch evidence.

## Release ladder

| Stage | What may be promised | Mandatory decision |
| --- | --- | --- |
| Controlled pilot | Invited or self-signing users may evaluate the standalone web product; preview channels are explicitly labeled; no SLA or certification claim | `pnpm launch:check -- --scope=controlled-pilot` passes |
| Standalone GA | Publicly supported standalone web product on a tested desktop-browser matrix, with approved legal documents, support, monitoring and recovery | `pnpm launch:check -- --scope=standalone-ga` passes |
| Paid GA | Standalone GA plus an approved paid offer and proven live Stripe lifecycle | `pnpm launch:check:paid` passes |
| Chrome public | Standalone GA plus reviewed Chrome Web Store distribution and receiver-side Google Meet evidence | `pnpm launch:check -- --scope=chrome-public` passes |
| Desktop public | Standalone GA plus signed/notarized installers, updates, OS matrix and rollback | `pnpm launch:check -- --scope=desktop-public` passes |

Zoom and Microsoft Teams require their own implementation, identity, client-matrix, store-review, privacy and operational gates. They are outside every current release scope.

## Market truth by journey

### 1. Discovery

- Say: Airboard has a persistent standalone web workspace with pointer and typed input. Voice, gesture and screen capture depend on browser/device capability.
- Say: the Chrome Google Meet camera overlay is a private preview; the Electron overlay is a development preview.
- Say: Zoom and Microsoft Teams are planned or design-partner discovery only, not usable integrations.
- Do not say: generally available, certified, compliant, always available, unlimited, enterprise-ready, or covered by an SLA.
- The `/status` marketing page is a placeholder disclosure, not live monitoring.

### 2. Signup and identity

- Email magic-link is the deployed public identity path when `/auth/config` reports it.
- Google or Microsoft buttons render only when Supabase reports those providers as available.
- A successful identity bootstrap creates a profile, personal organization, owner membership, default workspace, organization policy, trial eligibility and pending entitlement.
- Production OAuth redirects, account recovery and provider logout still need release-environment evidence.

### 3. Onboarding and trial

- The trial duration is 72 hours.
- The trial starts at first successful standalone or supported preview activation, not at account creation.
- No card is required for the controlled pilot.
- Paid access is not offered unless `/commercial/config` returns `checkoutEnabled: true` and the paid-GA evidence gate passes.

### 4. Core usage

- Implemented: persistent boards, versions, recent/shared/archived/trash views, sharing, JSON/image export paths, live sessions, pointer, typed commands, voice/semantic routing, gesture controls, screen underlay and presentation modes.
- Reliability boundary: provider-powered voice requires configured Deepgram; semantic fallback requires configured OpenAI. Deterministic typed commands remain the provider-independent path.
- Deleted boards remain recoverable for the organization policy window and are then hard-deleted by the scheduled lifecycle job.
- Active boards are not automatically expired.

### 5. Integrations

- Google Meet: private Chrome-extension preview with explicit media disclosure, revocable installation credential, private rendering engine and outgoing-camera verification.
- Desktop: local development/preview shell; no public signed installer or automatic-update claim.
- Zoom: no usable channel.
- Microsoft Teams: no usable channel.
- Google Workspace/Meet add-on work recorded in historical feasibility documents does not change the current public distribution statement.

### 6. Payment

- The API implements Stripe Checkout, signature-verified raw webhooks, idempotent webhook storage, entitlements and billing portal creation.
- The web UI queries `/commercial/config`; when any live billing component is missing, it shows proposed pricing and routes to an evaluation request instead of attempting payment.
- Paid launch additionally requires live-mode journey evidence, approved tax/refund/geography policy, reconciliation and failed-webhook alerting.

### 7. Support, export and deletion

- Users can create a content-free seven-day diagnostic bundle after an explicit action and recorded support-diagnostics consent.
- Users can request a portable JSON export. It includes the requesting profile, memberships, owned boards, consents, owned installations, support requests, product/audit metadata, notification history and matching lead submissions. It does not export other members’ boards or organization billing records.
- Completed export payloads are cleared after seven days; terminal request metadata is removed after 30 days.
- Account and workspace deletion has a seven-day cancellation window. Account execution revokes owned installations, deletes user-linked support/analytics/lead data and anonymizes retained audit metadata.

## Data inventory and enforced retention

| Data | Captured/stored | Current enforced retention |
| --- | --- | --- |
| Identity and profile | email, display name, provider identity, locale, timezone, preferences | account lifetime; removed by executed account deletion |
| Organization and access | organization, membership, role, invitations, policy, directory configuration | organization/account lifetime; provider and directory obligations need contract review |
| Boards | title, description, latest state, versions, visibility, share tokens as hashes | active until deletion; soft-deleted board purged after the configured 1–3650 day recovery window |
| Media | live camera frames and microphone audio | not stored by Airboard |
| Voice processing | Deepgram receives live audio; OpenAI may receive bounded command text and board context on semantic fallback | provider handling per final vendor terms; Airboard content-free traces expire within 14 days |
| Product analytics | allowlisted event, timestamp, bounded content-free properties | 90 days |
| Audit | actor/action/target, request ID, IP hash, summarized user agent, bounded metadata | 365 days; personal fields anonymized on account deletion |
| Support | user-written subject/message; sanitized diagnostic metadata | resolved/closed requests: 365 days; diagnostic content cleared at seven days and expired metadata removed later |
| Leads | name, email, company, company size, use case, source, short one-way IP hash | 365 days or account deletion when the email matches |
| Data exports | portable JSON result and request status | result seven days; terminal request record 30 days |
| Notifications | recipient email, template, bounded payload, delivery status | sent/canceled jobs 30 days |
| Billing | Stripe identifiers, subscription status, plan, seats and bounded summary; raw webhook inbox | account/legal lifecycle for billing records; processed/ignored webhook inbox 30 days |
| Consent | consent type, document version, decision, source, summarized user agent | account lifetime; included in export and removed with profile |

Open or in-progress support requests are retained until they are resolved/closed or the related account is deleted. Billing retention and provider-side deletion must be finalized with accounting and counsel before paid GA.

## Implementation completed in this launch pass

- Public copy and authenticated billing now expose controlled-pilot and proposed-price status instead of implying a purchasable GA product.
- A public, secret-free `/commercial/config` capability response gates checkout presentation.
- Stripe credentials do not activate checkout by themselves; `AIRBOARD_BILLING_ENABLED=true` is a separate paid-release switch.
- Checkout also requires a webhook secret, preventing payment acceptance when entitlement webhooks cannot be verified.
- Voice traces and semantic logs redact transcript, commands and board labels before buffering, logging or persistence.
- Historical voice-trace content receives a migration scrub.
- Lifecycle retention now covers deleted boards, exports, terminal privacy requests, analytics, audit, leads, support, notifications, webhooks and diagnostics.
- Portable exports no longer include organization-wide non-private boards or other users’ installations/billing.
- Account deletion revokes installations and cleans or anonymizes linked operational data.
- Browser test harness authentication preserves production authorization while allowing deterministic local E2E execution.
- The launch checker makes missing configuration and human/external evidence fail closed.

## Work that cannot be truthfully completed in source code

The owner must supply or coordinate:

- legal entity and registered contact details;
- counsel-approved privacy notice, terms, DPA, subprocessors, trial, renewal, cancellation, tax and refund language;
- production Supabase, OAuth, Deepgram, OpenAI, Resend and Stripe accounts/configuration;
- production database migration execution and scheduler setup;
- ingress, load-balancer and log-sink verification that redacts realtime ticket query parameters in addition to the application logger;
- independent penetration testing and remediation;
- backup/restore and incident-response exercises;
- public monitoring, alert routing, on-call ownership and status publishing;
- accessibility and promised browser/device matrix testing;
- Chrome Web Store review and real two-account receiver evidence;
- desktop signing/notarization/update infrastructure;
- staffed support hours and escalation ownership.

Record proof in `ops/launch-evidence.json`. A gate is complete only when its status is `verified` and its evidence field points to an immutable report, deployment, dashboard, ticket or repository artifact.

## Release procedure

1. Freeze the exact release commit and record it in the evidence file.
2. Run `pnpm typecheck`, `pnpm test`, `pnpm build`, voice evaluations and full Playwright journeys.
3. Apply all Supabase migrations to a production-like database and run `pnpm smoke:commercial`.
4. Deploy that same commit; verify web, API, auth, readiness, commercial config, save/export/delete and lifecycle behavior.
5. Exercise rollback and alert delivery.
6. Complete the human/external evidence for the chosen scope.
7. Run the matching launch-check command. Treat any `BLOCK` as a stop-ship.
8. Only then change public stage labels or enable the applicable distribution/payment channel.
