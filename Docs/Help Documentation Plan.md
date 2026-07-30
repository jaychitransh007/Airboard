# Airboard Help Documentation Plan

> **Status:** Plan (proposed). No help content written yet.
> **Created:** 30 July 2026
> **Decisions taken:** repo-only Markdown under `Docs/help/`; pilot-complete
> scope; in-product work includes full guided gesture onboarding (`ONB-008`)
> and personal calibration (`ONB-014`).
> **Audiences:** corporate employees, content creators, online tutors
> (per [Gesture Interaction Audit](./Gesture%20Interaction%20Audit.md)), plus
> design-partner administrators.

---

## 1. What this plan covers

Two deliverables that must be built together:

1. **`Docs/help/` — the canonical help text.** Markdown in this repository.
   No new routes, no docs site, no vendor. The `/docs` marketing stub
   (`apps/web/app/[marketingSlug]/page.tsx:18`) is left as-is in this pass.
2. **In-product guided onboarding.** Because there is no user-visible docs
   site, the product itself has to carry first-run learning. The guided
   gesture practice flow and personal calibration are the delivery vehicle;
   `Docs/help/` is their script and their source of truth.

This coupling is the central design constraint of the plan. Every gesture and
voice instruction gets written **once**, in `Docs/help/`, and the trainer
renders from the same wording. Two copies of the pose descriptions would drift
within a release.

---

## 2. Review findings

### 2.1 Product surfaces that need documenting

| Surface | Entry point | State |
| --- | --- | --- |
| Standalone web workspace | `/app/boards/<id>` — Intent Canvas and Touchpad Writing input modes (`AirboardPrototype.tsx:8237`) | Shipped |
| Google Meet camera overlay | Chrome extension v0.8.0, `extensions/chrome-meet-bridge` | Private preview; Web Store URL not configured |
| Native desktop overlay | Electron shell, `apps/desktop` | Preview; unsigned, no auto-update |
| Commercial control plane | `/app`, `/app/admin/*`, `/app/settings/*`, `/app/billing` | Shipped; paid checkout gated behind `AIRBOARD_BILLING_ENABLED` |

Input paths that all need parity coverage: typed commands, Airo voice, camera
hand gestures, pointer/mouse, touchpad writing, keyboard.

### 2.2 Documentation that exists today

**Internal engineering docs — 23 files in `Docs/`.** Architecture plans,
readiness checklists, implementation notes, audits, runbooks. Written for the
team. None is usable as help content without a rewrite, but several are
excellent *sources* (§4).

**User-facing help — thin and scattered:**

| Location | Content | Problem |
| --- | --- | --- |
| `/docs` (`[marketingSlug]/page.tsx:18`) | Three cards, ~90 words total | A stub. Linked from the footer, so it reads as a broken promise. |
| `/pilot/setup` | Meet install steps, three short sections | Only covers Meet; pilot-scoped framing. |
| First-run overlay (`AirboardPrototype.tsx:7561`) | Six bullets on gestures and voice | Renders **only** when a camera is available, input mode is Intent Canvas, and it is not the desktop overlay. Mouse-only and touchpad users see no first-run help at all. |
| "Gesture guide" `<details>` (`AirboardPrototype.tsx:8337`) | Aim / choose / move / place / erase / speak / undo | Collapsed inside the sidebar; not discoverable; no pan, zoom, or snap entries. |
| Canvas `aria-label` (`AirboardPrototype.tsx:7610`) | Tab, Enter/F2, typed commands | The only place keyboard navigation is described anywhere. |
| `extensions/chrome-meet-bridge/README.md` | Install journey, trust boundary | Developer-oriented (`chrome://extensions`, Load unpacked). |
| `/support` | Form | Asks users to supply "error code" and "trace ID" — and nothing in the product or docs explains what those are. |

**Not documented anywhere, for anyone:**

- The command grammar. Users cannot discover what they are allowed to say.
- Keyboard shortcuts. At least eight exist and none is listed in the UI.
- Error codes. 70+ stable codes across the API, web app, and extension.
- The admin console — members, policies, SSO/SCIM, installation health, audit
  log, deleted-board recovery window.
- Trial mechanics, board versioning, Trash/restore, export.
- What to do when voice or hands do not work.

### 2.3 Drift that must be repaired while writing

The [Release Readiness Backlog](./Release%20Readiness%20Backlog.md) already
logs four documentation-honesty defects. Writing help content on top of them
would propagate the errors into customer-facing text:

| ID | Defect | Effect on help docs |
| --- | --- | --- |
| RGB-034 | `Platform Support Matrix.md` describes the retired Meet add-on, not the shipped 0.8.0 camera overlay | Cannot be cited for the Meet page or the support matrix until corrected |
| RGB-035 | `Intent Canvas Implementation Notes.md` documents a removed Preview → Apply confirmation step | Its "Supported Commands" list is otherwise the best grammar source; the workflow sections are wrong |
| RGB-036 | README calls voice-trace storage in-memory only; durable 14-day org-scoped storage is implemented | Directly contradicts what a privacy page must say |
| RGB-037 | Two conflicting readiness sources of truth | Ambiguity about what may be described as available |

Additionally, `Object First Gesture Mode Implementation Notes.md` still
describes a flat "left object dock" of 15 tools; the shipped UI is a
three-category icon dock — Flow, System, Annotate (`AirboardPrototype.tsx:417`).

### 2.4 Honesty constraints inherited from the repo

This codebase is unusually disciplined about not overclaiming — marketing
pages say "proposed prices", "not a certification claim", "status-page
placeholder". Help docs must hold the same line. Specifically, they may
**not** state or imply:

- that the extension is installable from the Chrome Web Store (gated on
  `CHROME_WEB_STORE_URL` being configured);
- that signed, auto-updating desktop installers exist (`RGB-032`);
- that a subscription can be purchased (gated on `AIRBOARD_BILLING_ENABLED`);
- that Zoom or Microsoft Teams are supported;
- any uptime, SLA, certification, or accessibility-conformance claim;
- that Airboard stores no transcript data (sanitized voice traces persist for
  14 days).

Each help page carries a status line where the underlying capability is a
preview or gated.

---

## 3. Audience → job → document map

| Audience | Primary jobs | Their reading path |
| --- | --- | --- |
| Corporate employee (presenter in a call) | Get Meet working before a real meeting; learn ~6 commands; recover when a command misfires | 01 → 03 → 04 → 10 → 15 |
| Content creator | Camera/screen composition, recording, hiding the diagram, hands-free operation | 01 → 06 → 08 → 09 |
| Online tutor | Long hands-on sessions, legibility over slides, low-ceremony editing | 01 → 03 → 06 → 08 |
| Camera-off / keyboard-only user | Full parity path with no camera and no microphone | 01 → 03 → 07 |
| Design-partner admin | Invite members, set policy, verify installations, audit, answer a security questionnaire | 12 → 13 → 14 → 17 |

---

## 4. Information architecture

```
Docs/help/
  README.md                                index; the five reading paths above
  getting-started/
    01-what-airboard-is.md
    02-system-requirements.md
    03-your-first-board.md
  using-the-board/
    04-commands.md
    05-airo-voice.md
    06-gestures.md
    07-keyboard-pointer-and-touchpad.md
    08-screen-and-camera-composition.md
    09-boards-versions-and-export.md
  integrations/
    10-google-meet.md
    11-desktop-overlay.md
  account/
    12-account-trial-and-billing.md
    13-admin-console.md
    14-privacy-and-your-data.md
  reference/
    15-troubleshooting.md
    16-error-codes.md
    17-limits-and-support-matrix.md
```

### 4.1 Per-document specification

| # | Document | Must answer | Source of truth | How it gets verified |
| --- | --- | --- | --- | --- |
| 01 | What Airboard is | What the product does, the four surfaces, what "no confirmation, undo is the safety net" means and why | `README.md`; [Augmented Experience Vision](./Augmented%20Experience%20Vision%20and%20Interaction%20Spec.md) §1–2 | Product read-through |
| 02 | System requirements | Browsers, camera, microphone, lighting, network, which capabilities need which provider keys | `Intent Canvas Implementation Notes.md` "Browser and Hardware Limits"; `Platform Support Matrix.md` (after RGB-034) | Manual matrix test |
| 03 | Your first board | Sign up → create a board → place two objects → connect them → rename → undo, with a typed-only path and a voice path | `Dashboard.tsx`; `BoardsPage.tsx`; manual walkthrough | Perform end to end |
| 04 | Commands | The full grammar; node types; placement words; what happens when a command is not understood; the deterministic vs. semantic distinction in plain language | **Generated** from `packages/core/src/semanticCapabilities.ts:40,205,259,277` and `OBJECT_CATALOG` (`AirboardPrototype.tsx:417`) | Generator + `pnpm eval:grammar` corpus |
| 05 | Airo voice | Start Airo once; open-palm push-to-talk; the "Airo" wake fallback; hold-to-edit; what to do with a misheard command; why ordinary meeting talk is safe | `README.md` "Realtime Voice"; `voiceCommandRouter.ts`; Vision spec §2, §5 | Live session with a microphone |
| 06 | Gestures | Every shipped pose with exact performance; confusable pairs and how to avoid them; what is deliberately *not* a gesture and why | [Gesture Interaction Audit](./Gesture%20Interaction%20Audit.md) — the single best existing source; use its tables near-verbatim | Live session with a camera; feeds the trainer (§6) |
| 07 | Keyboard, pointer, touchpad | Every shortcut; the complete camera-off, microphone-off parity path | **Generated** from the keydown handler (`AirboardPrototype.tsx:5924`–`6090`): `Cmd/Ctrl+Z`, `Shift+H`, `Space`, `Tab`/`Shift+Tab`, `Enter`/`F2`, `Escape`, hold `V`, `E`, `Shift`, `Alt`, `Ctrl/⌘+wheel` | Keyboard-only run of doc 03 |
| 08 | Screen and camera composition | Use screen, camera underlay, dark overlay dial, snap-to-hide, studio recording, what the audience sees | `README.md` "Screen and camera composition"; `lightboardComposition.ts` | Manual, with a second viewer |
| 09 | Boards, versions, export | Save, rename, versions, share/visibility, Trash and restore, PNG export, templates | `BoardsPage.tsx`; `ProductSection.tsx`; `boardLifecycle.ts` | Manual |
| 10 | Google Meet | Install, connect, media confirmation, the six readiness checks by name, receiver verification, what the audience sees, uninstall/revoke | `extensions/chrome-meet-bridge/README.md`; `popup.html` readiness list; [Meet Camera Composite Verification](./Meet%20Camera%20Composite%20Verification.md) | Two-account real call |
| 11 | Desktop overlay | Launch, click-through model, `Cmd/Ctrl+Shift+O`, `Cmd/Ctrl+Shift+H`, tray controls, and the unsigned-preview caveat | `README.md` "Native desktop overlay"; `apps/desktop/src/overlayWindow.mjs` | Manual on macOS |
| 12 | Account, trial, billing | Sign-up, invitations, the 72-hour value-triggered trial, what happens at expiry, why checkout may be unavailable | [Commercial Platform Runbook](./Commercial%20Platform%20Runbook.md); `BillingPage.tsx` | `pnpm smoke:commercial` |
| 13 | Admin console | Members and roles, policies, SSO/SCIM configuration, installation health, audit log export, deleted-board recovery window | `AdminPage.tsx`; `controlPlaneRoutes.ts`; Commercial Platform Runbook | Manual as an owner account |
| 14 | Privacy and your data | What is processed vs. stored, per provider; voice-trace retention (14 days); analytics; export and deletion, including the 7-day cancellation window | `Official Launch Readiness.md` "Data inventory and enforced retention"; **after RGB-036 is fixed** | Cross-check against `/privacy` and the retention jobs |
| 15 | Troubleshooting | Symptom-first: hands not detected, voice unavailable, command rejected, Meet shows no overlay, board will not save, sign-in loop | Error-code map; `chromeMeetReadiness.ts`; support intake patterns | Each entry reproduced once |
| 16 | Error codes | Every stable code, plain-language meaning, user action, whether to contact support | **Generated** by scanning `apps/api/src`, `apps/web/src`, `extensions/chrome-meet-bridge` | Generator + CI diff gate |
| 17 | Limits and support matrix | What is preview vs. shipped; concurrency, session, size and rate limits; explicitly unsupported things | `Platform Support Matrix.md` (after RGB-034); `apps/api/src/config.ts` | Config read-through |

---

## 5. Anti-drift strategy

This repo already gates merges on evidence (`pnpm eval:grammar`,
`pnpm eval:false-accepts`, `pnpm launch:check`). Help docs get the same
treatment, because the four RGB drift defects show that hand-maintained prose
about this codebase does not survive contact with the release cadence.

**Three mechanisms:**

1. **Header block on every file.** Status, last-verified date, the commit it
   was verified against, and an explicit `Sources:` list of code paths. A
   reviewer can then tell at a glance whether a page predates the change they
   are reviewing.

2. **Generate the volatile references.** New
   `scripts/generate-help-reference.mjs` writes marked regions inside three
   documents:

   | Document | Generated from |
   | --- | --- |
   | `04-commands.md` | `AIRBOARD_SEMANTIC_NODE_CAPABILITIES`, `AIRBOARD_SEMANTIC_ACTION_CAPABILITIES`, `AIRBOARD_SEMANTIC_OPERATION_CAPABILITIES`, `AIRBOARD_SEMANTIC_CANONICAL_FORMS`, `OBJECT_CATALOG` |
   | `07-keyboard-pointer-and-touchpad.md` | The keydown handler's key/modifier branches |
   | `16-error-codes.md` | Error-code literals across API, web, and extension |

   Prose stays hand-written around the generated blocks; only the tables are
   machine-owned.

3. **CI gate.** `pnpm docs:check` — regenerate, fail on diff; fail on broken
   relative links; fail on banned claim strings (the §2.4 list). Add it to the
   existing `verify` job in `.github/workflows`, next to the eval gates.

**Prerequisite:** RGB-034 through RGB-037 are fixed *before* the affected help
pages are written, not after. Doc 06 can start immediately — the Gesture
Interaction Audit is current as of 26 July 2026 and is not implicated.

---

## 6. In-product guided onboarding

Scope confirmed as full `ONB-008` + `ONB-014`. Both are P0 in the Gesture
Interaction Audit backlog and NOT STARTED in the
[Public Beta checklist](./Public%20Beta%20Readiness%20and%20Platform%20Onboarding%20Checklist.md):

> **ONB-008** — The user practices choose, move, place, erase, undo, snap, pan,
> and zoom; sees pose/contact/release quality and conflict explanations;
> completes a sample object journey; and can retry or choose another input mode.
>
> **ONB-014** — A user can calibrate dominant hand, comfortable range, camera
> framing, close-hand strength, and thumb-middle snap timing; preferences remain
> private and can be reset without storing raw landmarks.

### 6.1 What the docs supply

The "conflict explanations" requirement in ONB-008 is already written — it is
the **Confusable gesture pairs** table in the Gesture Interaction Audit
(push-to-talk vs. undo, aim vs. push-to-talk, move vs. place vs. erase, move
vs. scoped voice edit, one-hand move vs. two-hand zoom, two-open-hand pan vs.
open-palm undo, eraser vs. move). Doc 06 turns each row into a user-facing
"if this happens, do this" explanation, and the trainer shows the matching
explanation when it detects that specific confusion live.

### 6.2 Proposed structure

| Piece | Location | Responsibility |
| --- | --- | --- |
| Trainer UI | `apps/web/src/features/onboarding/GestureTrainer.tsx` (new) | Eight practice stations, one per ONB-008 gesture, plus the sample object journey |
| Pose-quality channel | `packages/gesture-engine` (extend) | Expose the pose scores, contact/release evidence, and arbitration owner that the engine already computes internally, as a read-only per-frame quality signal |
| Calibration | `apps/web/src/features/onboarding/gestureCalibration.ts` (new) | Dominant hand, comfortable range, camera framing, close-hand strength, snap timing. Derived scalars only — **never raw landmarks**. Persisted via `/me/preferences`, mirrored to `localStorage`, resettable |
| Route | `apps/web/app/app/onboarding/gestures/page.tsx` (new) | `/onboarding` currently just redirects to `/app` (`apps/web/app/onboarding/page.tsx`) |
| Entry points | `AppShell.tsx` sidebar; replace the current first-run overlay (`AirboardPrototype.tsx:7561`) with a launcher | Also reachable any time, not only on first run |
| Analytics | Existing content-free event pipeline | The `ONB-013` subset: calibration pass, first successful object, fallback chosen, abandonment |

**Two constraints worth stating up front.** First, `AirboardPrototype.tsx` is
9,033 lines; the trainer must be a sibling that consumes the gesture engine,
not more code inside that file. Second, the trainer needs a live pose-quality
signal the engine does not currently export — that engine change is the real
technical risk in this phase, and it should be spiked before the UI is built.

**Camera-off parity.** The trainer must offer "use pointer and keyboard
instead" at every station and route to doc 07, per ONB-008's "choose another
input mode" clause and the repo's standing parity principle.

---

## 7. Phasing

| Phase | Deliverable | Depends on |
| --- | --- | --- |
| **0. Repair and scaffold** | Fix RGB-034/035/036/037. Create `Docs/help/` tree, `README.md` index, header-block template, style guide (§8) | — |
| **1. Core end-user docs** | 01, 02, 03, 04, 05, 06, 07 | Phase 0; doc 06 can start in parallel |
| **2. Surfaces and account** | 08, 09, 10, 11, 12, 13, 14 | Phase 0 (14 needs RGB-036); doc 10 needs a two-account call |
| **3. Reference and gate** | 15, 16, 17, `scripts/generate-help-reference.mjs`, `pnpm docs:check`, CI wiring | Phase 1 |
| **4. Guided practice (ONB-008)** | Pose-quality channel spike → trainer UI → eight stations → sample journey | Doc 06 finalized; engine spike |
| **5. Calibration (ONB-014)** | Calibration flow, persistence, reset, privacy review | Phase 4 |

Phases 1 and 2 are independent of 4 and 5 and can run concurrently. Phase 3
should land before Phase 4 so the trainer's copy is already under the drift
gate.

---

## 8. Style guide (to be written as part of Phase 0)

- Second person, present tense, imperative for procedures. No marketing
  adjectives — this is help, not the landing page.
- **Every camera or microphone instruction states its camera-off equivalent
  in the same block.** Not in a separate appendix.
- Gesture descriptions use the exact performance language from the Gesture
  Interaction Audit, near-verbatim. Paraphrasing pose descriptions is how
  timing details ("about 0.4 seconds", "release before another undo") get
  lost.
- Explain the *why* for safety behavior: no confirmation step, undo as the
  safety net, ambient speech that cannot mutate the board.
- Preview or gated capabilities carry a one-line status callout, using the
  wording already established on the marketing pages.
- Symptom-first headings in troubleshooting ("Airboard does not see my hands"),
  not cause-first.
- Screenshots deferred until Phase 3 — see §10.

---

## 9. Verification

A help page is not done when it is written; it is done when someone has
performed it. Per-document verification is listed in §4.1. The end-to-end
check for Phases 1–3:

1. Give docs 01–03 to someone who has never used Airboard, camera off. They
   should reach a connected two-node diagram without asking a question.
2. Repeat with camera and microphone on, using docs 05 and 06.
3. Give doc 10 to a tester with a second Google account and require the
   receiver-side confirmation from
   [Meet Camera Composite Verification](./Meet%20Camera%20Composite%20Verification.md).
4. Give doc 13 to a design-partner admin on a fresh organization.
5. Run `pnpm docs:check`, `CI=true pnpm test`, `CI=true pnpm typecheck`.

---

## 10. Open questions

1. **Screenshots and GIFs.** Gesture documentation is substantially weaker as
   text alone, but binary assets in `Docs/` have no review or refresh process
   and will drift faster than the prose. Recommendation: ship Phases 1–3 as
   text, and let the Phase 4 trainer be the visual channel. Needs a decision
   before Phase 1 completes.
2. **Support contact.** `hellosigmascience@gmail.com` is what the code and
   marketing pages use (`PilotInfoPage.tsx:3`). Confirm this is the channel
   help docs should direct users to, or supply the real one.
3. **Relationship to `/pilot/*` and the extension README.** Both overlap docs
   10 and 14. Recommendation: leave them in place, and have them link into
   `Docs/help/` rather than restating — but that only works once the help
   files are reachable by a URL, which this pass does not create.
4. **Reachability.** Repo-only Markdown means a pilot user cannot read any of
   this. The trainer covers gestures; commands, troubleshooting, and admin have
   no user-visible home until the `/docs` route work happens. Worth scheduling
   as a follow-up pass.

---

## Change log

- **2026-07-30** — Plan created from a review of the repository, all 23 `Docs/`
  files, and every user-facing surface. No content written.
