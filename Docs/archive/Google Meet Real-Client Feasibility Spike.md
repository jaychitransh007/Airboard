# Google Meet Real-Client Feasibility Spike

> **Task:** PF-002  
> **Status:** Publisher-account side panel/main stage pass; blocked on saved Marketplace draft installation and remaining matrix  
> **Last updated:** 2026-07-16  
> **Purpose:** Prove Airboard's minimum viable Google Meet experience in actual Meet clients before production integration work begins.

## Current blocker

The pilot infrastructure, developer deployment, and publisher App Configuration are ready. The publisher's developer-installed account can discover Airboard in a real Meet meeting, initialize the side panel, start an activity, initialize the main stage, connect live sync, and apply typed create/connect commands while camera and microphone remain off.

PF-002 will not grant Cloud IAM to customers or test users. Customer-style execution remains blocked until the Store Listing's four required prepared assets are selected through Google's native file pickers, the draft is saved without review submission, and the draft tester installs Airboard through Marketplace. The Workspace organizer/participant/external/ineligible identities and Windows/macOS Chrome coverage are also still outstanding.

Do not mark PF-002 complete from standalone routes, mocks, or ordinary browser tabs. The acceptance criterion requires Google Meet itself to load and run the add-on.

## Provisioned pilot environment

| Asset | Value/status |
| --- | --- |
| Google Cloud project | `project-1217dd57-9cac-491d-b8d` |
| Cloud project number | `634900453473` |
| Required Google services | Google Workspace Marketplace SDK and Google Workspace Add-ons API enabled |
| Official SDK | `@googleworkspace/meet-addons` 1.2.0 installed and used through a browser-only dynamic import |
| Web service | `https://airboard-pilot-web-634900453473.asia-south1.run.app` |
| API service | `https://airboard-pilot-api-634900453473.asia-south1.run.app` |
| Cloud Run region/limit | `asia-south1`; maximum one instance per pilot service |
| Persistence | Disposable in-memory session state; no customer data |
| Add-on deployment | `projects/634900453473/deployments/airboard-pilot-pf002` |
| Developer installation | Installed for the active `gcloud` account; useful only as publisher smoke evidence, not as the customer onboarding model |
| Marketplace App Configuration | Saved as Public, Trader, Individual + Admin Install, Google Workspace add-on, and the pilot HTTP deployment |
| Marketplace Store Listing | Text, worldwide distribution, free pricing, pilot URLs, draft tester, and local assets prepared; not saved because four native file-picker uploads remain |
| Build identity | Dedicated `airboard-pilot-builder` with source-read, image-write, and log-write roles only |
| Runtime identity | Dedicated `airboard-pilot-runtime` with no project IAM roles |

## Inputs still required to unblock

The project owner must provide or authorize:

- Selection of the prepared icon, card-banner, and screenshot files in Google's native Store Listing file pickers, followed by Save Draft without review submission.
- A Google Workspace test tenant where an administrator can install the draft Meet add-on.
- At least four test identities: administrator/organizer, same-domain participant, external-domain signed-in participant, and a participant that is intentionally ineligible or blocked.
- Installation by the centrally listed draft tester, with no project IAM role.
- Legal approval or replacement of the pilot privacy/terms copy before public review; the current pages are expressly pilot-only.
- A Windows Chrome device and a macOS Chrome device for the minimum client matrix.
- An owner for the Workspace test users, test data, and later cleanup.

Credentials and tokens must not be added to this repository. Configuration must be supplied through managed environment variables or the hosting/provider configuration.

## Pilot environment contract

| Asset | Pilot requirement | Production relationship |
| --- | --- | --- |
| Google Cloud project | Dedicated pilot project with named owner | Must not be reused as the production project |
| Marketplace/Meet deployment | Private/unpublished test deployment | Separate production deployment and review |
| Web origin | Public HTTPS, no wildcard redirect behavior | Production gets a separate stable origin |
| API origin | Public HTTPS plus WSS, restricted CORS/origins | Production gets separate secrets, database, and quotas |
| Database | Disposable non-production tenant/session data | No customer data in pilot environment |
| Identities | Test Workspace users and explicit external tester | Production identity policy implemented under AUTH tasks |
| Observability | Request, Meet lifecycle, WebSocket, permission, and client error logs | Must redact tokens, meeting content, and media |

## Minimum deployment configuration

The Meet add-on deployment must identify the side-panel entry point and allowed origin. The exact console schema must be copied from the current Google deployment documentation when the pilot project is created.

```json
{
  "addOns": {
    "common": {
      "name": "Airboard Pilot",
      "logoUrl": "https://airboard-pilot-web-634900453473.asia-south1.run.app/airboard-pilot.svg"
    },
    "meet": {
      "web": {
        "sidePanelUrl": "https://airboard-pilot-web-634900453473.asia-south1.run.app/meet/side-panel",
        "supportsScreenSharing": true,
        "addOnOrigins": ["https://airboard-pilot-web-634900453473.asia-south1.run.app"]
      }
    }
  }
}
```

The main-stage URL is selected when the side-panel client starts the activity. The spike uses `https://airboard-pilot-web-634900453473.asia-south1.run.app/meet/main-stage` and validates a versioned board-session payload in `additionalData`. Replacing that payload with an opaque, short-lived admission ticket remains mandatory under AUTH-007/AUTH-008 and GMEET-004 before any customer beta.

## Spike implementation sequence

1. [x] Record the pilot project number and HTTPS origins as environment configuration; add names and safe examples to `.env.example` without secrets.
2. [x] Install the official Meet add-ons SDK and replace the global `any` types needed by the spike.
3. [x] Make each route initialize the correct client:
   - `/meet/side-panel` creates a side-panel client.
   - `/meet/main-stage` creates a main-stage client.
   - Both fail visibly when launched outside a valid Meet SDK context.
4. [x] Add pilot diagnostics for frame type, frame-open reason, SDK failures, and correlation ID without displaying tokens or raw provider identifiers.
5. [x] Deploy the web/API pilot, configure exact HTTPS origins, create the Google HTTP deployment, and install the developer add-on.
6. [ ] Execute every mandatory case below in actual Meet meetings. Publisher-account discovery, side panel, main stage, live sync, typed editing, and a leave/rejoin/relaunch smoke test are proven; draft-tester installation and the remaining matrix are open.
7. [ ] Update [`Platform Support Matrix.md`](<Platform Support Matrix.md>) with real-client results and evidence.
8. [ ] Remove or feature-gate the diagnostic surface before production review.

## Mandatory real-client cases

### Installation and eligibility

- [ ] Workspace administrator can permit/install the private pilot add-on.
- [x] Organizer can find and open Airboard from Meet tools on the publisher's developer-installed account; repeat through the Marketplace draft-tester path before promotion.
- [ ] Same-domain signed-in participant can install/join when policy allows.
- [ ] External-domain signed-in participant receives the intended install/admission behavior.
- [ ] Blocked/ineligible/view-only/unsigned participant receives a clear explanation and fallback.
- [ ] Add-on uninstall or admin block prevents subsequent admission.

### Side panel and main stage

- [x] Side panel initializes the SDK and creates the correct side-panel client on the publisher's developer-installed account.
- [x] Organizer starts one Airboard activity and the main stage opens on the publisher's developer-installed account.
- [x] Main stage initializes the SDK and creates the correct main-stage client on the publisher's developer-installed account.
- [ ] Participant receives activity starting state and joins the same Airboard session.
- [ ] Duplicate start, expired activity data, wrong meeting, and stale session fail safely.
- [ ] Side panel close/reopen and main stage close/rejoin restore the intended state.

### Collaboration

- [ ] Organizer creates an object and same-domain participant sees it.
- [ ] Permitted participant edits and organizer sees it.
- [ ] Viewer or blocked participant cannot publish edits.
- [ ] At least three simultaneous participants converge on the same final board.
- [ ] Export and end-session permissions match the candidate role matrix.

### Camera and microphone

- [x] **[BLOCKED BY PLATFORM]** The production Meet Add-ons SDK exposes no camera or microphone track to the side-panel or main-stage iframe. Cross-origin browser rules prevent the Airboard iframe from reading Meet&apos;s parent DOM or video element.
- [x] **[REJECTED, PARTIALLY SUPERSEDED 2026-07-16]** A hidden Airboard `getUserMedia` stream remains rejected: it is not reuse of the Meet stream and must never be presented as such. The later cross-platform media policy accepts a **visible, explicit, user-initiated** capture where the Meet client delegates camera/microphone permission to the add-on frame (Chrome then applies the top-level grant, so no second prompt); where delegation is absent, the companion window is the gesture/voice surface. Real-client delegation behavior is unverified.
- [ ] Obtain a Google-supported GA contract that can identify and deliver the current Airboard user&apos;s Meet video stream without all-participant preview enrollment.
- [ ] After a GA media contract exists, validate deterministic self-participant selection, consent, camera-off behavior, stream changes, latency, local-only frame processing, and cleanup on meeting/activity end.
- [ ] Google Meet&apos;s own camera and microphone controls remain usable while Airboard consumes the supported media source.
- [ ] Pointer, keyboard, typed commands, and direct canvas controls remain accessible fallbacks, but do not substitute for the release-critical gesture acceptance criterion.
- [ ] Keep Meet Media API work isolated as a feasibility experiment while it remains Developer Preview, uses restricted OAuth scopes, and requires every participant to be enrolled.

### Screen sharing and observation

- [ ] `supportsScreenSharing` behavior is verified with the Airboard activity.
- [ ] Participant without an interactive add-on path can observe through the approved sharing fallback when policy permits.
- [ ] Shared content does not expose admin controls, diagnostics, secrets, or another tenant's board.

### Reconnect and lifecycle

- [ ] Temporary network loss reconnects or visibly requires resync; no acknowledged edit silently disappears.
- [ ] Browser tab background/foreground and device sleep/resume behavior are recorded.
- [ ] Organizer and participant can leave and rejoin the activity safely.
- [ ] Participant removal immediately prevents additional board writes.
- [ ] Organizer leaving/meeting ending closes or locks the session according to policy.
- [ ] Reusing an old Meet/activity URL cannot join a new or unrelated meeting.

### Breakout behavior

- [ ] Entering a Meet breakout room is tested for meeting context, activity availability, identity, WebSocket continuity, and session isolation.
- [ ] Leaving/re-entering a breakout does not leak or silently merge the wrong board.
- [ ] If Meet cannot support the intended breakout flow, the UI presents the documented fallback and the support matrix excludes it.

### Performance and accessibility

- [ ] Side panel and main stage become interactive within the provisional five-second join target.
- [ ] Camera gesture processing does not make Meet audio/video unusable on the minimum target device.
- [ ] Keyboard-only operation, focus order, labels, zoom, reduced motion, and screen-reader smoke test pass on both surfaces.

## Evidence log

Infrastructure evidence and publisher-account real-client capability passes exist. These results prove the Meet surfaces can run Airboard, but they do not replace the required customer-style draft installation or multi-user/device matrix.

| Test ID | Date/build | Client/device | Role/surface | Result | Evidence/issue |
| --- | --- | --- | --- | --- | --- |
| GMEET-INFRA-001 | 2026-07-15 | Google Cloud project `634900453473` | Pilot infrastructure | Pass | Required Google and Cloud Run APIs enabled; dedicated build/runtime identities created |
| GMEET-SDK-001 | 2026-07-15 | SDK 1.2.0; repository build | Side panel/main stage | Pass | 3 SDK runtime tests, integrations/web type checks, 104 web tests, and production builds passed |
| GMEET-HOST-001 | 2026-07-15 | Cloud Run `asia-south1` | Web/API | Pass | Both HTTPS routes returned 200; exact-origin CORS passed; Google Meet-tagged session creation passed |
| GMEET-DEPLOY-001 | 2026-07-15 | Deployment `airboard-pilot-pf002` | Developer installation | Pass | Deployment resource describes successfully; install status is `installed: true` |
| GMEET-CLIENT-001 | 2026-07-15 | In-app browser | Meet sign-in | Blocked | Browser is not signed in to Google Meet; no meeting/client capability result claimed |
| GMEET-CLIENT-002 | 2026-07-16 | macOS in-app Chromium client | Signed-in organizer; private meeting; add-on discovery | Blocked | Private meeting started with camera/microphone disabled and exited cleanly. Meet's Add-ons tab showed only Marketplace browsing because the unpublished add-on had not been distributed to this user. No Airboard surface was loaded or claimed as passed. |
| GMEET-CLIENT-003 | 2026-07-16; Cloud Run revision `airboard-pilot-web-00003-lrw` | macOS in-app Chromium client | Publisher organizer; installed add-on; side panel | Pass | **Meeting tools > Add-ons > Installed** exposed Airboard Pilot. The side panel initialized the Meet SDK, reported live sync connected, and remained usable with camera and microphone off. |
| GMEET-CLIENT-004 | 2026-07-16; Cloud Run revision `airboard-pilot-web-00003-lrw` | macOS in-app Chromium client | Publisher organizer; main stage | Pass | `startActivity` opened the real Meet main stage. Typed commands created User/API/Database nodes and labeled connectors with live sync connected; screenshot: `apps/web/public/marketplace/airboard-meet-main-stage-1280x800.jpg`. |
| GMEET-CLIENT-005 | 2026-07-16; Cloud Run revision `airboard-pilot-web-00003-lrw` | macOS in-app Chromium client | Publisher organizer; leave/rejoin/relaunch | Partial | After the one-person call ended, the organizer rejoined with media off, rediscovered Airboard under Installed, reopened the side panel, and launched a fresh main-stage activity. Restoration of the previous board and multi-user lifecycle behavior remain unproven. |
| GMEET-UI-001 | 2026-07-16; Cloud Run revision `airboard-pilot-web-00005-lk8` | Repository build and pilot deployment | Meet media ownership and layout | Pass (implementation) | Meet surfaces cannot start Airboard camera/speech sessions; the local media buttons, `V` mic shortcut, onboarding modal, video element, media diagnostics, and duplicate side-panel board are removed. Side panel is a compact launch/status view and pilot disclosures match the behavior. Web type-check, 104 tests, production build, final image build `e5aa29fd-9f49-4c07-8f85-ff2dc73f6174`, deployment, and Meet/privacy/setup HTTP 200 smoke checks passed. Fresh real-client visual/permission verification remains open. |
| GMEET-MEDIA-001 | 2026-07-16 | Official Google Add-ons and Meet Media API contracts | Meet-sourced gesture input | Blocked | Add-ons clients expose activity/lifecycle/messaging but no Meet media track. The raw-stream Meet Media API is Developer Preview, requires project, OAuth principal, and every participant enrollment, and uses restricted OAuth scopes. A hidden second capture was explicitly rejected as not meeting the product requirement. |
| GMEET-MEDIA-002 | 2026-07-16; Cloud Run revision `airboard-pilot-web-00006-smq` | macOS Chrome in a real Meet meeting | Permissions Policy delegation probe | Fail | The side panel reported companion mode: Meet's add-on iframe carries no camera/microphone Permissions Policy delegation, so in-iframe capture is browser-blocked regardless of user intent. This closes the delegated-embedded question and motivated the Meet Media Bridge extension. |

## Exit criteria

PF-002 is complete only when:

- All mandatory cases have a recorded pass, an explicitly accepted limitation with working fallback, or a documented exclusion.
- Windows and macOS Chrome have both been tested; ChromeOS is tested when hardware is available or explicitly deferred by PF-006.
- Organizer, same-domain participant, external participant, and ineligible/blocked participant paths are recorded.
- Side panel, main stage, camera, microphone, screen-sharing fallback, reconnect, meeting end, and breakout behavior have evidence.
- The platform matrix is updated and no failed case is described as supported.

## Official references

- [Meet add-ons quickstart](https://developers.google.com/workspace/meet/add-ons/guides/quickstart)
- [Deploy a Meet add-on](https://developers.google.com/workspace/meet/add-ons/guides/deploy-add-on)
- [Use a Meet add-on](https://developers.google.com/workspace/meet/add-ons/guides/use-add-on)
- [Manage Meet add-on client objects](https://developers.google.com/workspace/meet/add-ons/guides/get-client)
- [Meet Media API overview](https://developers.google.com/workspace/meet/media-api/guides/overview)
- [Get started with Meet Media API](https://developers.google.com/workspace/meet/media-api/guides/get-started)
- [Use add-ons with Google Meet](https://support.google.com/meet/answer/13961388?hl=en)

## Change log

| Date | Change |
| --- | --- |
| 2026-07-14 | Recorded prerequisites, pilot environment contract, implementation sequence, mandatory real-client cases, evidence schema, current blockers, and exit criteria. |
| 2026-07-15 | Enabled Google services, installed the official SDK, wired Meet side-panel/main-stage runtime, deployed HTTPS pilot services, created and installed the developer add-on, and narrowed the blocker to signed-in real-client testing. |
| 2026-07-16 | Started a signed-in private Meet meeting with media disabled and checked Meeting tools > Add-ons. Airboard was absent; traced the result to a mismatch between the Meet account and the active `gcloud` account holding the developer installation. |
| 2026-07-16 | Corrected the distribution model: customers and draft testers receive no project IAM. PF-002 now requires a centrally configured public Marketplace draft and real user installation; proposed listing fields and owner-only blockers are documented. |
| 2026-07-16 | Saved the Public Trader App Configuration and passed publisher-account discovery, side-panel SDK initialization, activity launch, main-stage typed editing/live sync, and a leave/rejoin/relaunch smoke test with media off. Prepared and deployed pilot listing pages and assets; customer-style draft installation remains blocked on four native file-picker uploads and Save Draft. |
| 2026-07-16 | Made Meet the sole media owner on embedded Airboard surfaces, replaced the duplicate side-panel board with a compact launch view, updated pilot disclosures, and deployed revision `airboard-pilot-web-00005-lk8`; fresh real-client regression remains open. |
| 2026-07-16 | Reclassified gestures as release-critical, confirmed that the production Add-ons SDK cannot provide the Meet video track, rejected hidden separate capture, and blocked the gesture-enabled production promise while the raw-stream Media API remains Developer Preview. |
| 2026-07-16 | Product superseded the sole-media-owner rule with the cross-platform explicit-capture policy: delegation-probed embedded gesture/voice plus a companion-window fallback are implemented and disclosed; hidden capture stays rejected. The next real-client session must record whether Meet delegates camera/microphone to the add-on iframe and whether the companion link opens from it. |
| 2026-07-16 | Real client answered the delegation question: no delegation (GMEET-MEDIA-002). Built the Meet Media Bridge Chrome extension — explicit-start capture on the meeting origin, ImageBitmap frames streamed into the add-on iframe, origin-allowlisted — restoring in-Meet gesture without a second prompt or separate window. Emulated-bridge e2e passes; real-meeting verification with the unpacked extension is next. |
