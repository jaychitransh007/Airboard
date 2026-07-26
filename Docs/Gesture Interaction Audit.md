# Airboard gesture interaction audit

> **Status:** Implemented gesture vocabulary and product-gap source of truth
> **Last reviewed:** 26 July 2026
> **Primary audiences:** Corporate employees, content creators, and online tutors

Airboard uses gesture context, not pose alone. A closed hand has a different
effect when Select, a placement tool, or Eraser is active. The UI must always
name the active context and provide pointer, keyboard, menu, or voice fallbacks.

## Supported gestures

| Gesture | Exact performance | Context and result | Availability |
| --- | --- | --- | --- |
| Aim / hover | Move one relaxed hand | Moves the air cursor and highlights targets | Hands-enabled canvas and meeting companion/overlay |
| Choose tool or select | Aim at a dock control or object, start closing one hand, then reopen without dragging | The first dock target reached during that close activates, or the object remains selected | Intent Canvas |
| Move object | Keep Select active; close one hand over the object body, wait for “Move locked,” move, then reopen | Moves only the latched object | Intent Canvas |
| Place object | Choose a catalog item, move onto the canvas, close one hand, wait for “Holding,” position the preview, then reopen | Commits the selected object type | Intent Canvas |
| Erase | Choose Eraser first, close one hand over an object, wait for the erase state, sweep across targets, then reopen | Deletes touched objects as one recoverable undo action | Intent Canvas |
| Global push-to-talk | Start Airo once; hold one Airboard-defined Victory / V sign still for about 0.4 seconds; speak; lower or relax the hand | Opens and closes the global voice gate | Voice-capable hands surface |
| Scoped voice edit | Close one hand over an object and hold it nearly still for about 0.6 seconds; speak the change | Addresses the voice command to that object | Voice-capable hands surface |
| Undo | Show one Airboard-defined open palm and swipe left in one clear horizontal motion; release before another undo | Undoes one action or cancels an interpreting command | Hands-enabled surface |
| Hide / restore diagram | With one hand, touch thumb to middle finger while keeping thumb-index separated, then perform a fast middle-finger flick that increases the fingertip gap; return to neutral | Toggles diagram only after release motion, not on contact alone | Standalone canvas and meeting overlay |
| Pan canvas | Hold two open hands for about 0.15 seconds, then move them together | Pans the viewport | Intent Canvas |
| Zoom canvas | Hold two closed hands for about 0.15 seconds, then spread or converge them | Zooms around the hand midpoint | Intent Canvas |

Touchpad writing, keyboard shortcuts, toolbar controls, typed commands, and
voice commands are input fallbacks, not camera gestures.

## Open gesture backlog

| Priority | Missing capability | Why it matters |
| --- | --- | --- |
| P0 | Guided gesture practice with live pose-quality feedback | All three audiences need to know whether the camera sees the intended pose before a live session. Tracked as `ONB-008`. |
| P0 | Personal gesture calibration | Dominant hand, mobility, hand proportions, camera position, comfortable range, and timing vary. Tracked as `ONB-014`. |

Air ink/highlighter is not planned as an air gesture because writing without a
friction surface is tiring and imprecise. Touchpad or a future physical writing
surface remains the appropriate input. Redo, a cancel gesture, presenter
spotlight/laser pointer, and one-handed navigation are not current backlog
commitments.

## Confusable gesture pairs

| Gestures | Why they are close | Current separation | Remaining risk |
| --- | --- | --- | --- |
| Push-to-talk vs undo | Both are one-hand command gestures | Voice requires Airboard's two-raised/two-folded-finger Victory geometry plus a stable 0.4-second hold; Undo requires all four fingers open plus a left swipe | Low: the landmark definitions are mutually exclusive before their temporal trackers begin. |
| Aim vs push-to-talk | A casual hand can briefly resemble a command pose | Voice requires a high-scoring Victory geometry held still for 0.4 seconds; ordinary hover has no voice meaning | A user may naturally make a V sign while presenting; hold, cooldown, and one-shot latching reduce accidental activation. |
| Move vs place vs erase | All use a closed hand and drag | Select + object body means move; an armed catalog tool means place; Eraser means erase. The chosen mode locks until release. | If the active tool or lock feedback is not visible, the same pose appears unpredictable. |
| Move vs scoped voice edit | Both begin by closing over an object | Movement beyond tolerance locks out voice; a nearly still 0.6-second hold scopes speech | Fine positioning with a pause can feel like voice activation. |
| One-hand move vs two-hand zoom | Both use closed hands | Two-hand navigation now reserves the stream on its first valid frame, before its engage debounce, so a zoom cannot pre-grab an object | Tracking loss that drops one hand can end navigation; the release debounce prevents an immediate mode switch. |
| Two-open-hand pan vs open-palm undo | Both use open hands | Two tracked hands suppress every single-hand Undo action | One hand temporarily leaving frame ends the reservation after the navigation release debounce. |
| Eraser vs move | Both close over an object | Erasing requires Eraser to be the active tool; Select cannot erase | Mode visibility is essential in a live session. |

## Fixes applied in this audit

- Two-hand navigation reserves input from its first valid candidate frame, not
  only after the 150 ms engage debounce.
- `HandLandmarker.detectForVideo()` is the sole camera perception backend for
  every gesture. Airboard derives pose scores and motion from the same 21
  landmarks; the MediaPipe canned gesture classifier is not in the runtime.
- Voice and Undo use mutually exclusive Airboard landmark definitions:
  Victory (index and middle raised; ring and pinky folded) and open palm (all
  four fingers extended and palm presented), respectively.
- Runtime ownership is locked in this order: two-hand navigation, Snap, Undo,
  Victory/Voice, then Move/Place/Erase. A higher-priority candidate suppresses
  every action below it.
- Undo is suppressed while any voice gate is open.
- Push-to-talk is suppressed during navigation, movement, placement, erasing,
  paused input, and other active interactions.
- Gesture lasso multi-select was removed because the selected group had no
  complete group-action workflow.
- Dock targeting uses padded nearest-target acquisition and accepts a close
  started just before the cursor reaches the tool, with one activation per
  close/reopen cycle.
- Camera resize was removed entirely. Camera targeting now exposes committed
  object bodies only—never resize handles or empty-canvas selection regions.
  Pointer handles and typed or voice resize commands remain available.
- Snap now requires release-gap growth after thumb-middle contact; contact
  alone cannot toggle diagram visibility.
- The canvas settings include an exact gesture guide instead of the ambiguous
  instruction to “point with an open hand.”
- Empty landmark recordings are rejected locally with an actionable message;
  valid downloads now include capture-quality counts.

Landmark traces remain explicit, local diagnostic downloads. Airboard does not
record or upload hand landmarks automatically.
