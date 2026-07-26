# Augmented Experience Vision and Interaction Spec

Status: **Product/UX design (proposed).** Successor to the Intent Canvas confirmation-gate
removal (2026-07-12). Defines the target augmented experience, the addressing model,
gesture vocabulary, catalog UI, experience gaps, user stories, and phased scope.

## 1. Product Thesis

Airboard is not a whiteboard app with voice bolted on. It is a **meeting-native augmented
surface**: the board behaves like a silent, competent participant in the conversation.
Users talk to *people*; the board keeps up. Explicit control (voice command, gesture) is
available at all times, but the ideal session has almost no moments where the user is
visibly "operating software."

Design principles, in priority order:

1. **Never confuse meeting talk with commands.** A false action during a live meeting is
   the worst failure mode — worse than a missed command.
2. **Explicit acts, ambient suggests.** Anything that mutates the board comes from an
   explicit channel. Passive listening may only produce suggestions that require an
   explicit accept.
3. **No confirmation, full transparency.** Commands commit instantly (already shipped).
   The substitute for confirmation is *visible feedback*: a heard-transcript chip, an
   action toast with one-tap undo, and ghost trails during placement.
4. **Small vocabulary, high confidence.** Fewer verbs, each near-perfect, beats a large
   flaky grammar. Context (a held element, an open catalog) shrinks the grammar further.
5. **Chrome earns its pixels.** Buttons exist only as fallback for camera-off/mouse-only
   users, and they get out of the way when the camera is on.

## 2. The Addressing Model (replaces per-line wake word)

### 2.1 Problem

- Saying "Airo" before every command is fatiguing and unnatural ("no one can say Airo
  in every line").
- Users forget the wake word and their instruction is silently dropped.
- An always-open mic in a meeting would misroute speech directed at other invitees.
- "Airo" itself is an uncommon token that STT frequently mangles.

### 2.2 Two-channel architecture

| | Command channel | Ambient channel |
|---|---|---|
| Addressed by | Gesture gate (primary), "Airo" wake word (fallback) | Nothing — passive meeting transcription, **opt-in** |
| Power | Mutates the board instantly, no confirmation | **Can never mutate the board.** Renders ghost suggestions only |
| Failure mode | Missed command → user repeats | Unwanted ghost → fades in ~8s, ignored |
| STT posture | Short, VAD-segmented clips inside the gesture window; scoped grammar | Continuous; lightweight diagram-intent classifier |

The safety property is structural, not statistical: because ambient speech can only
*suggest*, the intent classifier does not need to be perfect. Misclassification costs a
fading ghost, never a board mutation.

### 2.3 Command channel: gesture-gated voice

- **Push-to-talk pose:** hold Airboard's landmark-defined Victory / V sign
  still for about 0.4 seconds. While held, a mic ring renders at the cursor;
  speech is captured; release (or trailing silence) finalizes the utterance.
  No wake word is needed after the one-time Start Airo microphone action.
- **Hold-to-edit (scoped commands):** grabbing an element and holding it still ~600ms
  puts it in a *scoped* state — mic ring attaches to the element, and utterances are
  parsed against a small edit grammar applied to that element: rename, retype ("make it
  a queue"), recolor, delete, duplicate, "connect to <label>". Holding the object *is*
  the wake word. Also triggered by mouse: select an element → same scoped mic via
  hotkey (hold `V`) for camera-off parity.
- **Deixis fusion:** the gesture pointer trail is recorded with timestamps. Demonstratives
  ("this", "that", "here") resolve against the pointer position at the word's onset time,
  enabling "connect *this* to *that*" and "move the database *here*."
- **Wake word fallback:** "Airo, …" continues to work everywhere (camera off, hands
  occupied). Also accept the common STT aliases of "Airo" (already partially handled by
  `recoverAirboardVoiceCommand`).

### 2.4 Ambient channel: ghost suggestions (opt-in)

- With explicit opt-in (and a persistent on-screen "ambient listening" indicator for
  meeting trust), Airboard transcribes meeting audio continuously and runs a
  diagram-intent classifier over finalized utterances.
- Strong diagram narration ("the user hits the payments API which writes to the ledger")
  produces a **ghost suggestion**: dashed elements positioned near the relevant board
  region with a small "grab to add" affordance.
- Accept by grabbing the ghost, or via command channel ("add that"). Ignore and it fades.
  Multiple pending ghosts stack in a suggestion tray at the canvas edge.
- Privacy: ambient audio is never stored; only finalized transcripts hit the classifier;
  the indicator is non-dismissable while ambient mode is on.

## 3. Gesture Vocabulary (v2)

Deliberately small; every pose must be reliably separable in Airboard's
HandLandmarker-backed pose and motion harness before it ships.

| Gesture | Hands | Context | Action | Status |
|---|---|---|---|---|
| Open palm point | 1 | Canvas | Cursor / hover highlight | shipped |
| Close hand (grab) on element | 1 | Canvas | Grab → move; reopen = drop | shipped |
| Grab + hold still ~600ms | 1 | On element | **Scope element** → scoped voice edit | shipped |
| Victory / V sign, held still ~400ms | 1 (only tracked hand) | Anywhere | **Push-to-talk** (command mic) | shipped |
| Open palm, swipe left | 1 (only tracked hand) | Anywhere | **Undo** one action or cancel an interpreting command | shipped |
| Point + pinch on dock | 1 | Catalog dock | Open category / arm shape tool | shipped |
| Two open palms, move together | 2 | Anywhere | **Pan** the canvas (bounded infinite plane) | shipped |
| Two closed hands, spread/converge | 2 | Anywhere | **Zoom** (anchored at hand midpoint, 25–300%) | shipped |
| Close hand on EMPTY canvas + drag | 1 | Select tool | No action; gesture lasso removed until group actions have a complete product purpose | removed |
| Grab a corner handle of the selection | 1 | Selected object | No camera action; use pointer handles or typed/voice resize | removed |
| Point at A … point at B while speaking | 1 | With deixis | Resolves "this/that/here" | P1 |
| Grab a ghost suggestion | 1 | On ghost | Accept suggestion | P1 |

Canonical recognition architecture (2026-07-26, as built):
`HandLandmarker.detectForVideo()` is the only camera inference path. It emits
21 landmarks per hand. Airboard computes pose evidence from those landmarks,
feeds it to temporal state machines for hold/swipe/contact-release behavior,
and arbitrates one owner per frame. The MediaPipe `GestureRecognizer` and its
canned labels are not runtime inputs.

Separation model (2026-07-26, as built): **hand count is the first-level switch** —
two-hand navigation outranks and suppresses every single-hand gesture (object
controller reset, voice/undo gates suppressed); within two-hand, pose separates pan (open)
from zoom (closed) and a session never morphs between them (release-then-re-engage
with debounce and flicker-rebase). Within one-hand, location separates the dock
(screen-space hit test, wins over board objects) from the canvas, and pose separates
point / grab / Airboard-defined command pose; push-to-talk requires Victory
geometry plus a stable hold while Undo requires open-palm geometry plus
leftward motion. Runtime ownership is Navigation → Snap → Undo → Victory/Voice
→ Move/Place/Erase. Mouse parity: ctrl/⌘+wheel
zooms at the cursor, plain wheel pans; the viewport
resets when switching input modes.

Explicitly **not** gestures (false-positive risk too high): delete and clear. These
stay voice ("delete this", "clear the board") and keyboard. Undo is the shipped
landmark-defined open-palm swipe-left motion gesture.

## 4. Shape Catalog (replaces the button stack)

- The left toolbar button list becomes **catalog tabs docked at left-center**, vertically
  stacked, icon + label: **Flow** (process, decision, start/end, connector), **System**
  (user, service, API, database, queue), **Annotate** (note, circle, box, highlight).
- Click / point-pinch a tab → flyout grid of shape thumbnails next to the dock.
- Drag a thumbnail to the canvas (mouse) or grab-and-drop it (hand) — ghost preview and
  snapping while dragging, exactly like existing placement.
- Flyout auto-collapses after a drop or on canvas focus; the dock idles at low opacity
  while the camera is on and the hand is not near it.
- Everything in the catalog remains voice-addressable ("add a queue between the API and
  the database") — the catalog is the browse/fallback path, not the primary path.
- Top bar (camera, undo, pause, export, clear) collapses to a floating overflow HUD that
  fades while idle.

## 5. Voice Robustness Plan (STT gaps)

1. **Gesture-gated segments:** push-to-talk yields short, VAD-bounded, single-speaker
   clips — structurally better STT input than an open mic.
2. **Dynamic keyterm biasing:** feed the *current board's node labels* plus catalog
   vocabulary into Deepgram keyterms on each session/refresh (today
   `AIRBOARD_TRANSCRIPTION_KEYTERMS` is static). "Connect user to ePay API" should be
   biased toward the labels that actually exist on the board.
3. **Scoped grammars:** in hold-to-edit, rerank/restrict parsing to the edit verb set;
   in catalog context, bias toward shape names.
4. **Silent phonetic recovery, explicit channel only:** since confirmations are gone,
   a high-confidence acoustic-alias recovery ("at a data bass hear" → "add a database
   here") executes directly, but the heard-chip always shows `heard: …` with a one-tap
   undo, so recovery mistakes are visible and reversible in one action.
5. **Feedback layer as the confirmation substitute:** live transcript chip while the mic
   ring is open; action toast ("Renamed to Payments — Undo") after every commit.
6. **Negative-sample evals:** extend `pnpm eval:voice` with meeting-talk corpora that
   must NOT trigger (both channels). Track **false-accept rate per meeting-hour** as the
   headline safety metric (target ≈ 0 on the command channel gate).

## 6. Experience Gaps (identified)

1. **Addressing gap** — wake-word fatigue vs. mis-capture. → Two-channel model (§2).
2. **Feedback gap** — confirmations removed; nothing yet substitutes. → Heard-chip,
   action toasts with undo, ghost trails (§5.5).
3. **Discoverability gap** — nobody knows the gesture vocabulary. → First-run ghost-hand
   overlay tutorial; contextual hints ("hold the element to edit it by voice").
4. **Targeting gap** — "this/that/here" unresolvable today beyond a single pointer
   sample. → Deixis fusion (§2.3).
5. **Correction gap** — repair loop after a wrong action is undo-only. → "no, the other
   one", "rename it back", grab-to-adjust after commit.
6. **Chrome gap** — ~15 always-on buttons contradict the augmented thesis. → Catalog +
   fading HUD (§4).
7. **Multi-user gap** — in a real meeting, who controls the board? → Presenter token /
   per-participant cursors (depends on Board Sync design doc; later phase).
8. **Latency gap** — semantic model round-trips must feel < 1s in live conversation. →
   Optimistic ghost rendering while grounding completes; measure p95 end-to-action.
9. **Camera-off parity gap** — every gesture affordance needs a mouse/keyboard twin
   (scoped edit via selection + hold-`V`, catalog via click).
10. **Trust gap** — ambient listening in meetings is sensitive. → Opt-in, persistent
    indicator, no audio retention (§2.4).

## 7. User Stories

**Epic A — Command without ceremony**
- As a presenter, I hold a V sign and say "add a payment service next to the API" and
  it appears — no wake word, no button, no confirmation.
- As a presenter, I grab the ePay node, hold it, say "rename to Ledger API", and it's
  renamed the moment I finish speaking.
- As a presenter mid-sentence to a colleague, nothing I say changes the board.

**Epic B — The board keeps up (ambient)**
- As a facilitator narrating a flow, I see the board sketch a ghost of what I described;
  I grab it to keep it or ignore it and it fades.
- As a privacy-conscious participant, I can see at a glance whether ambient listening is
  on, and it's off by default.

**Epic C — Direct manipulation**
- As a user, I open the System catalog, drag a Queue between two nodes, and connectors
  re-snap around it.
- As a user, I point at two nodes and say "connect this to that" and get a labeled edge.
- As a user, I pan and zoom with my hands without touching the mouse.

**Epic D — Trust and repair**
- As a user, after every voice action I see what was heard and what was done, with a
  one-tap/one-word undo.
- As a user whose command was misheard, I say it again (or grab-fix the result) — I am
  never interrogated with "did you mean…?".

**Epic E — Fallback parity**
- As a camera-off user, I can do everything with mouse + typed commands, including
  scoped element edits.

## 8. Scope and Phasing

**P0 — the augmented core (shipped 2026-07-12)**
1. Gesture-gated push-to-talk (`Victory` held for ~400ms) replacing per-line wake word; "Airo"
   kept as fallback. — `packages/gesture-engine` (new pose + state), `realtimeSpeech.ts`
   (mic gating), `AirboardPrototype.tsx` (mic ring UI).
2. Hold-to-edit scoped commands on grab-hold / selection. — gesture-engine hold
   detection, scoped grammar in `intentCanvasParser.ts` + semantic contract context,
   element mic-ring UI.
3. Feedback layer: heard-transcript chip + action toast with undo. — `AirboardPrototype.tsx`.
4. Shape catalog dock + flyout replacing the button stack. — `AirboardPrototype.tsx` UI.
5. Dynamic STT keyterm biasing from board labels. — `realtimeSpeech.ts`, API config route.
6. Negative-sample voice evals + false-accept metric. — `scripts/eval-voice-intent.mjs`,
   `evals/`.

**P1 — the magic**
7. Deixis fusion (pointer-trail timestamp resolution for this/that/here).
8. Ambient suggestion channel with ghost suggestions (opt-in + indicator).
9. HUD fade / chrome minimization; two-hand pan/zoom.
10. First-run gesture tutorial overlay.

**P2 — meeting-scale**
11. Multi-participant control (presenter token, per-user cursors) — after Board Sync
    wiring lands.
12. Gaze-assisted addressing (look-at-camera as an additional gate signal).
13. Meeting-summary auto-diagramming ("draw what we discussed in the last 10 minutes").

## 9. Success Metrics

- **False accepts / meeting-hour** (command channel): ≈ 0. The trust metric.
- **Command success rate** (intended action on first utterance): > 90% on the P0 grammar.
- **% of actions via voice/gesture vs. buttons** in camera-on sessions: > 80%.
- **Time-to-diagram** for a scripted 6-node flow vs. clicking: at parity or better.
- **Corrections per command** (undo/retry within 10s of a commit): < 0.1.
- p95 end-of-speech → visible board change: < 1s deterministic, < 2.5s semantic.
