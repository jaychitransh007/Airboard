# Airboard Platform Support Matrix

> **Task:** PF-001  
> **Status:** Baseline defined; real-client validation pending  
> **Last updated:** 2026-07-16  
> **Owner:** Product and platform engineering  
> **Decision scope:** Public-beta promises for standalone web, Google Meet, Microsoft Teams, and Zoom

## Decision

Airboard has no generally available platform commitment yet. The proposed release order is:

1. Standalone desktop web plus Google Meet desktop web for public beta.
2. Microsoft Teams desktop and Zoom desktop for controlled design-partner pilots.
3. Mobile and other web clients only after they pass the same real-client, security, onboarding, and reliability gates.

This is a testable candidate matrix, not a claim that the listed clients already work. `PF-002`, `PF-003`, and `PF-004` must replace candidate statuses with real-client evidence before `PF-006` approves the public promise.

## Status legend

| Code | Meaning | May be advertised? |
| --- | --- | --- |
| **V** | Verified in the current repository by automated test; provider-client validation can still be pending | Only if all launch gates also pass |
| **I** | Implemented or routed in the repository but not verified in a real provider client | No |
| **P** | Partially implemented; a known correctness or lifecycle gap remains | No |
| **C** | Candidate supported by provider documentation; Airboard implementation and real-client validation are pending | No |
| **NB** | Not built | No |
| **E** | Excluded from the initial release scope | No |
| **N/A** | Capability does not apply to this surface | Not applicable |

## Release-channel matrix

| Provider | Intended channel | Initial eligible clients | Initial operating systems | Current Airboard state | Release disposition |
| --- | --- | --- | --- | --- | --- |
| Standalone | Airboard-hosted web app | Current Chromium desktop browser | Windows, macOS, ChromeOS | Board UI and two-browser sync are automated; authentication and reconnect catch-up remain incomplete | Public-beta candidate after foundation gates |
| Google Meet | Google Workspace Marketplace Meet add-on | Meet desktop web, initially Chrome | Windows, macOS, ChromeOS | Official Add-ons SDK runtime passed publisher-account real-client side-panel/main-stage smoke tests; customer-style install, multi-user roles, lifecycle recovery, and Meet-sourced gesture media remain open | First provider public-beta candidate |
| Microsoft Teams | Tenant-uploaded custom app | Teams desktop client | Windows and macOS | Provider type exists; no Teams adapter, manifest, Entra identity, or client test exists | Design-partner pilot only |
| Zoom | Approved external beta | Zoom desktop client | Windows and macOS | Provider type exists; no Zoom adapter, OAuth/context integration, or client test exists | Controlled pilot only |

## Client and operating-system matrix

“Candidate” means the combination must be exercised during its provider feasibility task. Version floors will be set from the oldest version that passes, not guessed in advance.

| Provider | Client | Windows | macOS | ChromeOS/Linux | iOS/iPadOS | Android | Initial disposition |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Standalone | Chrome desktop web | **V** on automated Chromium harness; manual device test pending | **V** on automated Chromium harness; manual device test pending | **C** on ChromeOS; Linux engineering-only | **E** | **E** | Candidate on current/previous Chrome releases after manual matrix |
| Standalone | Edge desktop web | **C** | **E** | **E** | N/A | N/A | Candidate on current/previous Edge releases |
| Standalone | Firefox desktop web | **E** | **E** | **E** | N/A | N/A | Deferred until camera, speech, canvas, and E2E coverage exists |
| Standalone | Safari desktop web | N/A | **E** | N/A | N/A | N/A | Deferred until camera, speech, canvas, and E2E coverage exists |
| Standalone | Mobile browser | N/A | N/A | N/A | **E** | **E** | Companion/view-only work is a later decision |
| Google Meet | Meet desktop web in Chrome | **C** | **C** | **C** on ChromeOS; Linux not advertised | N/A | N/A | Proposed public-beta client; must pass PF-002 |
| Google Meet | Meet desktop web in Edge/other browser | **E** | **E** | **E** | N/A | N/A | Add only after separate provider-client validation |
| Google Meet | Meet native mobile add-on | N/A | N/A | N/A | **E** | **E** | Current repository has web URLs only and no iOS/Android add-on entries or apps |
| Microsoft Teams | Teams desktop | **C** | **C** | **E** | N/A | N/A | Proposed design-partner surface; must pass PF-003 |
| Microsoft Teams | Teams web meeting app | **E** | **E** | **E** | N/A | N/A | Microsoft currently documents meeting side panel/stage on web as developer preview |
| Microsoft Teams | Teams mobile meeting app | N/A | N/A | N/A | **E** | **E** | Meeting details/chat capabilities do not constitute an Airboard in-meeting support promise |
| Zoom | Zoom desktop app | **C** | **C** | **E** | N/A | N/A | Proposed controlled-pilot surface; must pass PF-004 |
| Zoom | Zoom mobile app | N/A | N/A | N/A | **E** | **E** | Zoom Apps exist on mobile, but Airboard has no mobile design, integration, or validation |

## Role and admission matrix

These mappings are the intended authorization policy. They are not active until the identity and tenancy tasks are complete. Provider role must be verified server-side; the browser cannot select its own Airboard role.

| Provider | Provider participant | Candidate Airboard role | Intended behavior | Guest/external rule |
| --- | --- | --- | --- | --- |
| Standalone | Authenticated board creator | Owner | Configure policy, invite, edit, export, end, and delete | N/A |
| Standalone | Authenticated invitee | Editor or viewer from invitation | Join only the invited organization/session and obey board policy | Cross-organization invite requires explicit owner policy |
| Standalone | Link guest | Viewer by default; editor only by explicit policy | Join with a short-lived scoped ticket | Guest links are disabled until AUTH-007–AUTH-011 pass |
| Google Meet | Organizer/host starting Airboard | Owner | Start/select/end board and control participant drawing | Must also belong to or provision the mapped Airboard organization |
| Google Meet | Co-host or permitted activity starter | Editor by default; owner only through Airboard transfer | Start/join subject to host and organization policy | External co-host follows external-user policy |
| Google Meet | Signed-in participant/contributor | Editor or viewer from board policy | Join the activity and use permitted input modes | External signed-in users default to viewer until owner admits editing |
| Google Meet | View-only, unsigned, Family Link, under-age, blocked, CSE, or livestream participant | No in-add-on admission | Show an eligibility explanation and companion/view-only fallback when permitted | Google documents these cases as ineligible for Meet add-ons |
| Microsoft Teams | Organizer/co-organizer | Owner candidate | Install/start/select/end board and configure meeting policy | Tenant installation and Entra consent must be active |
| Microsoft Teams | Presenter | Editor candidate | Share to stage and edit if organization/meeting policy permits | External presenter defaults to viewer pending explicit admission |
| Microsoft Teams | Attendee | Viewer by default; editor by policy | Join stage/side-panel experience and use allowed inputs | Guest/federated identities require verified tenant and meeting context |
| Microsoft Teams | Anonymous attendee | No edit admission initially | Receive a companion/view-only path if policy permits | Initial pilot excludes anonymous editing |
| Zoom | Meeting owner/host | Owner candidate | Start/select/end board and configure participant access | Zoom account installation must map to an Airboard organization |
| Zoom | Co-host | Editor candidate | Collaborate and assist; ownership transfer is an Airboard action | External co-host follows organization policy |
| Zoom | Participant | Viewer by default; editor by host policy | Join using verified user context and supported SDK capabilities | Participant may have only their own data under Zoom role permissions |
| Zoom | Guest/external participant | Viewer or blocked by policy | Graceful single-user/companion fallback if app access is unavailable | Never infer identity from display name or reusable meeting ID |

## Surface, media, and meeting-capability matrix

| Provider | Control/side panel | Shared board/stage | Camera gesture input | Microphone voice input | Screen sharing | Reconnect/resume | Breakout rooms | Required fallback |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Standalone | N/A; full-page controls are **V** | Full-page collaborative board is **V** in two-browser E2E | Browser `getUserMedia` path is **I**; manual device/permission matrix pending | Browser and realtime speech paths are **I**; typed commands are **V** | External browser/OS share only; Airboard has no share API | Transport retry is **P**; no replay/catch-up, offline queue, or automatic gap repair | N/A | Local-only board when API is unreachable; pointer/touchpad and typed commands without media |
| Google Meet | Side-panel SDK initialization is real-client **V** for the publisher account; customer install still pending | `startActivity` and main-stage initialization are real-client **V** for the publisher account; participant starting-state join is **I** (implemented through versioned activity data; unverified with a second real participant) | **I** — explicit embedded capture implemented behind a runtime permission-delegation probe (real-client delegation unverified); companion-window capture implemented as the universal fallback. The Add-ons SDK still exposes no Meet video track; hidden capture remains rejected; Meet Media API stays Developer Preview and out of the public-beta path | **I** — explicit embedded voice behind the same delegation probe, companion window otherwise; the deployed pilot has no transcription credentials configured. Meet Media API remains out of the public-beta path | Provider offers activity screen-sharing support; Airboard implementation is **NB** | Airboard transport is **P**; Meet lifecycle/activity resume is **NB** | **C** only after PF-002 proves meeting-context behavior; no promise today | Pointer/touchpad, keyboard, typed commands, and direct canvas controls remain accessible; the companion window provides gesture and voice when embedded capture is unavailable |
| Microsoft Teams | Meeting side panel is provider-supported **C**; Airboard is **NB** | Meeting stage/global app sharing is provider-supported **C**; Airboard is **NB** | Teams media device permission is provider-supported **C**; manifest, permission, and real-client behavior are **NB** | Teams media device permission is provider-supported **C**; manifest, permission, and audio contention are **NB** | Stage sharing is the primary shared surface; screen overlay is not promised | **NB** for Teams lifecycle and token/context refresh | **NB**; movement between main meeting and breakout must never reuse stale admission | Pointer and typed input in desktop app; secure companion browser when media or meeting app is unavailable |
| Zoom | In-client Zoom App panel is **C**; Airboard is **NB** | Collaborative experience is **C**; exact surface/API choice is pending PF-004 | **C** but SDK/client permission behavior is unverified | **C** but SDK/client permission and meeting-audio contention are unverified | Not part of the initial Airboard promise | **NB** for Zoom context, role, and lifecycle refresh | Required for in-meeting Zoom Apps; **NB**. Treat each breakout UUID as a separate room by default; Zoom currently excludes Collaborate/Layers inside breakouts | Pointer and typed input in the app; secure companion browser; per-room standalone board when collaborative surface is unavailable |

## Input-mode policy

| Input mode | Standalone desktop web | Google Meet desktop web | Teams desktop pilot | Zoom desktop pilot | Fallback when unavailable |
| --- | --- | --- | --- | --- | --- |
| Pointer/touchpad | Public-beta candidate | Public-beta candidate | Pilot candidate | Pilot candidate | Required baseline; if this fails, the client is unsupported |
| Typed command | Public-beta candidate | Public-beta candidate | Pilot candidate | Pilot candidate | Always offered when voice is unavailable or denied |
| Camera gestures | Candidate after manual validation | Delegation-dependent: embedded when the Meet client delegates camera permission to the add-on frame (real-client verification pending); companion window otherwise; hidden capture rejected | Candidate via documented `devicePermissions` manifest media; PF-003 must prove desktop behavior | Candidate only if PF-004 proves Zoom webview capture; companion window otherwise | Companion window for gesture; pointer/touchpad plus typed command as the baseline |
| Microphone voice | Candidate after privacy, provider, and device validation | Delegation-dependent like camera; companion window otherwise; transcription requires provider credentials | Candidate only if PF-003 proves permission and meeting-audio coexistence | Candidate only if PF-004 proves permission and meeting-audio coexistence; Zoom RTMS is a later ambient-tier path | Companion window for voice; typed command as the baseline |
| Mobile touch | Excluded initially | Excluded initially | Excluded initially | Excluded initially | Desktop or secure companion browser on an advertised device |

## Fallback contract

Fallback is selected in this order, and the UI must explain why a higher mode is unavailable:

1. Use pointer/touchpad for direct manipulation and drawing.
2. Use typed commands instead of voice.
3. Open a short-lived, authenticated standalone companion link for the same meeting/session.
4. Allow view-only observation through the provider's shared stage or organizer screen share when policy permits.
5. Block admission with a specific reason when identity, tenant policy, provider eligibility, or data safety cannot be verified.

The product must never silently turn a failed provider session into an unscoped local board. Local-only mode is acceptable for standalone development and an explicitly labeled personal scratch board, not as an unnoticed substitute for a customer meeting session.

## Reconnect and lifecycle contract

Every advertised client must pass all of these cases before promotion:

- Initial authenticated join and state hydration.
- WebSocket interruption with acknowledged edits before and after the interruption.
- Device sleep/background and foreground recovery.
- Provider side-panel close/reopen and shared-stage close/rejoin.
- Token/context expiry and refresh.
- Participant removal, role change, installation revocation, and meeting end.
- Network sequence gap with automatic catch-up or snapshot resynchronization.
- Duplicate provider launch and stale activity/session links.
- Breakout-room entry/exit where the provider supports breakouts.

Current state: only initial standalone two-browser join, live sync, and reload hydration have automated coverage. Automatic replay, gap repair, offline queueing, and provider lifecycle recovery are not ready.

## Real-client test record schema

Each PF-002–PF-004 test result must be appended to this document or a linked evidence file using this schema:

| Field | Required value |
| --- | --- |
| Test ID | Provider-prefixed stable ID, for example `GMEET-WIN-CHROME-HOST-001` |
| Date/build | UTC date, Airboard commit, provider app/deployment version |
| Device | Hardware class, OS and version, browser/provider client and version |
| Identity | Provider tenant/account type, Airboard organization, install method |
| Role | Organizer/host, co-host/presenter, participant/attendee, guest/external/anonymous |
| Surface | Standalone, side panel/app panel, shared stage/main stage, companion |
| Capabilities | Camera, microphone, pointer, typed input, screen share, sync, export |
| Lifecycle | Start, join, reconnect, background/resume, role change, removal, end |
| Breakout | Not applicable, main room, enter, leave, re-enter, cross-room isolation |
| Result | Pass, partial, fail, blocked, with exact failure and fallback outcome |
| Evidence | Video/screenshot, logs/traces, test data, issue/task IDs, reviewer |

## Feasibility execution register

| Task | Provider | Minimum real-client coverage | Status | Promotion blocker |
| --- | --- | --- | --- | --- |
| PF-002 | Google Meet | Chrome on Windows and macOS; ChromeOS when available; host, participant, external user; side panel/main stage; camera/mic denied and allowed; reconnect; ineligible participant | Publisher-account pass for Installed discovery, side-panel SDK initialization, activity launch, main-stage live sync, typed editing, and leave/rejoin/relaunch with media off. Product accepted explicit delegated/companion capture (2026-07-16); the delegation probe, conditional media entry points, and companion flow are implemented but unverified in a real Meet client | Verify permission delegation and the companion flow in a real Meet client, then resume customer-install and role/device validation |
| PF-003 | Microsoft Teams | Windows and macOS desktop; organizer, presenter, attendee, guest; side panel/stage; media allowed/denied; reconnect; web/mobile fallback | Not started | Tenant app registration/upload, Entra test tenant/users, HTTPS origin |
| PF-004 | Zoom | Windows and macOS desktop; owner, host/co-host, participant, external user; app/collaboration surface; media; reconnect; breakout transition | Not started | Zoom development app, test accounts/users, HTTPS origin, beta permissions where required |

## Repository evidence for this baseline

- `apps/web/e2e/boardSync.spec.ts` verifies two browser contexts share one live board and reload from server state.
- `apps/web/playwright.config.ts` has one default Playwright project, so current E2E evidence is Chromium-only rather than a cross-browser/device matrix.
- `apps/web/app/meet/side-panel/page.tsx` and `apps/web/app/meet/main-stage/page.tsx` render `GoogleMeetSurface`, which initializes the official Meet Add-ons SDK, starts activities from the side panel, and joins the activity's board session on the main stage.
- `packages/integrations/src/googleMeetRuntime.ts` wraps the official SDK with frame validation and versioned, validated activity data; `googleMeetAdapter.ts` uses it. Identity is still hard-coded and role/participant lifecycle handling does not exist.
- `packages/integrations/src/index.ts` exports only the standalone adapter, the Google Meet adapter, and the Google Meet runtime; Teams and Zoom adapters do not exist.
- `apps/web/src/features/board/AirboardPrototype.tsx` requests camera/microphone only on the standalone surface. Meet surfaces structurally block Airboard media starts and provide pointer/touchpad and typed-command paths.
- `packages/realtime-client/src/client.ts` retries transient WebSocket closes, but `apps/web/src/features/board/boardSync.ts` drops sends while disconnected and has no replay/catch-up protocol.

## Official platform constraints used for candidate status

These references establish provider capability, not Airboard compatibility. Recheck them when running each feasibility task.

- Google documents Meet web add-ons as side-panel and main-stage web pages, with `startActivity()` and activity-starting state for collaboration: [Use a Meet add-on](https://developers.google.com/workspace/meet/add-ons/guides/use-add-on), [Manage client objects](https://developers.google.com/workspace/meet/add-ons/guides/get-client).
- Google documents that availability depends on account, admin, role, meeting type, device, and add-on platform support; unsupported users receive a cannot-join state: [Use add-ons with Google Meet](https://support.google.com/meet/answer/13961388?hl=en).
- Microsoft documents meeting side-panel and meeting-stage support in the Teams desktop client, while Teams web support requires developer preview: [Build tabs for meetings](https://learn.microsoft.com/microsoftteams/platform/apps-in-teams-meetings/build-tabs-for-meeting).
- Microsoft documents manifest-declared media permission for Teams app camera, microphone, speakers, and media gallery: [Request device permissions for Teams apps](https://learn.microsoft.com/microsoftteams/platform/concepts/device-capabilities/native-device-permissions).
- Zoom documents Zoom Apps on Windows, macOS, iOS, and Android, but this matrix limits Airboard's initial pilot to desktop: [Zoom Apps overview](https://developers.zoom.us/docs/zoom-apps/).
- Zoom requires in-meeting apps to handle breakout rooms and currently states that breakouts do not support Collaborate or Layers: [Zoom Apps for breakout rooms](https://developers.zoom.us/docs/zoom-apps/guides/breakout-rooms/).
- Zoom documents role-based API availability and recommends `getSupportedJsApis`, Universal Meeting IDs, per-user context, and graceful behavior when participants cannot install the app: [Zoom roles and permissions](https://developers.zoom.us/docs/zoom-apps/guides/roles-and-permissions/).

## Change log

| Date | Task | Change |
| --- | --- | --- |
| 2026-07-14 | PF-001 | Defined the initial provider, OS, client, role, surface, media, screen-sharing, reconnect, breakout, and fallback matrix; separated current evidence from unverified candidate support. |
| 2026-07-16 | PF-002 | Recorded publisher-account real Meet passes for Installed discovery, side panel, activity launch, main stage, live sync, typed editing, and leave/rejoin/relaunch with media off; kept customer-style draft installation and the remaining role/device matrix unpromoted. |
| 2026-07-16 | PF-002 | Reclassified Meet camera gestures as release-critical, documented the Add-ons SDK media boundary, rejected hidden separate capture, and blocked production promotion while the Meet Media API remains Developer Preview. |
| 2026-07-16 | PF-002 | State-audit correction: refreshed the stale repository-evidence entries (official SDK runtime is integrated and media requests are standalone-only, not "adapter stub"/"media on every surface") and reclassified participant starting-state join from NB to I. |
| 2026-07-16 | PF-002 | Cross-platform media policy superseded the Meet-sole-media-owner rule: Meet camera/microphone reclassified from Blocked/E to I (delegation-dependent embedded capture plus companion-window fallback, both implemented, real-client verification pending); Teams/Zoom input-mode cells updated to the same policy. |
