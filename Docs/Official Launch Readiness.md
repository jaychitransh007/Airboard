# Airboard official launch readiness

> **Owns:** the release ladder, what each stage may and must not promise, and the data and retention inventory. What is left before each stage is listed in [Project Status](<Project Status.md#what-is-left>) and checked by `pnpm launch:check`; [Docs/README](README.md) lists the owner of every other topic.
> **Last reviewed:** 12 November 2026
> **Current honest label:** Controlled production pilot
> **Current public channels:** Standalone web pilot, including Google Meet by presenting the Airboard tab (the Chrome extension, Meet add-on and Electron desktop app were removed on 12 November 2026)
> **Not supported channels:** Zoom and Microsoft Teams product integrations
> **Payment status:** Checkout is environment-gated and must be described as unavailable until the paid-GA gate passes

This plan separates an implemented capability from an operationally and legally supportable market promise. A page, route, table or provider adapter existing in source code is not by itself launch evidence.

## Release ladder

| Stage | What may be promised | Mandatory decision |
| --- | --- | --- |
| Controlled pilot | Invited or self-signing users may evaluate the standalone web product; preview channels are explicitly labeled; no SLA or certification claim | `pnpm launch:check -- --scope=controlled-pilot` passes |
| Standalone GA | Publicly supported standalone web product on a tested desktop-browser matrix, with approved legal documents, support, monitoring and recovery | `pnpm launch:check -- --scope=standalone-ga` passes |
| Paid GA | Standalone GA plus an approved paid offer and proven live Stripe lifecycle | `pnpm launch:check:paid` passes |

The Chrome public and Desktop public stages, and their `chrome-public` and `desktop-public` launch-check scopes, were removed with the Chrome extension and the Electron app on 12 November 2026. Zoom and Microsoft Teams require their own implementation, identity, client-matrix, store-review, privacy and operational gates. They are outside every current release scope.

## Market truth by journey

### 1. Discovery

- Say: Airboard has a persistent standalone web workspace with pointer and typed input. Voice, gesture and screen capture depend on browser/device capability.
- Say: Airboard works in Google Meet by presenting the Airboard tab, with nothing to install; slides or another app can be shown behind the board from the web app.
- Say: Zoom and Microsoft Teams are planned or design-partner discovery only, not usable integrations.
- Do not say: generally available, certified, compliant, always available, unlimited, enterprise-ready, or covered by an SLA.
- The `/status` page checks the web, API and database from the visitor's browser and lists incidents posted in the last 90 days. It is not an uptime guarantee, and the `public-status-process` gate (a proven incident update process) is still pending.

### 2. Signup and identity

- The pilot signs people in with Google only; it sends no sign-in email.
- The email-link form and a Microsoft button render only when `/auth/config` reports them, and the pilot enables neither.
- A successful identity bootstrap creates a profile, personal organization, owner membership, default workspace, organization policy, trial eligibility and pending entitlement.
- Production OAuth redirects, account recovery and provider logout still need release-environment evidence.

### 3. Onboarding and trial

- The trial duration is one month (30 days), set on 2026-11-05.
- The trial starts at first successful standalone or supported preview activation, not at account creation.
- No card is required for the controlled pilot.
- Paid access is not offered unless `/commercial/config` returns `checkoutEnabled: true` and the paid-GA evidence gate passes.

### 4. Core usage

- Implemented: persistent boards (saves keep no version copies), one Airboards home page, sharing, JSON/image export paths, live sessions, pointer, typed commands, voice/semantic routing, gesture controls, screen underlay and presentation modes.
- Reliability boundary: provider-powered voice requires configured Deepgram; semantic fallback requires configured OpenAI. Deterministic typed commands remain the provider-independent path.
- Deleting a board is immediate and permanent; there is no Trash (RGB-046). Boards soft-deleted before 11 November 2026 are purged by the scheduled lifecycle job after the organization policy window.
- Active boards are not automatically expired.

### 5. Integrations

- Google Meet: present the Airboard tab (**Present now → A tab**); nothing is installed. The Chrome extension and the Meet add-on were removed on 12 November 2026.
- Desktop: no desktop app. **Show a screen behind the board** in the web app covers drawing over other apps; the Electron app was removed on 12 November 2026.
- Zoom: no usable channel.
- Microsoft Teams: no usable channel.
- Google Workspace/Meet add-on work recorded in historical feasibility documents does not change the current public distribution statement.

### 6. Payment

- The API implements Stripe Checkout, signature-verified raw webhooks, idempotent webhook storage, entitlements and billing portal creation.
- The web UI queries `/commercial/config`; when any live billing component is missing, it shows proposed pricing and routes to an evaluation request instead of attempting payment.
- Paid launch additionally requires live-mode journey evidence, approved tax/refund/geography policy, reconciliation and failed-webhook alerting.

### 7. Support, export and deletion

- Users can create a content-free seven-day diagnostic bundle after an explicit action and recorded support-diagnostics consent.
- Users can request a portable JSON export. It includes the requesting profile, memberships, owned boards, consents, support requests, product/audit metadata, notification history and matching lead submissions. It does not export other members’ boards or organization billing records.
- Completed export payloads are cleared after seven days; terminal request metadata is removed after 30 days.
- Account and workspace deletion has a seven-day cancellation window. Account execution deletes user-linked support/analytics/lead data and anonymizes retained audit metadata.

## Data inventory and enforced retention

| Data | Captured/stored | Current enforced retention |
| --- | --- | --- |
| Identity and profile | email, display name, provider identity, locale, timezone, preferences | account lifetime; removed by executed account deletion |
| Organization and access | organization, membership, role, invitations, policy (SSO and SCIM directory configuration is no longer written since 12 November 2026) | organization/account lifetime; provider and directory obligations need contract review |
| Boards | title, description, latest state, visibility, share tokens as hashes (saves no longer write version copies since 12 November 2026) | active until deletion; deletion is immediate and permanent |
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

## What is left, and how to release

What is left before each stage is listed once, in [Project Status](<Project Status.md#what-is-left>); the gate ledger [`ops/launch-evidence.json`](../ops/launch-evidence.json) is the machine-checked source, read by `pnpm launch:check`. A gate is complete only when its status is `verified` and its evidence points to an immutable report, deployment, dashboard, ticket or repository artifact. How to release is in the [Commercial Platform Runbook](<Commercial Platform Runbook.md#release>). Treat any `BLOCK` from the matching launch-check command as a stop-ship, and change public stage labels or enable a distribution or payment channel only after it passes.
