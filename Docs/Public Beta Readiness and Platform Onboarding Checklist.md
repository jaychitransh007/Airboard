# Historical Public Beta and Platform Feasibility Checklist

> **Status:** Historical implementation and feasibility record
> **Last updated:** 2026-07-25
> **Current launch authority:** [`Official Launch Readiness.md`](<Official Launch Readiness.md>)
> **Important:** Statuses below reflect the plan as recorded during the July 2026 feasibility work and are not a current product-support or completion claim.

## How this checklist must be used

This file preserves the original provider-feasibility work and evidence. New commercial release decisions, current channel claims and launch evidence belong in `Official Launch Readiness.md` and `ops/launch-evidence.json`.

- Reference the task ID in the branch, pull request, commit, or implementation notes.
- Update the task status in this file in the same change that implements or verifies the task.
- Mark a task `DONE` only when its acceptance criteria pass and evidence is recorded beneath it.
- If scope changes, update this checklist before continuing. Do not maintain a competing beta plan elsewhere.
- A task blocked by an external review or decision remains unchecked and is marked `BLOCKED`, with the blocker and next action recorded.
- At the end of every completed task, update **Current status**, **Gate scorecard**, and **Change log** when affected.
- Public beta may start only when every mandatory launch gate in this document is checked.

### Status notation

- `[ ] **[NOT STARTED]**` — no implementation work has begun.
- `[ ] **[IN PROGRESS]**` — work has begun but acceptance criteria are not yet met.
- `[ ] **[BLOCKED]**` — progress requires an external decision, approval, or dependency.
- `[x] **[DONE YYYY-MM-DD]**` — acceptance criteria passed and evidence is attached.

### Completion evidence template

Add this beneath a completed task:

```text
  - Acceptance: <what was proven>
  - Evidence: <tests, commands, dashboards, review links, or repository files>
  - Notes: <remaining limitations, if any>
```

## Current status

| Workstream | State | Exit condition |
| --- | --- | --- |
| Verified engineering baseline | Done | Existing build and test evidence recorded below |
| Phase 0 — platform feasibility | In progress — PF-001 complete; PF-002 passes publisher-account Meet discovery, side panel, main stage, live sync, and typed editing; customer-style draft installation and the remaining matrix are blocked | Real-client spikes completed and launch surfaces approved |
| Phase 1 — identity and tenancy | Not started | No client-asserted identity; tenant isolation proven |
| Phase 2 — realtime and persistence | Not started | Ordered, replayable, self-healing collaboration proven |
| Phase 3 — customer onboarding | Not started | Admin and participant onboarding complete end to end |
| Phase 4 — Google Meet | Not started | Production integration and Marketplace review package ready |
| Phase 5 — Microsoft Teams | Not started | Design-partner pilot passes desktop-first support matrix |
| Phase 6 — Zoom | Not started | Approved beta distribution and pilot pass |
| Phase 7 — security, compliance, and operations | Not started | All operational and legal launch gates pass |
| Phase 8 — controlled beta rollout | Not started | Cohort metrics pass with no stop-ship condition |

## Verified engineering baseline

These checks describe the starting point. They do not imply public-beta readiness.

- [x] **[DONE 2026-07-14] BASE-001 — Confirm repository build and type-check health.**
  - Acceptance: API and web packages build and type-check successfully.
  - Evidence: `pnpm` build and type-check commands passed during the 2026-07-14 readiness review.
- [x] **[DONE 2026-07-14] BASE-002 — Confirm automated unit and integration test baseline.**
  - Acceptance: Existing automated test suite passes.
  - Evidence: 188 tests passed during the 2026-07-14 readiness review.
- [x] **[DONE 2026-07-14] BASE-003 — Confirm browser journey baseline.**
  - Acceptance: Existing Playwright journeys pass.
  - Evidence: 6 Playwright end-to-end tests passed during the 2026-07-14 readiness review.
- [x] **[DONE 2026-07-14] BASE-004 — Confirm voice intent regression baseline.**
  - Acceptance: Existing grammar and false-accept suites pass.
  - Evidence: Grammar evaluation passed 168/168 cases; hard false accepts were 0/56 during the 2026-07-14 readiness review.
- [x] **[DONE 2026-07-14] BASE-005 — Confirm platform adapter seam exists.**
  - Acceptance: The product has a platform abstraction and initial Google Meet routes/adapters that can be evolved rather than starting from zero.
  - Evidence: Repository architecture review completed on 2026-07-14.
- [x] **[DONE 2026-07-14] BASE-006 — Record the initial readiness verdict and known gaps.**
  - Acceptance: Authentication, tenancy, realtime recovery, runtime validation, Supabase coverage, onboarding, and incomplete platform adapters are explicitly represented in this plan.
  - Evidence: Tasks below map each identified gap to acceptance criteria.
- [x] **[DONE 2026-07-14] GOV-001 — Adopt this checklist as the public-beta source of truth.**
  - Acceptance: Stable IDs, status rules, completion evidence, launch gates, and a change log are defined.
  - Evidence: This document.

## Phase 0 — Platform feasibility and product commitment

Goal: prove what Airboard can reliably do inside each real meeting client before promising a public support matrix.

- [x] **[DONE 2026-07-14] PF-001 — Define the platform support matrix.**
  - Acceptance: Matrix covers provider, operating system, desktop/web/mobile client, organizer/participant/guest role, side panel/stage surface, camera, microphone, screen sharing, reconnect, breakout rooms, and fallback behavior.
  - Acceptance: All required dimensions are defined, with current evidence separated from candidate, excluded, partial, and not-built support.
  - Evidence: [`Platform Support Matrix.md`](<Platform Support Matrix.md>) records the release channels, OS/client combinations, role mappings, meeting surfaces, media capabilities, lifecycle requirements, breakout behavior, fallbacks, and real-client evidence schema.
  - Notes: No provider-client support was promoted by this task. PF-002–PF-004 must replace candidate entries with real-client results before PF-006 approves the public promise.
- [ ] **[BLOCKED] PF-002 — Run a Google Meet real-client feasibility spike.**
  - Acceptance: Side panel, main stage, identity, media permissions, WebSocket behavior, activity start/join, external participants, and fallback behavior are tested in supported browsers and clients.
  - Progress: Project `project-1217dd57-9cac-491d-b8d` (`634900453473`) is configured with the required Google services. The official SDK is wired to the correct side-panel/main-stage clients; versioned activity data, provider meeting binding, diagnostics, tests, and Cloud Run packaging are implemented. The Public, Trader, Individual + Admin Install App Configuration is now saved against the Airboard HTTP deployment.
  - Progress: On 2026-07-16, the publisher's developer-installed account opened **Meeting tools > Add-ons > Installed > Airboard Pilot** in a real macOS in-app Chromium Meet meeting. The side panel initialized the official SDK, connected live sync with media off, started an activity, opened the main stage, and applied deterministic typed create/connect commands. Leaving, rejoining, reopening Airboard, and starting a fresh activity also worked; previous-board restoration was not proven.
  - Decision: Gesture input is a release-critical Airboard capability, not an optional fallback. Google Meet's Add-ons SDK loads Airboard in cross-origin side-panel/main-stage iframes and exposes activity, meeting metadata, lifecycle, and frame-messaging APIs, but no Meet camera or microphone track. Browser same-origin rules also prevent the Airboard iframe from reading Meet's parent DOM or video element. Airboard must not simulate reuse with a hidden `getUserMedia` capture. The separate Meet Media API is the only Google-supported raw-stream path, but it remains Developer Preview, uses restricted OAuth scopes, and requires the Cloud project, OAuth principal, and every meeting participant to be enrolled. It is therefore not a production-public-beta dependency.
  - Progress: Implemented the Meet media-ownership decision. Meet surfaces cannot start Airboard camera/speech sessions; local media buttons, the `V` mic shortcut, onboarding modal, video preview, media diagnostics, and duplicate side-panel board are removed. The side panel is now a compact launch/status view. Standalone media code remains available only on the standalone surface.
  - Evidence: HTTPS web/API pilot services and the pilot privacy, terms, support, setup, opt-out, and marketplace-asset URLs returned 200. Web type-check, 104 web tests, and the production build passed. Final Cloud Build `e5aa29fd-9f49-4c07-8f85-ff2dc73f6174` succeeded; Cloud Run revision `airboard-pilot-web-00005-lk8` serves 100% of traffic and the Meet, privacy, and setup smoke routes returned 200. Google deployment `projects/634900453473/deployments/airboard-pilot-pf002` reports `installed: true`. The earlier 1280×800 real-client screenshot is `apps/web/public/marketplace/airboard-meet-main-stage-1280x800.jpg` and must be replaced with a clean post-change capture before Save Draft. Listing fields and asset paths are recorded in [`Google Workspace Marketplace Draft Listing.md`](<Google Workspace Marketplace Draft Listing.md>); detailed client results are in [`Google Meet Real-Client Feasibility Spike.md`](<Google Meet Real-Client Feasibility Spike.md>).
  - Decision (2026-07-16, supersedes "Google Meet is the sole media owner on embedded surfaces"): Gesture and voice must ship across Google Meet, Microsoft Teams, and Zoom, so embedded surfaces adopt one cross-platform media policy — capture is explicit, user-initiated, visibly indicated, and never hidden. Where the host client delegates camera/microphone permission to the add-on frame (runtime Permissions Policy probe), gesture/voice run embedded; otherwise a companion window bound to the same board session is the gesture/voice surface. True meeting-stream ingestion (Meet Media API, Teams media bots, Zoom RTMS) is deferred to a later org-opt-in ambient tier and stays out of the public-beta dependency chain.
  - Progress: Implemented the cross-platform media policy. `@airboard/integrations` gained a unit-tested media-capture capability probe (embedded vs companion-only); Meet surfaces restore gesture/voice entry points when the client delegates media permission and otherwise render a one-click companion-window link bound to the live board session (side panel and main stage); pilot privacy/setup/support disclosures updated to match; Playwright guards cover both delegation outcomes, companion-link session binding, no-auto-capture, and standalone regression.
  - Progress: A real macOS Chrome Meet session on revision `airboard-pilot-web-00006-smq` answered the delegation question: the side panel reported companion mode, so **Meet does not delegate camera/microphone permission to add-on iframes** and the embedded delegated path is dead in the current Meet web client. In response, implemented the **Airboard Meet Media Bridge** Chrome extension (`extensions/chrome-meet-bridge`): a meet.google.com content script that, only after an explicit start inside Airboard, captures with the meeting origin's existing camera grant and streams downscaled frames into the add-on iframe over `postMessage` (transferable ImageBitmaps, origin-allowlisted, visible camera indicator, stops on either side). The main-stage board consumes the frames through a canvas capture stream, so the existing MediaPipe tracker, preview, and controls run unchanged — in-Meet gesture with no second permission prompt and no separate window. Voice over the bridge (audio chunks) is the designed fast-follow; typed commands remain the voice fallback meanwhile. Protocol unit tests plus an emulated-bridge Playwright journey (probe → explicit start → frames → tracker active → stop) cover the pipeline.
  - Progress: The 2026-07-16 state audit committed the entire pilot implementation and evidence to `main` (previously uncommitted, so deployed revisions were not reproducible from git history) and closed its code findings: unreadable or legacy Meet activity data no longer strands a meeting (the side panel keeps a fresh-activity path and explains the reset; the main stage fails with the recovery instruction), the Meet media-ownership invariant gained an automated Playwright guard (no media entry points on either Meet surface, zero `getUserMedia` calls observed, typed commands proven usable end to end, standalone media unaffected), and `POST /sessions/start` now validates provider, meeting binding, and title at runtime. Evidence: 204 unit tests, 9 Playwright journeys, grammar 168/168, and 0 hard false accepts pass locally.
  - Risk: The pilot web and API services remain publicly reachable on Cloud Run while identity is client-asserted (`x-airboard-user-id`, hard-coded `local-owner`). This is acceptable only while the pilot holds disposable, non-sensitive data; tear down or gate the Cloud Run services if the pilot pauses. AUTH-001–AUTH-011 close this before any customer data.
  - Blocker: True reuse of Meet's own media stream remains unavailable in GA (the Meet Media API requires Developer Preview enrollment for every participant and restricted-scope verification). Under the superseding 2026-07-16 media policy, embedded gesture/voice depends on the Meet client delegating camera/microphone permission to the add-on frame — an outcome not yet verified in a real Meet client; the companion window is the implemented universal fallback. Customer-style Marketplace distribution, listing uploads, multi-user roles/devices, reconnect/state restoration, and the remaining matrix are also still outstanding. Test users and customers receive no Cloud IAM.
  - Next action: Load the unpacked Meet Media Bridge extension (`extensions/chrome-meet-bridge/README.md`), redeploy the pilot web build, and verify in a real Meet meeting that Enable hands appears on the main stage and gesture tracking runs on the meeting camera. Record companion-link popup behavior from the add-on iframe as the no-extension fallback. Configure `DEEPGRAM_API_KEY` on the pilot API before voice testing. Design bridge audio (voice) as the fast-follow, bring Teams' documented `devicePermissions` media path forward in PF-003, and plan Chrome Web Store publication before any customer-facing extension use. Do not submit the Marketplace listing until these outcomes, disclosures, and the remaining role/device matrix are verified.
- [ ] **[NOT STARTED] PF-003 — Run a Microsoft Teams real-client feasibility spike.**
  - Acceptance: Desktop, web, and mobile constraints are documented, including meeting side panel/stage, SSO, camera/microphone access, roles, guests, and fallback behavior.
- [ ] **[NOT STARTED] PF-004 — Run a Zoom real-client feasibility spike.**
  - Acceptance: Zoom Apps SDK, OAuth, app context, participant roles, in-client media constraints, lifecycle events, and fallback behavior are tested.
- [ ] **[NOT STARTED] PF-005 — Approve fallback behavior for every unsupported capability.**
  - Acceptance: Each failed or partial capability maps to typed input, pointer/touchpad, companion browser, or a clearly blocked flow; no user reaches a dead end.
- [ ] **[NOT STARTED] PF-006 — Approve the public-beta platform promise and release order.**
  - Acceptance: Product, engineering, security, and support sign off on the initial Google-first public promise, Teams/Zoom pilot scope, excluded surfaces, and promotion criteria.
- [ ] **[NOT STARTED] PF-007 — Create separate provider projects/apps for pilot and production.**
  - Acceptance: Google Cloud, Microsoft Entra/Partner Center, and Zoom development/pilot/production assets are isolated with documented owners and credentials.

## Phase 1 — Identity, authorization, and tenant isolation

Goal: every API call, WebSocket connection, session, and stored object is bound to a verified user, installation, organization, and policy.

- [ ] **[NOT STARTED] AUTH-001 — Define the identity and tenancy data model.**
  - Acceptance: Organizations, members, installations, provider accounts, meetings, sessions, roles, policies, invitations, and revocations have explicit schemas and ownership rules.
- [ ] **[NOT STARTED] AUTH-002 — Define a provider-neutral verified launch-context contract.**
  - Acceptance: Server-issued context includes provider, tenant/account, meeting, user, role, installation, expiry, nonce, and permitted capabilities.
- [ ] **[NOT STARTED] AUTH-003 — Implement and verify Google identity exchange.**
  - Acceptance: Google tokens and Meet activity context are validated server-side; tenant, user, meeting, role, issuer, audience, expiry, and nonce checks fail closed.
- [ ] **[NOT STARTED] AUTH-004 — Implement and verify Microsoft identity exchange.**
  - Acceptance: Entra multi-tenant SSO tokens and Teams meeting context are validated server-side and mapped to Airboard membership and policy.
- [ ] **[NOT STARTED] AUTH-005 — Implement and verify Zoom identity exchange.**
  - Acceptance: OAuth tokens and verified/decrypted Zoom App Context are validated server-side and mapped to account, user, meeting, role, and installation.
- [ ] **[NOT STARTED] AUTH-006 — Remove client-asserted and hard-coded identity.**
  - Acceptance: No production path trusts hard-coded users, participant IDs, organization IDs, or headers such as `x-airboard-user-id` supplied by the browser.
- [ ] **[NOT STARTED] AUTH-007 — Issue short-lived participant session tokens.**
  - Acceptance: Tokens are server-signed, scoped to one installation/meeting/session/role, expire promptly, and can be revoked.
- [ ] **[NOT STARTED] AUTH-008 — Protect WebSocket admission with single-use tickets.**
  - Acceptance: Participant identity is not trusted from the URL; replay, expiry, session mismatch, and revoked membership are rejected.
- [ ] **[NOT STARTED] AUTH-009 — Authorize all session, trace, metrics, and administrative routes.**
  - Acceptance: A route inventory proves authentication, role checks, tenant scoping, and safe error behavior for every non-public endpoint.
- [ ] **[NOT STARTED] AUTH-010 — Implement database row-level security and least-privilege grants.**
  - Acceptance: Provider credentials, application roles, policies, and migrations prevent cross-tenant reads/writes even when application checks fail.
- [ ] **[NOT STARTED] AUTH-011 — Add tenant-isolation, revocation, and uninstall security tests.**
  - Acceptance: Automated negative tests cover cross-organization IDs, forged roles, expired/replayed tickets, removed users, disabled installations, and deleted accounts with zero unauthorized success.

## Phase 2 — Realtime correctness and persistence

Goal: collaboration remains ordered, recoverable, and convergent across network loss, reconnects, process restarts, and concurrent writers.

- [ ] **[NOT STARTED] RT-001 — Define strict runtime schemas for every board event.**
  - Acceptance: Event type, payload, identifiers, numeric bounds, timestamps, enums, and protocol version are validated before processing or persistence.
- [ ] **[NOT STARTED] RT-002 — Enforce payload, batch, point-count, and rate limits.**
  - Acceptance: Oversized or abusive messages fail safely without excessive memory, compute, storage, or fan-out cost.
- [ ] **[NOT STARTED] RT-003 — Canonicalize security-sensitive event fields on the server.**
  - Acceptance: Session, board, actor, organization, sequence, and authoritative timestamps cannot be forged by clients.
- [ ] **[NOT STARTED] RT-004 — Add event IDs and idempotent ingestion.**
  - Acceptance: Retries and reconnects cannot duplicate committed mutations.
- [ ] **[NOT STARTED] RT-005 — Add monotonic server sequence allocation.**
  - Acceptance: Sequences are atomically assigned per board/session with no duplicates or gaps caused by concurrent writers.
- [ ] **[NOT STARTED] RT-006 — Close the join snapshot-to-subscription race.**
  - Acceptance: The join protocol establishes an explicit snapshot sequence and replays every later event before live delivery.
- [ ] **[NOT STARTED] RT-007 — Implement replay and catch-up by sequence.**
  - Acceptance: Clients can request a bounded event range and deterministically reach the current server sequence.
- [ ] **[NOT STARTED] RT-008 — Implement acknowledgement and rejection semantics.**
  - Acceptance: Clients know whether an optimistic mutation committed, was deduplicated, or was rejected and can reconcile UI state.
- [ ] **[NOT STARTED] RT-009 — Queue safe outbound work during transient disconnects.**
  - Acceptance: Bounded retry policy, ordering, expiry, duplicate handling, and user feedback are defined and tested.
- [ ] **[NOT STARTED] RT-010 — Detect gaps and automatically resynchronize.**
  - Acceptance: Clients identify sequence gaps, pause unsafe application, catch up or reload a snapshot, and converge without manual refresh.
- [ ] **[NOT STARTED] RT-011 — Add realtime chaos and convergence tests.**
  - Acceptance: Tests cover packet loss, duplication, reordering, delayed delivery, reconnect, tab sleep, server restart, and concurrent editing with zero final-state divergence.
- [ ] **[NOT STARTED] DATA-001 — Fix Supabase heartbeat/session scoping.**
  - Acceptance: Heartbeats update only the intended participant in the intended organization, meeting, and session.
- [ ] **[NOT STARTED] DATA-002 — Create sessions and owners atomically.**
  - Acceptance: Partial session creation cannot leave an ownerless or inaccessible session.
- [ ] **[NOT STARTED] DATA-003 — Add Supabase-backed integration tests.**
  - Acceptance: Migrations, RLS, session lifecycle, event ordering, heartbeat, replay, retention, and tenant isolation run in CI against a real disposable database.
- [ ] **[NOT STARTED] DATA-004 — Implement snapshots, compaction, and retention.**
  - Acceptance: Large boards join within the latency target, event history remains recoverable for the configured window, and deletion/retention policies are enforced.
- [ ] **[NOT STARTED] DATA-005 — Prove backup and restore preserves board integrity.**
  - Acceptance: A staged restore recovers tenants, sessions, snapshots, event sequences, and audit records within defined RPO/RTO.

## Phase 3 — Customer and participant onboarding

Goal: an administrator can install Airboard safely, and a participant can become productive in a meeting without assisted setup.

### Organization and administrator onboarding

- [ ] **[NOT STARTED] ONB-001 — Build the install landing page and provider selector.**
  - Acceptance: Customers can choose standalone, Google Meet, Microsoft Teams, or Zoom and see availability, prerequisites, permissions, and supported-client limitations before consent.
- [ ] **[NOT STARTED] ONB-002 — Build organization provisioning and administrator consent.**
  - Acceptance: Verified admin creates or joins an organization, installs the provider app, grants minimum scopes, chooses owners/support contacts, and receives a success receipt.
- [ ] **[NOT STARTED] ONB-003 — Build the organization policy console.**
  - Acceptance: Admin can control allowed providers/domains, meeting creation, external guests, recording/artifact retention, voice/camera features, exports, deletion, and uninstall.
- [ ] **[NOT STARTED] ONB-004 — Build a preflight test meeting.**
  - Acceptance: Admin can verify launch, identity, WebSocket, policy, camera/microphone, board sync, export, and fallback without involving a real customer meeting.
- [ ] **[NOT STARTED] ONB-005 — Build installation health and diagnostics.**
  - Acceptance: Admin can see provider connection, token/scopes, webhook/context health, last successful launch, configuration errors, and actionable remediation.

### In-meeting participant onboarding

- [ ] **[NOT STARTED] ONB-006 — Add an in-context privacy and media disclosure.**
  - Acceptance: Before camera/microphone use, participants see what is processed, where it is processed/stored, retention, controls, and a non-media fallback.
- [ ] **[NOT STARTED] ONB-007 — Add input-mode selection and permission diagnostics.**
  - Acceptance: Gesture, voice, pointer/touchpad, and typed input are offered according to policy and client capability; denied permissions produce clear recovery steps.
- [ ] **[NOT STARTED] ONB-008 — Add calibration and a guided practice action.**
  - Acceptance: The user calibrates applicable input, creates and undoes a sample object, sees confidence/feedback, and can retry or choose another input mode.
- [ ] **[NOT STARTED] ONB-009 — Guarantee a keyboard/pointer fallback on every supported surface.**
  - Acceptance: Core create, select, move, edit, undo, and delete actions remain usable without camera or microphone.
- [ ] **[NOT STARTED] ONB-010 — Add role-aware first-run guidance and accessible help.**
  - Acceptance: Organizer, presenter, participant, guest, keyboard-only, screen-reader, reduced-motion, and low-bandwidth flows receive appropriate guidance.
- [ ] **[NOT STARTED] ONB-011 — Add post-meeting artifact controls.**
  - Acceptance: Authorized users can find, export, share, retain, or delete the board; unauthorized roles cannot access it after the meeting.
- [ ] **[NOT STARTED] ONB-012 — Add disconnect, uninstall, revocation, and account-closure flows.**
  - Acceptance: Admin can remove provider access and Airboard data according to policy, with confirmation, audit history, and no orphaned credentials.
- [ ] **[NOT STARTED] ONB-013 — Measure onboarding funnel and failure reasons.**
  - Acceptance: Analytics cover install start/success, consent failure, test-meeting pass, meeting launch, permission decision, calibration pass, first successful object, fallback choice, and abandonment without capturing sensitive content.

## Phase 4 — Google Meet public-beta integration

Goal: deliver the first production-grade in-meeting distribution channel and pass Google review.

- [ ] **[NOT STARTED] GMEET-001 — Replace adapter stubs with the production Google Meet Add-ons SDK integration.**
  - Acceptance: Official SDK types and supported lifecycle APIs are used; test mocks are isolated from production code.
- [ ] **[NOT STARTED] GMEET-002 — Configure deployment descriptors, origins, CSP, and production HTTPS endpoints.**
  - Acceptance: Side-panel and main-stage URLs, add-on manifest, allowed origins, frame policy, and CSP pass production validation.
- [ ] **[NOT STARTED] GMEET-003 — Implement server-verified Google sign-in and installation mapping.**
  - Acceptance: Launches resolve to the correct organization, installation, user, meeting, and role without client assertion.
- [ ] **[NOT STARTED] GMEET-004 — Implement organizer start flow from the side panel.**
  - Acceptance: `startActivity` uses an opaque, short-lived activity token and presents policy, readiness, and fallback status before starting.
- [ ] **[NOT STARTED] GMEET-005 — Implement participant join flow from activity starting state.**
  - Acceptance: Joiners securely resolve the current Airboard session, catch up to the authoritative sequence, and handle missing/expired activity state.
- [ ] **[NOT STARTED] GMEET-006 — Implement Meet roles, external participants, and policy decisions.**
  - Acceptance: Organizer, co-host, participant, anonymous/external, removed, and rejoining users receive explicitly tested capabilities.
- [ ] **[NOT STARTED] GMEET-007 — Implement Meet lifecycle recovery.**
  - Acceptance: Activity end, user removal, meeting end, tab close, reconnect, duplicate launch, and stale sessions are handled safely.
- [ ] **[NOT STARTED] GMEET-008 — Implement participant installation and unavailable-client guidance.**
  - Acceptance: Users without the add-on or on an unsupported surface receive a valid installation or companion-browser path.
- [ ] **[NOT STARTED] GMEET-009 — Complete the Google Meet device and role test matrix.**
  - Acceptance: Every promised browser/client, operating system, role, permission state, guest state, and network condition passes or is explicitly excluded.
- [ ] **[NOT STARTED] GMEET-010 — Prepare Marketplace listing and OAuth verification assets.**
  - Acceptance: Production name, icons, screenshots, demo video, support links, privacy/terms, scopes justification, test credentials, reviewer steps, and data-use disclosures are complete.
- [ ] **[NOT STARTED] GMEET-011 — Submit and close Google review findings.**
  - Acceptance: Marketplace and OAuth reviews are approved with no unresolved launch-blocking finding.
- [ ] **[NOT STARTED] GMEET-012 — Enable controlled Google production rollout.**
  - Acceptance: Cohort allowlist, feature flags, rollback, kill switch, support ownership, dashboards, and quotas are verified before invitations are sent.

## Phase 5 — Microsoft Teams design-partner pilot

Goal: prove a desktop-first Teams experience with selected tenants before committing to Teams Store availability.

- [ ] **[NOT STARTED] TEAMS-001 — Register the Teams app and create valid manifests/packages.**
  - Acceptance: Development, pilot, and production identities, URLs, permissions, domains, icons, and meeting contexts are isolated and validated.
- [ ] **[NOT STARTED] TEAMS-002 — Integrate the supported Teams JavaScript SDK and meeting context.**
  - Acceptance: Initialization, context, theme, locale, lifecycle, and error handling work on every pilot surface.
- [ ] **[NOT STARTED] TEAMS-003 — Implement Entra multi-tenant SSO and server validation.**
  - Acceptance: Tenant/admin consent, token exchange, issuer/audience/nonce validation, organization mapping, and revocation pass negative tests.
- [ ] **[NOT STARTED] TEAMS-004 — Implement the meeting side-panel organizer experience.**
  - Acceptance: Authorized organizers can create/select an Airboard session and see readiness, policy, participant, and fallback status.
- [ ] **[NOT STARTED] TEAMS-005 — Implement share-to-stage and participant join.**
  - Acceptance: Stage sharing, join context, resource-specific consent where required, roles, and synchronized session admission are secure and recoverable.
- [ ] **[NOT STARTED] TEAMS-006 — Handle guests, external tenants, roles, and meeting lifecycle.**
  - Acceptance: Organizer, presenter, attendee, anonymous/guest, removed, rejoining, and meeting-ended cases have tested policies.
- [ ] **[NOT STARTED] TEAMS-007 — Complete the Teams desktop-first device matrix.**
  - Acceptance: Windows/macOS desktop behavior passes; web/mobile are either verified or clearly excluded with companion-browser fallback.
- [ ] **[NOT STARTED] TEAMS-008 — Validate camera/microphone and fallback feasibility in real clients.**
  - Acceptance: Media capabilities are documented by client; unsupported gesture/voice modes never block pointer/typed participation.
- [ ] **[NOT STARTED] TEAMS-009 — Run a custom-app pilot with 3–5 consenting tenants.**
  - Acceptance: Tenant admin upload/approval, meeting launch, onboarding, reliability, support, uninstall, and pilot metrics pass.
- [ ] **[NOT STARTED] TEAMS-010 — Prepare Partner Center and Teams Store review package.**
  - Acceptance: Listing, validation, privacy, permissions, support, test instructions, security evidence, and production naming comply with current policies.
- [ ] **[NOT STARTED] TEAMS-011 — Decide Teams public-beta graduation.**
  - Acceptance: Pilot evidence meets the same security, reliability, product, and operations gates as Google; otherwise Teams remains a design-partner pilot.

## Phase 6 — Zoom controlled beta

Goal: distribute through Zoom's approved beta path, validate the in-client experience, and prepare Marketplace review.

- [ ] **[NOT STARTED] ZOOM-001 — Register the Zoom App and isolate development/pilot/production configuration.**
  - Acceptance: OAuth redirect URLs, allowlists, scopes, SDK keys, secrets, owners, and environments are documented and separated.
- [ ] **[NOT STARTED] ZOOM-002 — Integrate the supported Zoom Apps SDK.**
  - Acceptance: Initialization, capability checks, context, lifecycle events, and errors work on every pilot client.
- [ ] **[NOT STARTED] ZOOM-003 — Implement OAuth token security and lifecycle.**
  - Acceptance: State/PKCE where applicable, encrypted storage, minimum scopes, refresh, rotation, revocation, and uninstall behavior pass tests.
- [ ] **[NOT STARTED] ZOOM-004 — Verify and decrypt Zoom App Context server-side.**
  - Acceptance: Account, user, meeting, role, installation, issuer, expiry, and tamper checks fail closed.
- [ ] **[NOT STARTED] ZOOM-005 — Implement host start and participant collaboration flows.**
  - Acceptance: Host creates/selects a session; participants securely join the same authoritative board with correct permissions.
- [ ] **[NOT STARTED] ZOOM-006 — Handle Zoom roles, guests, breakout rooms, and lifecycle.**
  - Acceptance: Host, co-host, participant, guest, removed/rejoining, breakout transition, and meeting-ended cases are explicitly tested.
- [ ] **[NOT STARTED] ZOOM-007 — Complete the Zoom client and device matrix.**
  - Acceptance: Every promised operating system/client and camera/microphone state passes or has a documented fallback/exclusion.
- [ ] **[NOT STARTED] ZOOM-008 — Obtain approval for external beta distribution.**
  - Acceptance: Authorization URL/beta sharing configuration, tester limits, validity window, and reviewer requirements are approved and recorded.
- [ ] **[NOT STARTED] ZOOM-009 — Run a controlled Zoom design-partner pilot.**
  - Acceptance: Installation, meeting launch, onboarding, reliability, support, revocation, and uninstall pass with selected accounts.
- [ ] **[NOT STARTED] ZOOM-010 — Prepare and submit Marketplace technical/security review.**
  - Acceptance: Listing, scopes, privacy/terms, security evidence, test instructions, support, and remediation responses are complete.
- [ ] **[NOT STARTED] ZOOM-011 — Decide Zoom public-beta graduation.**
  - Acceptance: Pilot evidence meets the same security, reliability, product, and operations gates as Google; otherwise Zoom remains a controlled pilot.

## Phase 7 — Security, privacy, compliance, and operations

Goal: operate the beta as a real customer-facing service with controlled risk, observable health, and recoverable failure modes.

### Security and privacy

- [ ] **[NOT STARTED] SEC-001 — Complete threat model and data-flow inventory.**
  - Acceptance: Trust boundaries, provider tokens, media processing, board content, telemetry, storage, exports, third parties, abuse cases, and mitigations are reviewed.
- [ ] **[NOT STARTED] SEC-002 — Move all secrets to managed secret storage and define rotation.**
  - Acceptance: No shared production token or credential is shipped to clients, committed to the repository, or reused across environments.
- [ ] **[NOT STARTED] SEC-003 — Harden edge, proxy, CORS, CSP, and transport configuration.**
  - Acceptance: Trusted-proxy behavior, TLS, secure cookies, origin rules, framing, CSP, WebSocket origins, headers, and redirect allowlists pass review.
- [ ] **[NOT STARTED] SEC-004 — Add abuse, quota, and cost controls.**
  - Acceptance: Per-IP/user/org/meeting limits, payload ceilings, concurrency limits, circuit breakers, provider quotas, and spend alerts are enforced.
- [ ] **[NOT STARTED] SEC-005 — Add immutable security and administrative audit events.**
  - Acceptance: Install, consent, policy, role, session, export, deletion, revocation, and admin actions are attributable and tenant-scoped.
- [ ] **[NOT STARTED] SEC-006 — Add automated security checks to CI.**
  - Acceptance: Dependency, secret, static analysis, container/image, license, migration, and dynamic API checks block releases at agreed severity.
- [ ] **[NOT STARTED] SEC-007 — Complete independent penetration testing and remediation.**
  - Acceptance: No open critical/high finding; accepted lower risks have owner, rationale, and deadline.
- [ ] **[NOT STARTED] PRIV-001 — Publish privacy notice, terms, and subprocessor list.**
  - Acceptance: Documents accurately cover provider data, board content, media processing, telemetry, purpose, location, retention, sharing, and customer controls.
- [ ] **[NOT STARTED] PRIV-002 — Implement consent, retention, export, deletion, and DSAR workflows.**
  - Acceptance: Policies are enforced end to end and verified against primary data, backups, logs, exports, and provider revocation.
- [ ] **[NOT STARTED] PRIV-003 — Prepare DPA, incident response, and breach-notification process.**
  - Acceptance: Owners, legal review, escalation path, evidence preservation, notification timelines, and customer communication templates are approved.

### Reliability and operations

- [ ] **[NOT STARTED] OPS-001 — Establish production hosting and environment isolation.**
  - Acceptance: Production, staging, pilot, and development data/credentials are separate; infrastructure configuration and ownership are documented.
- [ ] **[NOT STARTED] OPS-002 — Add health, readiness, and dependency checks.**
  - Acceptance: Deployments do not receive traffic before ready; database, realtime, storage, and provider dependency failures are visible.
- [ ] **[NOT STARTED] OPS-003 — Create service-level dashboards and tracing.**
  - Acceptance: Availability, join success/latency, event latency, reconnect, divergence/resync, errors, saturation, provider failures, onboarding, and cost are tenant-safe and queryable.
- [ ] **[NOT STARTED] OPS-004 — Configure actionable alerts and on-call ownership.**
  - Acceptance: Each launch SLI and stop-ship condition has a tested alert, severity, owner, escalation, and runbook.
- [ ] **[NOT STARTED] OPS-005 — Publish status and support operations.**
  - Acceptance: Status page, support contact, hours, severity definitions, response targets, escalation, known-issues page, and customer communication process exist.
- [ ] **[NOT STARTED] OPS-006 — Test backup, restore, disaster recovery, and rollback.**
  - Acceptance: Restore and rollback drills meet approved RPO/RTO; deployment and migration rollback are proven on staging.
- [ ] **[NOT STARTED] OPS-007 — Implement feature flags, provider kill switches, and safe degradation.**
  - Acceptance: Gesture, voice, provider launch, exports, writes, and high-cost features can be disabled independently without losing existing customer data.
- [ ] **[NOT STARTED] OPS-008 — Pass load, soak, and capacity tests at 2× beta forecast.**
  - Acceptance: Latency, error, memory, CPU, connection, database, storage, provider quota, and cost targets pass under sustained and burst load.
- [ ] **[NOT STARTED] OPS-009 — Create release checklist and production change controls.**
  - Acceptance: Required tests, migrations, approvals, canary, rollback, observability, incident commander, and post-release verification are documented and exercised.

## Phase 8 — Controlled public-beta rollout

Goal: expand only when measured customer outcomes and operational health remain inside the gates.

- [ ] **[NOT STARTED] BETA-001 — Finalize beta cohort, success metrics, telemetry, and consent.**
  - Acceptance: Ideal customer profile, exclusions, meeting volume, data collection, feedback cadence, support expectations, and exit criteria are approved.
- [ ] **[NOT STARTED] BETA-002 — Complete internal dogfood across at least 20 representative meetings.**
  - Acceptance: Roles, device matrix, network impairment, long meetings, reconnect, fallback, export/delete, and incident drills pass without a stop-ship issue.
- [ ] **[NOT STARTED] BETA-003 — Complete a Google design-partner pilot.**
  - Acceptance: At least 5 organizations and 100 representative meetings meet onboarding, product, reliability, security, support, and retention targets.
- [ ] **[NOT STARTED] BETA-004 — Pass the security and privacy launch gate.**
  - Acceptance: Every mandatory security/privacy item in the gate scorecard is checked and evidence is linked.
- [ ] **[NOT STARTED] BETA-005 — Pass the reliability and data-integrity launch gate.**
  - Acceptance: Every mandatory reliability item in the gate scorecard is checked and load/chaos/restore evidence is linked.
- [ ] **[NOT STARTED] BETA-006 — Pass the product and onboarding launch gate.**
  - Acceptance: Every mandatory product item in the gate scorecard is checked and pilot metrics meet thresholds.
- [ ] **[NOT STARTED] BETA-007 — Pass the operations and compliance launch gate.**
  - Acceptance: Every mandatory operations/compliance item in the gate scorecard is checked and incident/support drills pass.
- [ ] **[NOT STARTED] BETA-008 — Obtain required Google production approvals.**
  - Acceptance: Marketplace/OAuth review is approved and production quotas, listing, support, and rollback controls are live.
- [ ] **[NOT STARTED] BETA-009 — Launch cohort 1 under an organization allowlist.**
  - Acceptance: Initial invited cohort runs for one week with daily review and no unresolved stop-ship condition.
- [ ] **[NOT STARTED] BETA-010 — Expand cohorts through documented go/no-go reviews.**
  - Acceptance: Each expansion records metrics, incidents, support load, cost, known limitations, rollback readiness, and approvers.
- [ ] **[NOT STARTED] BETA-011 — Publish the beta support matrix and known limitations.**
  - Acceptance: Customer-facing documentation exactly matches tested providers, clients, roles, input modes, fallbacks, retention, support, and service commitments.

## Mandatory public-beta gate scorecard

Every item below is a stop-ship gate for the Google-first public beta unless the item explicitly applies only to a later platform.

### Security and privacy gates

- [ ] No production route or WebSocket trusts client-asserted identity, tenant, role, meeting, or participant ID.
- [ ] Cross-tenant automated tests produce zero unauthorized reads, writes, joins, exports, or administrative actions.
- [ ] Database RLS and least-privilege roles are enabled and tested in the production persistence path.
- [ ] No unresolved critical or high security finding exists.
- [ ] Provider disconnect, member revocation, uninstall, export, retention, and deletion work end to end.
- [ ] Privacy notice, terms, DPA, subprocessor list, consent, and incident process are approved.

### Reliability and data-integrity gates

- [ ] Chaos tests produce zero unrecovered final-state divergence.
- [ ] p95 remote event visibility is at or below 300 ms under the approved beta load profile.
- [ ] p95 meeting-session join is at or below 5 seconds for compacted boards at the approved size limit.
- [ ] Reconnect/resync succeeds automatically in at least 99% of injected transient-failure cases.
- [ ] Crash-free meeting sessions are at least 99.5% during the design-partner pilot.
- [ ] Service availability is at least 99.9% during the final two pilot weeks, excluding documented provider-wide outages.
- [ ] Load and soak tests pass at 2× forecast beta concurrency with quota and cost headroom.
- [ ] Backup, restore, migration rollback, and provider kill switches have been exercised successfully.

### Product and onboarding gates

- [ ] At least 80% of eligible invited admins complete installation and the test meeting without staff intervention.
- [ ] Median time from first participant launch to first successful board object is below 60 seconds.
- [ ] At least 95% of representative pilot meetings sustain a usable synchronized board for five minutes or longer.
- [ ] Gesture calibration succeeds for at least 85% of users who choose gesture input on a supported device.
- [ ] Voice intent success meets the approved command-suite threshold and hard destructive-command false accepts remain zero.
- [ ] Keyboard/pointer or typed fallback supports the core workflow on every advertised platform surface.
- [ ] Accessibility, guest, external participant, denied-permission, low-bandwidth, reconnect, and post-meeting flows are tested.

### Operations and support gates

- [ ] Production dashboards, alerts, traces, audit logs, status page, and on-call rotation are live.
- [ ] Severity runbooks, rollback, incident communications, and customer-support escalation have passed a drill.
- [ ] Support response targets, beta terms, support matrix, known limitations, and data-handling documentation are published.
- [ ] Cohort flags, quotas, cost alerts, and per-provider kill switches are verified in production.
- [ ] Marketplace/review approvals required for the active distribution path are complete.

## Stop-ship conditions

Pause new invitations and disable the affected capability or provider when any of these occurs:

- Any confirmed cross-tenant access, privilege escalation, credential exposure, or forged meeting admission.
- Board corruption or client divergence that cannot automatically recover without losing acknowledged work.
- A hard false accept that triggers a destructive or externally visible voice action.
- An unresolved critical/high vulnerability or provider security-review finding.
- Failure to honor revocation, uninstall, retention, export, or deletion obligations.
- Sustained SLI breach, uncontrolled cost/quota growth, or an incident without an effective rollback/kill switch.
- A provider policy or technical change that invalidates the published support matrix.

## Promotion policy for Teams and Zoom

Teams and Zoom remain design-partner pilots until their platform-specific sections are complete and they independently pass the same gate scorecard used for Google Meet. Passing the Google launch does not automatically qualify another provider.

## Working sequence and indicative timeline

The sequence is dependency-based; dates must be added only after Phase 0 feasibility is complete.

1. Phase 0: platform feasibility and public promise.
2. Phases 1–2: identity/tenancy and realtime/data foundations.
3. Phase 3: administrator and participant onboarding.
4. Phases 4 and 7: Google Meet production integration plus security/operations/compliance.
5. Phase 8: dogfood, design-partner pilot, review approval, and controlled Google public beta.
6. Phases 5–6: Teams and Zoom pilots, then independent graduation decisions.

Planning assumption: a Google-first beta is approximately 10–12 weeks with about four engineers, QA, and part-time product/design/security support after Phase 0 confirms feasibility. Public availability across all three providers should be planned sequentially and is more likely an 18–24 week program. These are estimates, not commitments.

## Official platform references

Review these sources again when each provider task starts because policies and SDK capabilities change.

### Google Meet

- [Publish a Google Workspace add-on](https://developers.google.com/workspace/marketplace/how-to-publish)
- [Choose a Google Workspace Marketplace visibility option](https://developers.google.com/workspace/marketplace/enable-configure-sdk)
- [Build the main stage and side panel](https://developers.google.com/workspace/meet/add-ons/guides/build-main-stage-side-panel)
- [Collaborate with a Google Meet add-on](https://developers.google.com/workspace/meet/add-ons/guides/collaborate)
- [Google Workspace Marketplace review](https://developers.google.com/workspace/marketplace/about-app-review)

### Microsoft Teams

- [Build tabs for meetings](https://learn.microsoft.com/microsoftteams/platform/apps-in-teams-meetings/build-tabs-for-meeting)
- [Configure Teams tab SSO](https://learn.microsoft.com/microsoftteams/platform/tabs/how-to/authentication/tab-sso-overview)
- [Publish an app to the Microsoft commercial marketplace](https://learn.microsoft.com/microsoftteams/platform/concepts/deploy-and-publish/appsource/publish)
- [Teams Store validation guidelines](https://learn.microsoft.com/microsoftteams/platform/concepts/deploy-and-publish/appsource/prepare/teams-store-validation-guidelines)

### Zoom

- [Zoom App development lifecycle and beta testing](https://developers.zoom.us/docs/zoom-apps/zoom-apps-lifecycle/)
- [Zoom Apps SDK reference](https://developers.zoom.us/docs/zoom-apps/zoom-apps-sdk/)
- [Zoom App Context](https://developers.zoom.us/docs/zoom-apps/zoom-app-context/)
- [Submit an app to the Zoom App Marketplace](https://developers.zoom.us/docs/distribute/app-marketplace/submit/)

## Change log

| Date | Task IDs | Change | Resulting status |
| --- | --- | --- | --- |
| 2026-07-14 | BASE-001–BASE-006, GOV-001 | Created the authoritative checklist, recorded verified engineering baseline, platform onboarding model, work phases, launch gates, and stop-ship policy. | Phase 0 is next; system is not ready for public beta. |
| 2026-07-14 | PF-001 | Defined the platform support matrix and evidence schema, including explicit candidate, partial, excluded, and not-built states. | Phase 0 in progress; PF-002 Google Meet real-client feasibility is next. |
| 2026-07-14 | PF-002 | Audited Google Meet spike prerequisites and created the real-client execution/evidence runbook. | Blocked: Google pilot project, Workspace test tenant, and public HTTPS deployment are required. |
| 2026-07-15 | PF-002 | Enabled required Google services; installed SDK 1.2.0; implemented Meet runtime/activity wiring; deployed Cloud Run web/API pilot; created and installed Google deployment `airboard-pilot-pf002`; passed local/build/host smoke checks. | Blocked only on signed-in Meet execution and the required role/device test identities. |
| 2026-07-16 | PF-002 | Started a signed-in private Meet meeting with media disabled and checked Meeting tools > Add-ons. Airboard was absent; the Meet account and active `gcloud` developer-installation account are different identities. | Blocked on aligning the installation/client identity, then the remaining role/device matrix. |
| 2026-07-16 | PF-002 | Replaced the developer-IAM shortcut with a realistic distribution requirement: the publisher configures a public Marketplace draft, adds tester emails centrally, and users install from Marketplace without Cloud access. Prepared the proposed listing/configuration worksheet and recorded owner-only inputs. | Blocked on Marketplace draft configuration and required owner/legal fields; customers will not receive project IAM. |
| 2026-07-16 | PF-002 | Opened the Marketplace SDK as the project owner and prepared Public, Individual + Admin Install, Google Workspace add-on, HTTP deployment, default identity scopes, and pilot developer/site fields without saving. | Blocked before the irreversible first save on Trader/Non-trader classification, developer contact approval, and Public visibility confirmation. |
| 2026-07-16 | PF-002 | Owner confirmed Public visibility and developer contact. Classified Airboard as Trader because it is intended as a product for individuals and organizations, and entered all remaining App Configuration fields except the public Trader mailing address. | Blocked before Save Draft only on direct entry of the Marketplace-visible mailing address. |
| 2026-07-16 | PF-002 | Saved Public Trader App Configuration; deployed pilot privacy, terms, support, setup, and opt-out pages; prepared required raster assets; and passed real Meet publisher-account discovery, side-panel SDK initialization, activity launch, main-stage live sync, typed create/connect commands, and a leave/rejoin/relaunch smoke test with media off. Populated the worldwide, free-of-charge Store Listing and draft tester without submitting for review. | Store Listing save and customer-style draft installation are blocked only on selecting four prepared local assets through Google's native file pickers; the remaining role/device/media/lifecycle matrix remains open. |
| 2026-07-16 | PF-002 | Made Google Meet the sole media owner on embedded surfaces: blocked Airboard camera/speech starts, removed media controls/onboarding/video/diagnostics, replaced the duplicate side-panel board with a compact launch view, updated pilot disclosures, passed type-check/104 tests/build, and deployed revision `airboard-pilot-web-00005-lk8`. | Implementation passes; fresh real-client visual/no-permission verification, a replacement listing screenshot, listing copy refresh/uploads/save, draft-tester install, and the remaining matrix are open. |
| 2026-07-16 | PF-002 | Reclassified Meet-sourced gesture input as release-critical after real-client review. Confirmed the Add-ons SDK exposes no Meet media track and rejected hidden `getUserMedia` as false stream reuse; the separate Meet Media API remains Developer Preview with restricted scopes and all-participant enrollment. | Google Meet is blocked from a gesture-enabled production/public-beta promise until Google offers a suitable GA media contract or product explicitly accepts a separate camera/companion path. |
| 2026-07-16 | PF-002 | State audit: committed the pilot implementation and evidence to version control; corrected stale support-matrix and listing-screenshot statements; added stale-activity recovery on Meet surfaces, a Playwright regression guard for the media-ownership invariant, and runtime validation of `/sessions/start` provider fields; recorded the public pilot exposure risk. | PF-002 remains blocked on the Meet media contract. Evidence is now reproducible from git history; 204 unit tests and 9 Playwright journeys pass. |
| 2026-07-16 | PF-002 | Product superseded the Meet-sole-media-owner rule with a cross-platform explicit-capture policy (Meet, Teams, Zoom): embedded gesture/voice where the host delegates media permission, companion window otherwise, hidden capture still rejected, meeting-stream ingestion deferred to an org-opt-in ambient tier. Implemented the delegation probe, conditional Meet media entry points, companion-window flow, disclosure updates, and e2e coverage of both outcomes. | Real-client delegation outcome, companion popup behavior in the add-on iframe, and the remaining role/device matrix are open; pilot API still needs transcription credentials for voice. |
| 2026-07-16 | PF-002 | Deployed the media-policy build: Cloud Build `b2130719-7ab9-4a1a-ae64-825e2cdf6ae6` produced image `web:pf002-media-policy-665ca80` (traceable to commit `665ca80`); Cloud Run revision `airboard-pilot-web-00006-smq` serves 100% of traffic. Smoke: `/`, Meet surfaces, and pilot pages returned 200; updated disclosures are live; the e2e harness route correctly returns 404 in production. | Next real Meet session must record the delegation outcome (side-panel media card wording) and companion-link behavior from the add-on iframe. |
| 2026-07-16 | PF-002 | Real-client result: Meet does not delegate media permission to add-on iframes (side panel showed companion mode on revision 00006). Implemented the Meet Media Bridge Chrome extension — explicit-start capture on the meeting origin streamed into the add-on iframe — restoring in-Meet gesture with no second prompt and no separate window; protocol unit tests and an emulated-bridge e2e journey pass. | Real-meeting verification with the unpacked extension, bridge audio for voice, and Chrome Web Store publication are the open items; 214 unit tests and 13 Playwright journeys pass. |
| 2026-07-16 | PF-002 | Deployed the bridge build: Cloud Build `26bc7898-574d-44c2-9f5c-5e3c58d3988a` produced image `web:pf002-meet-bridge-22de2da` (commit `22de2da`); Cloud Run revision `airboard-pilot-web-00007-zwq` serves 100% of traffic and the bridge protocol marker is verified in the served JS bundle. | In-meeting retest with the unpacked extension is next; the Meet tab must be reloaded after loading the extension so the content script injects. |
| 2026-07-17 | PF-002 | Real-meeting pass: bridged gesture worked on the Meet main stage. Tester feedback fixes: the redundant self-video preview is hidden on Meet surfaces (the tracker still consumes the hidden element; Meet's own tile is the mirror), and the bridge gained an audio channel — explicit Start Airo streams the meeting-origin microphone (ScriptProcessor PCM chunks, channel-scoped end events) into the existing realtime transcription session via its injectable getUserMedia seam. Protocol unit tests and e2e updated. | Voice in the deployed pilot additionally requires `DEEPGRAM_API_KEY` on the pilot API service (publisher-held secret); in-meeting voice retest after that. 216 unit tests and 13 Playwright journeys pass. |
| 2026-07-17 | PF-002 | Deployed the bridge-audio build: Cloud Build `279ac618-4be3-4b45-a90f-c9c11ae90e02` produced image `web:pf002-bridge-audio-3cf5993` (commit `3cf5993`); Cloud Run revision `airboard-pilot-web-00008-4rx` serves 100% of traffic; audio-channel marker verified in the served bundle and smoke routes returned 200. | The bridge extension must be reloaded in `chrome://extensions` (its content script changed) and the Meet tab refreshed; voice needs `DEEPGRAM_API_KEY` on the pilot API. |
| 2026-07-17 | PF-002 | Publisher set `DEEPGRAM_API_KEY` on the pilot API (revision `airboard-pilot-api-00003-mf2`, plain env var); `GET /transcription/config` from the pilot web origin now reports `available: true` with `deepgram / flux-general-en`. | In-meeting gesture+voice retest with the reloaded extension is the remaining PF-002 media verification. SEC-002 still requires moving this key to managed secret storage before customer-facing use. |
| 2026-07-17 | PF-002 | First real in-Meet bridged voice turn verified end to end in Cloud Run logs: bridged mic → Deepgram transcript (0.73 confidence) → palm-gate routing — rejected only at interpretation (`ambiguous_node_type`, a narrative command) because the semantic planner had no credential. Publisher set `AIRBOARD_INTENT_API_KEY` (revision `airboard-pilot-api-00004-hkn`); `GET /intent/config` now reports `available: true` with `openai / gpt-5.6-terra`. | Retest the narrative command in-meeting; both pilot API keys remain plain env vars pending SEC-002. |
| 2026-07-17 | PF-002 | Model-cost evaluation on the local voice-intent corpus: `gpt-5.4-nano` rejected (9/14, consistently fails acoustic repair and branch grounding); `gpt-5.4-mini` on par with `gpt-5.6-terra` (19/21 vs 13/14) at ~25% lower p50 latency and lower cost tier. Publisher switched the pilot default to `gpt-5.4-mini` (revision `airboard-pilot-api-00005-n8n`); terra remains allowlisted for per-session fallback via the UI selector. | The 7-case corpus lacks statistical power for the public-beta voice gate; grow it (seeded with pilot-meeting transcripts) before the gate-scorecard threshold is set. |
