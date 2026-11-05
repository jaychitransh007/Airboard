# System Architecture Review and Gap Analysis

Status: **Assessment (2026-07-12) — convergence plan EXECUTED (2026-07-13).** All five
phases of §5 shipped as commits on `main`: Phase 0 (git + CI), Phase 1 (interaction-core
extraction: voiceCommandRouter / palmGateTracker / holdToEditTracker / intentPipeline,
monolith 6,705 → ~5,600 lines, Playwright E2E), Phase 2 (board sync live end-to-end,
two-browser acceptance test), Phase 3 (151-case positive grammar corpus + false-accept
negatives as CI merge gates; GET /voice/metrics), Phase 4 (API token + rate limits,
physical_marker removed from the product surface, permissions join-flow gap closed,
advanced-settings collapse, onboarding overlay, landmark-trace replay harness + in-app
recorder). One correction to §3/§5: `permissions.ts` was NOT dead code — it authorizes
every WS event; the actual gap was the REST join flow bypassing `canJoinBoard`, now
fixed. The assessment below is preserved as written for historical context.

---

## 1. The system as actually built

~24,500 lines of TypeScript across two apps and five packages.

```
┌────────────────────────────────────────────────────────────────────────┐
│ apps/web                                                               │
│                                                                        │
│  AirboardPrototype.tsx ──────────────── 6,705 lines (27% of codebase) │
│    49 useRef · 53 useState · 59 useCallback · 17 useEffect             │
│    owns: camera loop, gesture handling, 3 input modes, 2 speech        │
│    engines, wake router, voice gates, parser orchestration, semantic   │
│    fallback, grounding, undo, selection, catalog UI, toasts, keyboard, │
│    drag-drop, stats, debug panels                                      │
│                                                                        │
│  Pure modules (tested):                                                │
│    intentCanvasParser.ts (1,052) · browserSpeech.ts (793)              │
│    realtimeSpeech.ts (877) · semanticIntent.ts (383)                   │
│    gestureAnnotationMode.ts (1,275) · touchpadMode.ts · voiceTrace.ts  │
└────────────────────────────────────────────────────────────────────────┘
          │ WS /transcription/ws          │ POST /intent/resolve · /voice/trace
          ▼                               ▼
┌────────────────────────────────────────────────────────────────────────┐
│ apps/api (Fastify, 465-line server)                                    │
│   /transcription/* → Deepgram Flux proxy (keyterms, models)            │
│   /intent/*        → OpenAI Responses adapter (strict function call)   │
│   /voice/trace     → bounded voice observability ingestion             │
│   /sessions/* + /ws → board session + sync endpoints  ← DEAD WIRE      │
│   Session stores: in-memory + Supabase (storeFactory)                  │
└────────────────────────────────────────────────────────────────────────┘

packages/
  core            boardReducer (382) · diagramCommands (1,088) · semanticPlan (693)
                  events · permissions ← permissions used by NOTHING
  gesture-engine  hybridGestureController (588) · pipeline (505) · classifier
                  grabStrength · palmPresentation · friction (776) ·
                  physicalMarker (446, mode declared, near-dead)
  drawing-engine  renderer (735) · hitTest · connectorGeometry
  realtime-client WS board-sync client ← imported by NOTHING in web
  integrations    googleMeetAdapter ← builds URLs the pages never read
```

### The three dead wires (verified)

1. **Board sync does not exist end-to-end.** The web app never calls
   `POST /sessions/start`, `/join`, `/heartbeat`, `/state`, or the board `/ws`. The only
   WS the web opens is transcription. `BOARD_SESSION_ID = "local-standalone-board"` is a
   compile-time constant; `applyLocalEvent` mutates a local ref and nothing else.
2. **The Meet surfaces are the standalone board re-exported.**
   `app/meet/main-stage/page.tsx` renders `<AirboardPrototype surface="meet-main-stage" />`
   verbatim; `googleMeetAdapter` puts `boardSessionId` into URLs no page parses.
3. **No persistence.** The standalone board lives only in `boardRef`. A refresh destroys
   the meeting's artifact. (The one `localStorage` reference is a glossary cleanup.)

This was already documented as deferred in *Board Sync and Meet Session Wiring —
Design Plan*; the gap analysis point is that **everything above it was built first.**

### The engineering system around the code

- **No git repository.** 24.5k lines with zero version control: no history, no diff, no
  bisect, no revert. Every regression hunt is archaeology.
- **No CI.** Typecheck/tests/evals run only when someone remembers.
- **Test inventory: 16 files, ~125 cases — all on leaf modules.** Parser, speech
  plumbing, reducer, gesture math, API adapters: genuinely well covered. The
  6,705-line orchestrator where all five subsystems meet: **zero tests.** No React
  component tests, no Playwright, no E2E of even one happy path.

---

## 2. What is genuinely solid

Credit where due — the leaves are in better shape than the "not ready" feeling suggests:

- **Core event model.** Append-only board events through a pure reducer with undo
  restore events; deterministic, replayable, unit-tested. It is exactly the substrate a
  sync layer wants (which makes the missing sync layer more frustrating, not less).
- **Gesture engine internals.** Hysteresis, sticky targeting, grace windows,
  tracking-loss semantics, grab-confidence handling are thoughtful and tested (20 cases).
  The failure modes it guards against (slip on uncertain frames, swept-in latching) are
  real ones.
- **Voice safety posture.** The two-channel addressing design; parse-level fail-closed
  behavior; the offline false-accept eval (42 meeting utterances, 0 hard accepts) that
  already caught a real grammar overreach on its first run.
- **Voice observability design.** `voiceTrace` stages (capture → stt → wake → parse →
  ground → apply/fail) with bounded payloads is the right shape for diagnosing exactly
  the accuracy problems the product has.
- **Provider abstraction in the API.** Deepgram and OpenAI are behind protocol modules
  with allowlisted models and strict validation; swapping providers is plausible.

The problem is not the quality of the pieces. It is what sits between them, and what
was never built.

---

## 3. Why it feels "fundamentally not ready" — the five systemic gaps

### Gap 1 — All integration lives in one untested closure (the actual cause of the back-and-forth)

Every bug of the last three sessions — confirmation gate friction, double-routing risk,
the "Uh," fast-path miss, the cursor-churn staleness kill — was an **interaction between
subsystems**, not a defect inside one. Those interactions all live in
`AirboardPrototype.tsx`, coordinated through 49 mutable refs with manually maintained
ref↔state mirrors (`pendingIntentRef`/`pendingIntent`, `voiceGateRef`/`voiceGate`,
`selectedAnnotationIdsRef`/`selectedAnnotationIds`…).

Consequences:

- No integration seam can be tested, so **every integration bug ships and is found by a
  human in a live session.** That is the back-and-forth loop, mechanically.
- Each fix adds another ref and another effect to the same closure (the voice gates I
  added this week included — they follow the house style, and they deepen the problem).
- The cursor-staleness bug is the canonical example: `cursor.moved` events (presence)
  and staleness checks (planning) were designed years apart in the same file and nobody
  — human or test — could see they interact at 60 fps.

**The codebase's risk is inverted: 100% of test coverage sits where ~20% of the bugs
are.**

### Gap 2 — The product thesis is unimplemented

The PRD and architecture plan define Airboard as **meeting-native**: an owner starts a
board, participants collaborate live inside Meet. As built: single-user, single-tab,
in-memory, non-persistent. The sync design doc exists and is good; zero of it is wired.
Everything shipped so far — gestures, voice, catalog — polishes the *input* pillar of a
product whose *defining* pillar (shared board in a meeting) hasn't started. No amount of
input polish makes the system "ready" while a refresh deletes the meeting's whiteboard
and a second participant cannot exist.

### Gap 3 — Voice accuracy is patched, not measured

The utterance path is a chain of independent regex sieves: `cleanText` → wake router →
`normalizeBrowserWakeCommand` → `stripCourtesy` → grammar → scoped normalizer → phonetic
recovery → semantic fallback. Each accuracy bug ("and a" for "add a", "Uh," fillers,
clause labels) has been fixed by hand-patching one sieve. What does not exist:

- **A positive corpus.** The offline eval covers only *negatives* (meeting talk that
  must not execute). There is no offline corpus of "things users actually say → expected
  command" for the deterministic layer, so every regex change is verified by vibes plus
  whatever unit tests someone remembers to add. (`eval:voice` covers the LLM path only
  and needs a live key.)
- **Aggregation of voiceTrace.** Stages are collected and stored; nothing computes
  command success rate, false-accept rate, or p95 end-of-speech→board-change. The spec
  defines these as the product's headline metrics; today they are write-only data.

### Gap 4 — The gesture layer has no ground truth

`estimatePalmPresentation` thresholds (0.62/0.45), grab thresholds (0.68/0.38), hold
timings (600 ms) are calibrated against synthetic landmark fixtures and intuition. There
is no corpus of **recorded landmark traces** (real hands, real lighting, real webcams)
replayed in tests. Until that exists, every threshold change is a gamble validated by
one person waving at one laptop — pose-detection quality cannot converge, only wander.
Additionally, three input generations coexist (`touchpad`, `gesture`,
`physical_marker` + legacy marker/duster classifier + friction engine), multiplying the
state space the one big component must handle; at least one (`physical_marker`, 446
lines + mode plumbing) appears to have no live product story.

### Gap 5 — Nothing distinguishes prototype scaffolding from product

The right sidebar exposes engine/model pickers, confidence sliders, snapping and debug
toggles in the primary UX. There is no auth, no user model, no rate limiting, and open
local CORS on an API that spends provider money (`/intent/resolve`, transcription
minutes). Acceptable for a localhost prototype — but it means "ready" has never been
defined, so the system drifts toward "demo that impresses" rather than "product that
survives a second user."

---

## 4. Readiness scorecard (against the product's own thesis)

| Pillar | State | Evidence |
|---|---|---|
| Augmented input (gesture + voice, single user) | **~70%** | Shipped and safety-evaled; thresholds uncalibrated against real-world corpus; discoverability untested |
| Command understanding accuracy | **~50%** | Deterministic layer solid but regex-patched; no positive corpus; semantic path unmeasured; latency unbudgeted |
| Meeting collaboration (the thesis) | **~5%** | API endpoints + design doc exist; zero client wiring; no persistence; no presence; no second user |
| Reliability engineering | **~15%** | Leaf unit tests good; no git, no CI, no integration/E2E tests, orchestrator untested |
| Security / tenancy | **~0%** | No auth anywhere; fine locally, blocks anything shared |
| Observability → decisions | **~30%** | Rich traces collected; nothing aggregated; headline metrics uncomputed |

"Fundamentally not ready" is accurate **for the product in the PRD**. It is *not* a
condemnation of the code: the leaves are good. The middle layer (orchestration) and the
defining pillar (sync) are the debt.

---

## 5. The convergence plan

The instinct to stop adding features is right. Ordered so each phase makes the next
cheaper; no rewrites — extractions.

### Phase 0 — Stop the bleeding (hours, do before anything else)
1. `git init`, initial commit, branch discipline. `.gitignore` already covers `.env`.
2. CI (GitHub Actions or equivalent): `pnpm typecheck && pnpm test && pnpm
   eval:false-accepts` on every push. The false-accept eval becomes a merge gate.
3. Freeze feature work until Phase 1 lands.

### Phase 1 — Extract the interaction core; make integration testable (the anti-back-and-forth phase)
Pull three seams out of `AirboardPrototype.tsx` into plain, React-free modules with
their own tests. The component becomes wiring + JSX.

1. **`voiceCommandRouter`** — one state machine owning: wake routing, voice gates
   (PTT/scoped/grace), confirmation words, filler stripping, scoped normalization,
   dedup between router and gates. Input: finalized transcripts + gate events. Output:
   `route(command, provenance)`. Property: *a transcript can never execute twice.*
   (Today that invariant is enforced by careful `if` ordering across two callbacks.)
2. **`intentPipeline`** — typed/voice text → deterministic parse → semantic fallback →
   grounding → commands, with staleness policy in one place. Pure async function over a
   `BoardSnapshot`; testable with fake clocks — the cursor-churn bug becomes a unit test.
3. **`interactionSession`** — grab/hold/scope/placement lifecycle (today: ~10 refs).

Then add the missing test layers: component tests for the wired prototype (canvas can
be shallow-faked) and **two Playwright E2E paths**: (a) type "add a circle here" →
circle exists; (b) simulated final transcript → node renamed. Those two tests would
have caught every regression the user hit this week.

### Phase 2 — Build the thesis: board sync (design doc already written)
Implement *Board Sync and Meet Session Wiring* as specced: `boardSessionId` from URL →
`POST /sessions/start`/`join` → event POST + `/ws` subscribe with server sequencing →
`applyLocalEvent` becomes `applyAndPublish`. Supabase persistence so refresh restores
the board. Presence via the already-flowing `cursor.moved` events. Acceptance: two
browsers, one board, live edits both ways, refresh-safe. `realtime-client` finally earns
its place (or is deleted in favor of a simpler client).

### Phase 3 — Voice accuracy as a measured system
1. **Positive corpus** (~100 utterances with expected parses, incl. disfluent variants)
   run offline in CI next to the negatives — every future grammar patch proves itself.
2. **Trace aggregation**: a small script/endpoint computing the spec's metrics (command
   success rate, false accepts/hour, p95 latency) from stored voiceTraces. Decisions
   from dashboards, not incident anecdotes.
3. Then — and only then — the ambient ghost-suggestion channel (P1 in the experience
   spec), because it needs the measurement rig to be tuned safely.

### Phase 4 — Product hardening
Collapse the debug sidebar behind a flag; decide `physical_marker`'s fate (ship or
delete, incl. the 446-line engine module); auth + per-user sessions (Supabase auth is
adjacent); rate limits on provider-spending endpoints; gesture ground-truth recordings
(landmark traces) for threshold calibration; onboarding overlay (P1).

### Delete/decide list (complexity that costs every day)
- `packages/realtime-client` — wire it in Phase 2 or delete it.
- `packages/core/permissions.ts` — used by nothing; wire in Phase 2 (owner model) or delete.
- `physical_marker` mode + `physicalMarker.ts` — no live story; decide.
- Browser speech fallback (`BROWSER_SPEECH_FALLBACK_ENABLED`) — dual engines double the
  routing matrix; keep only if a real user population needs it.

---

## 6. Bottom line

The system is a **well-built single-user input prototype wearing the clothes of a
meeting product**. The back-and-forth is not bad luck: integration logic is
concentrated in one untestable place, the input stack's accuracy is unmeasured, and the
collaboration pillar — the reason the product exists — is dead wire. The leaves don't
need rewriting; the middle needs extracting, the thesis needs building, and the
engineering loop (git → CI → integration tests → corpora → metrics) needs to exist so
that progress compounds instead of oscillating.
