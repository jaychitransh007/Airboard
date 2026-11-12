# Hands-free gaps in Airboard: what still pulls a presenter out of the meeting

I merged five code investigations into 12 gaps and kept the verifiers' corrections. Every gap was checked in the code or by running the real phrase rules and voice router on sample sentences.

**Path shorthand used in the Evidence lines:**
- `AP` = apps/web/src/features/board/AirboardPrototype.tsx
- `board/` = apps/web/src/features/board/
- `core/` = packages/core/src/
- `api/` = apps/api/src/

**Type tags:**
- **(a)** needs a click, keypress or approval
- **(b)** can't be done by voice or gesture
- **(c)** unreliable, slow or mishears
- **(d)** meeting-flow friction

**Terms used below:**
- **Built-in phrase rules**: fast, fixed patterns for short commands such as "add a user".
- **AI planner**: the language model that handles everything else, such as descriptions and unusual wording.

---

## Your complaint: "my voice is converted to text and then I have to approve and send"

**When voice works, nothing asks for approval.** A command Airo understands is applied straight away, the typing box clears, and you never press Send. The browser test "voice applies without its Send button" covers this.

**What makes it feel like "approve and send":**
1. **Every command addressed to Airo is copied into the typing box first** (`AP:7223`). This happens the moment it's heard, before Airo works out what it means. For the 1–5 seconds Airo is thinking, your words sit there next to a lit Send button, like a draft.
2. **If the command fails, your words stay there.** Send stays enabled, and the activity log says *"Could not apply. Edit the transcript below or repeat the command."* (`AP:7266-7271`). If something errors, the panel says *"Try the typed command field"*. Pressing Send just runs the same words through the same steps again, so it usually only works after you edit them by typing.

**When the text is left behind (a command counts as "failed"):**
- Airo asks a clarifying question, or decides it wasn't a board command or isn't supported.
- One step can't be matched to the board. The whole plan is then dropped.
- The board or the selection changed while Airo was planning.
- The plan needs more than 12 steps, or more than 40 changes.
- The AI planner:
  - times out (5 s on the server, 6 s in the browser),
  - hits a usage limit,
  - is unavailable because the pilot has ended,
  - is cooling down after repeated failures,
  - or its settings failed to load when the board opened.
- The diagram is hidden.
- The result is "already on the board". That also puts the text back (`AP:6598`, `AP:6816`).

**When it does not happen:**
- Talk that isn't addressed to Airo. It never enters the box.
- Commands that succeed.
- Undo and cancel.
- Commands the built-in phrase rules catch, such as "delete the service". These clear the box even when they fail, although the log still says "Edit the transcript below".

Gaps 3, 4, 5, 6, 10 and 11 below are the most common reasons a spoken command fails and ends up in that box.

---

## Breaks the hands-free promise

### 1. Voice commands that fail are left in the typing box for you to edit and send — (a)
- **What happens:** You say "Airo, put a cache between the API and the database". The AI planner rejects it, and the sentence sits in the Airo box with Send lit, next to "Edit the transcript below or repeat the command".
- **Why it matters:** The only recovery offered is the keyboard or saying the whole thing again. You only find out it failed by looking at the panel.
- **Fix:** Never put voice into the typing box; show it in a short-lived "heard" line instead. On a failure, retry or apply a best guess automatically, or give a short "say it again" cue.
- **Evidence:** `AP:7223` (copied in before interpreting); cleared only on success `AP:7124`, `6538`, `6316`, `6488`, `6493`; left on rejection `AP:7266-7271`; error path `AP:7295-7299`; re-written on "already there" `AP:6598`, `6816`; Send button `AP:11482-11492` reruns `runIntentCommand` `AP:7002`; browser test `voiceRouting.spec.ts:140` covers only the success case.

### 2. Shapes look the same but only half-work, depending on how they were made — (b)
- **What happens:** The board keeps two kinds of shape behind the scenes.
  - **Hands can't move shapes made by a short command, the toolbar, or your hand.** This covers "Airo, add a user", toolbar shapes, and shapes carried from the dock. You can't grab, move, erase or hold-to-edit them by hand. Closing your hand over one does nothing and shows no message, even though Airboard just said *"Close your hand over it to move it again."*
  - **Voice can't edit shapes Airo drew from a description by name.** Say "Airo, create a diagram where a user calls the API which writes to the database". Then "Airo, delete the database", "rename API to Gateway", "make the API red" and "connect User to API" are all rejected with *"I couldn't find a visible element matching that request."*
  - **Small wording changes decide which kind you get.** "add a database" makes one kind; "please add a database" or "now add a database" makes the other.
  - **Voice can't group the two kinds together.**
- **Why it matters:** The core loop is to create by voice, then rearrange by hand or fix by name. It breaks unpredictably, and nothing on screen tells you which kind a shape is.
- **Fix:** Use one kind of shape throughout. Until then, let hands target every shape, and when a name isn't found, hand the command to the AI planner instead of rejecting it.
- **Evidence:**
  - Hands: `board/gestureObjectManipulation.ts:11-52` (hand targets come only from the older kind), `AP:9503-9516`, `AP:4165` (eraser), `AP:9627-9640` (hold-to-edit), `AP:5297` (the false "close your hand" hint), `AP:11798` (the "no target" state is hidden); `catalogDock.spec.ts` asserts hand-placed shapes are the newer kind.
  - Voice: the phrase rules run first and never hand off (`AP:6532-6556`); they skip Airo-drawn shapes (`AP:13505`) and reject at `AP:3100`, `3054`, `2965`.
  - Grouping: `board/intentPipeline.ts:518-522`; `semanticSceneObjects.test.mjs:213`.

---

## Frequent friction

### 3. Describing a flow to Airo is treated as meeting chatter — (c)
- **What happens:** On an empty board you say "Airo, users sign in through the auth service, which checks the user database." "Airo" is stripped before the AI planner sees the sentence, and palm-activated speech never contained it. The planner is not told the sentence was meant for it. Its rules classify a description of how a system works as discussion, unless every object is already on the board.
  - Result: likely *"Airo did not hear a board command."*, and the sentence lands in the typing box (gap 1).
  - This is predicted from the planner's instructions, not observed in a live run.
  - It works only if you add a magic phrase such as "Create a flow diagram for this."
  - 30 of the 39 test sentences keep "Airo" in, so the tests don't check what production actually sends.
- **Why it matters:** Narrating the system is the most natural way to build a concept diagram, and it's the path most likely to fail.
- **Fix:** Tell the AI planner the speech was addressed to Airo and how (wake word or palm), treat it as a diagram request with a best guess, and re-run the tests without "Airo".
- **Evidence:** `board/voiceCommandRouter.ts:208-209`; `board/browserSpeech.ts:433-455`; `AP:7423`, `AP:6756`; `board/semanticIntent.ts:177-191` (no "addressed" field); `api/semanticIntent/openaiResponses.ts:44-56`, `107`, `188-205`; `evals/voice-intent/v1.json`; `scripts/eval-voice-intent.mjs:271`.

### 4. Getting Airo's attention takes one "Airo" or one palm per sentence, said exactly right — (c)(d)
- **What happens:**
  - **A raised palm opens voice for one sentence only.** You hold an open palm and say "add a user", and it applies. Still holding, you say "add a database" and get *"wasn't addressed to the board"*. You have to lower the hand and hold it still again before every sentence. The help article tells you to do exactly that, while the router's own test expects it to keep listening.
  - **Raising the palm too quickly grabs the wrong sentence.** If you raise it just after finishing a normal sentence, that sentence can be taken as the command.
  - **A thinking pause of about 1.2 s cuts the instruction.** "Airo, add a database… [pause] …called Orders" creates an unlabelled database, and "called Orders" is ignored. Holding the palm doesn't help.
  - **There is no follow-up window after a command.** Each new sentence needs "Airo" again; a bare "Airo" carries over for only 10 s.
  - **"Airo" in the middle of a sentence is missed.** "And now Airo, add a database", "Then Airo add a database", "Next, Airo, …", "Thanks Airo. Add a database.", "so as I was saying airo add a database" and "Hey Arrow, add a database" all do nothing. "Airo" is only accepted at the start of a turn, after . ! ? or after a short list such as hey, ok, so or well. Real speech transcripts often have no punctuation; the tests use punctuated text.
  - **The reverse also happens.** Holding a flat palm still to aim at a dock tile or shape also opens the mic, because it's the same pose, so "so this is where orders come in" becomes a command. Narration that starts with "Arrow…", "Aero…" or "Airboard…" also counts as addressed.
- **Why it matters:** You can't think aloud or speak in your natural rhythm. Commands woven into narration get dropped, and you have to check the screen to see whether you were heard.
- **Fix:**
  - Keep the palm gate open for as long as the palm is held.
  - Add a follow-up window of about 8–10 s after each command where no wake word is needed.
  - Allow longer pauses inside addressed speech and merge continuations into the command.
  - Accept "Airo" after and, now, then, next or thanks when a command follows.
  - Use a different hand pose for aiming than for talking.
- **Evidence:** `board/voiceCommandRouter.ts:84-87`, `111-120`, `196-216` (gate dropped after the first sentence); `AP:7969`; `voiceCommandRouter.test.mjs:83` misses this; `board/palmVoiceGestureTracker.ts:28-38`, `101-121`, `163-167`; `api/config.ts:349-354`, `388-394` (1.2 s end of turn); `board/browserSpeech.ts:345`, `357-366`, `465-523`; `AP:7876-7879`; `board/landmarkManipulationInput.ts:11`; `AP:9254-9278` (aiming doesn't suppress the mic).

### 5. Airo misreads everyday wording and applies the wrong thing instantly — (c)
- **What happens:** I ran the real phrase rules on these sentences:
  - "Airo, add a database and a cache" creates one Database labelled "and a cache".
  - "create a flowchart for user signup" creates a User shape labelled "flowchart for signup".
  - "add a database named Orders and connect it to the API" creates one shape labelled "Orders and connect it to the API".
  - "add three services named Auth, Billing and Search" creates services labelled "Auth, Billing and Search 1/2/3".
  - "add a payments service" creates a shape labelled just "Service".
  - "put the database below the API" creates a second database.
  - "make it a queue" creates a new queue labelled "it a".
  - "rename it to Orders", "make it blue" and "delete it" are rejected, because "it" isn't understood; only this, that and selected work.
  - "move the database to the right" and "connect User to API and API to Database" are rejected.
- **Why it matters:** The built-in phrase rules run before the AI planner and never hand off. Wrong results go straight onto the shared screen, and you have to notice them, say undo, and rephrase.
- **Fix:** Let the built-in phrase rules handle only short, clean commands. Hand anything with "and", "that", "which", a list or a second verb to the AI planner. Treat "it" as the selected or newest shape, and add "change it to…".
- **Evidence:** `AP:6532-6560`, `AP:6655-6663`, `AP:6119` (immediate apply); `core/sceneIntent.ts:61`, `125`, `235-286`, `345-350`; the multi-part check exists only in the parser that runs later (`board/intentCanvasParser.ts:1392`); `board/intentPipeline.ts:1288-1289`; `scripts/eval-grammar.mjs` tests only that later parser.

### 6. Airo asks a question or demands a selection instead of making a best guess — (a)
- **What happens:**
  - **Name clashes are refused, not guessed.** With "Payments Service" and "Auth Service" on the board, "Airo, delete the service" gets *"More than one visible element matches that name; select one first."*
  - **Missing shapes are refused, not created.** "connect the user to the cache" with no Cache on the board gets *"Use unique visible names, or select the two elements to connect."*
  - **The AI planner is told to ask rather than guess.** Its questions appear only as small text, with no sound.
  - **A plain answer is ignored.** Saying "the billing one" without "Airo" or a palm is treated as room talk, and the "wasn't addressed" notice replaces the question.
  - **Pending questions are forgotten** if the board or the selection changes.
  - **Selecting usually means the mouse,** because hands can't select most shapes (gap 2).
  - The product spec (Epic D) says you are never interrogated with "did you mean…?".
- **Why it matters:** You have to stop, read the panel, then pick something by hand or mouse.
- **Fix:** Best-guess using the selection, the newest shape or the nearest one, create a missing shape if needed, and rely on undo. When a question is unavoidable, accept the answer for a few seconds without "Airo" and give a visible or audible cue.
- **Evidence:** `api/semanticIntent/openaiResponses.ts:71-75`; `AP:3049-3055`, `AP:3094-3104`, `AP:2964`; `AP:6880-6905` (question shown only as text); `AP:6709-6726` (dropped when the board changes); `board/voiceCommandRouter.ts:167-186` (no answer window); `AP:7876-7879`; product spec line 209.

### 7. Placing a shape by hand opens a typing box, and ordinary hand movement cancels or pans — (a)(c)
- **What happens:**
  - **Every hand placement opens a typing box.** Carry a Square from the dock and open your hand: a focused white text box covers the new shape, waiting for typing. Gestures can't close it, and it stays on the presented screen until someone presses Enter or Escape or clicks. Saying "Airo, rename selected to Payments" renames the shape underneath, but the empty box stays on top.
  - **A second hand in view takes over.** If you talk with both hands, or a colleague's hand is in shot, the carry is cancelled (*"Catalog placement cancelled."*). Two loosely open hands pan the board and two fists zoom it, so the diagram drifts in front of the audience.
  - **A slightly loosened fist drops the shape.** After 0.4 s the carried shape disappears, and the explanation is hidden on the board view.
  - **Every shape needs its own trip to the bottom dock,** because the tool resets after each placement. The full shape library can only be opened with the mouse.
- **Why it matters:** Every hand-placed shape ends in a keyboard step. Normal body language in a meeting undoes your work.
- **Fix:**
  - Don't open a text box for hand placements; take the label by voice ("say its name").
  - Require a deliberate, visible pose before two-hand pan or zoom starts.
  - Keep the grab through loose poses for about 1 s, and show hints next to the hand.
  - Keep the last tool armed after a placement.
- **Evidence:**
  - Typing box: `AP:2199`, `AP:2149`, `AP:4716-4728` (voice passes no-edit at `AP:3030`); `board/SceneTextEditor.tsx:36-41`, `56-70`; `AP:4933`.
  - Second hand: `board/landmarkNavigationInput.ts:18-23`; `board/canvasNavigationTracker.ts:40-45`, `142-160`; `AP:5401-5416`.
  - Loosened fist: `board/landmarkManipulationInput.ts:56-61`; `AP:9358`; `board/hybridGestureController.ts:369-397`; hints hidden at `AP:12107`/`12185` plus `globals.css:4068-4070`.
  - Dock: `AP:2150-2152`; `CreationToolbar.tsx:308-319` with `AP:4872`.

### 8. You have to keep watching the Airo panel, and the audience sees everything you say — (d)
- **What happens:**
  - **Everything is text only.** There are no sounds or spoken replies anywhere: applied, failed, question and voice-dropped all appear only as text in the panel.
  - **The audience sees your talk.** When you present the tab in Meet, the panel is on screen. It shows a live transcript of everything the mic hears, including asides, then *"Mic heard '…', but it wasn't addressed to the board"*.
  - **Results get overwritten.** That notice replaces your last "Applied: …" or Airo's question after your next normal sentence.
  - **Hiding the panel hides failures too.** Questions, failures and dropped voice then show nothing; only a dot while Airo is hearing or thinking, and a 6-second undo toast for successes. On narrow screens the panel starts hidden.
  - The help article even says "Read the finalized transcript before repeating the command."
- **Why it matters:** You can't face the audience and trust that Airo did what you asked, and your asides are broadcast.
- **Fix:** Show only speech addressed to Airo, keep the last result pinned, add a small audience-safe status near the diagram (applied / didn't get that / question / voice off), and offer optional quiet presenter-side sounds.
- **Evidence:** a search of apps/web/src finds no speech output or sound effects; `Docs/help/integrations/10-google-meet.md:46-49`; `AP:1206`, `AP:1433-1434`, `AP:11319-11320` (panel shown on the presented tab); `AP:7969-7970`, `AP:11375-11378` (live transcript); `AP:7876-7879` (overwrite); `AP:11501-11516` (hidden panel shows only a dot); `AP:587` (6 s toast); `AP:14186-14193`; `Docs/help/using-the-board/05-airo-voice.md:71`.

### 9. Pointing means nothing to voice, and hands can't connect shapes or select several — (b)
- **What happens:**
  - **"Here" ignores your hand.** Point at an empty spot and say "Airo, add a database here": "here" is dropped and the shape lands in the middle of the view.
  - **"This" and "that" ignore your hand.** Point at two shapes and say "Airo, connect this to that". Both words mean the current selection, so you get *"Select two different elements to connect."* The spec promises exactly this story.
  - **Hand-dropped connectors attach to nothing.** A connector carried from the dock and dropped between two shapes is loose, and hands can't drag its ends.
  - **Hands select one shape at a time,** so "group these" and "lay these out left to right" need the mouse.
  - **There is no hand gesture for undo or freehand marks.**
  - Connecting by spoken names ("Airo, connect user to API") does work.
- **Why it matters:** Pointing while talking is the natural meeting gesture, and the spec builds on it.
- **Fix:** Record what the hand is pointing at when you start speaking and use it for here, this and that. Connect by closing the hand on shape A and opening it on shape B. Add a hand way to select more than one shape.
- **Evidence:** `core/sceneIntent.ts:136-139` ("here" removed), `204`, `319-337`, `347-348`; `AP:2876-2880`, `AP:2969-2971`, `AP:3058-3067`; `canvasViewport.spec.ts` "typed commands land where the user is looking under pan+zoom" asserts centre placement for "add a circle here"; the pointer is read late (`AP:5964-5969`, `6188-6190`) against the rule in `board/intentCanvasParser.ts:7-9`; `board/sceneCreation.ts:107-113`; `board/gestureObjectManipulation.ts:54-68`; product spec lines 66-67 and 203.

### 10. Common edits, and bigger diagrams, can't be done by voice — (b)
- **What happens:**
  - **Edits with no voice command at all:**
    - Redo. Undoing an Airo change can't be redone even from the keyboard.
    - "Zoom to fit" or "focus on payments". Two-hand gestures can pan and zoom.
    - Labelling an arrow, dashed arrows.
    - "Turn it into a decision".
    - "Make it bigger".
    - Bring to front.
    - Tree or hub-and-spoke layouts.
    - Adding branches to a mind map.
  - **Undo understands only "undo", "undo that" and "go back".** "Scratch that", "undo twice" and "no, I meant a database" all fail. "Airo, never mind" says *"Cancelled the pending command."* but leaves the change in place.
  - **One request is capped.** It can hold at most 12 steps, where every box and every arrow is a step, and 500 characters, which is about 30 seconds of speech. Narrating a 7-step flow gets *"That diagram is too large for one safe preview. Split it into two requests."*
  - **Descriptions can use only 13 shape types.** A cache, load balancer or CDN becomes a generic box.
  - Colour and taller/wider work only with exact wording, such as "make the API red".
- **Why it matters:** You run into dead ends mid-diagram and have to switch to the mouse or keyboard, or split your explanation and say it again.
- **Fix:** Add redo, fit/focus, arrow labels and styles, change type, bigger/smaller, tree and radial layouts, mind-map branches, and broader undo and correction phrases. Split large descriptions into consecutive steps automatically, raise the length limit, and let descriptions use the full shape catalogue.
- **Evidence:** `core/semanticPlan.ts:6`, `85-159`, `142-146`, `188`; `core/semanticCapabilities.ts:40-185`, `206-231`; `api/semanticIntent/openaiResponses.ts:59`, `73`, `88`; `board/semanticIntent.ts:242-244`; `api/config.ts:314-320`; `AP:5755-5800`, `AP:5835-5840` (redo); `board/intentCanvasParser.ts:437`, `445-450`; `AP:5919-5928`, `AP:6491-6495`; `core/sceneIntent.ts:183-191`, `297-315`.

### 11. Slow responses, no retry when the AI planner hiccups, and voice minutes can run out mid-meeting — (c)(d)
- **What happens:**
  - **It's slow.** Anything the built-in phrase rules don't catch waits for the end of your speech (up to 1.2 s), then for the AI planner (about 2.4 s at the slow end, up to 6 s). Commands also queue one behind another, so you stand there for 3–4 s.
  - **There is no retry.** A single timeout, a rate limit (30 a minute), or the 30-second cooldown after 3 failures throws the command away. The cooldown is shown as "not configured".
  - **A failed start lasts the whole session.** If the AI planner's settings don't load when the board opens, it stays off until you reload. Any sentence the built-in phrase rules don't catch is then rejected, such as "add a cache" or "put a cache between…". "Refresh models" is disabled while voice is on.
  - **Voice minutes run out on open time, not use.** Voice now streams the whole time a board is open and is charged in 15-second blocks, whether or not you address Airo. About 4 hours of open boards in a day hits the 240-minute personal limit: *"You've used today's Airo voice minutes."* Neither a palm nor a click brings it back. The pilot-wide 3,000 minutes a day (about 12 presenters × 4 h) would stop voice for everyone.
- **Why it matters:** Dead air in front of the audience, lost commands, and voice can disappear partway through a long day.
- **Fix:** Start interpreting before the end of speech and finish the turn when the palm drops. Retry once on temporary failures and keep retrying the settings load. Charge voice only while Airo is addressed or speech is present, and warn before the limit.
- **Evidence:** `api/config.ts:156-161`, `214-233`, `283-284`, `300-306`, `388-394`; `board/semanticIntent.ts:176`, `209-211`, `411-412`; `api/semanticIntent/routes.ts:39`, `179-188`; `AP:7207` (one at a time); `AP:9110-9137`, `AP:6697-6705`, `AP:12743-12749`; `api/transcription/routes.ts:35`, `366-392`; `board/realtimeSpeech.ts:277-292`, `614-623`.

---

## Polish

### 12. Occasional moments that drop a command or need a click or reload — (c)(a)
- **What happens:**
  - **A change during planning throws the command away.** If a collaborator edits, or your hand changes the selection, while Airo is planning, you get *"The board changed while Airo was planning. Please repeat the command."* One unmatched step, such as one misheard name in a 6-step plan, drops the whole plan.
  - **The voice stream is cut every 30 minutes.** It restarts silently, and a sentence spoken at that moment is lost with no notice.
  - **Hands don't restart by themselves.** If hand tracking errors, or another app takes the camera, hands and the palm gate stay off until you switch tabs and back, or reload. An unplugged or ended camera isn't detected at all.
  - **Voice may never start.** On the standalone board, if the voice settings fail to load at open, voice never starts until you reload.
  - **A first-run card teaches typing.** The first board in a browser shows a "Make your first diagram" card over the canvas, including on the presented tab. It teaches type-and-press-Enter and closes only with a "Start building" click.
- **Why it matters:** These are rare, but each one forces you to repeat yourself or reach for the mouse mid-meeting. The card teaches the exact typing flow you are trying to eliminate.
- **Fix:**
  - Keep a plan when the shapes it touches haven't changed, and apply the matched steps.
  - Overlap voice streams at the 30-minute cut.
  - Restart the camera and tracker and retry the settings load automatically.
  - Make the card teach voice and gestures, and close it after the first voice or hand action.
- **Evidence:** `AP:6783-6806`, `AP:6244-6263`, `AP:7059-7076`; `board/intentPipeline.ts:48-50`; `api/config.ts:417-422`; `api/transcription/routes.ts:196-204`; `board/realtimeSpeech.ts:571-597`; `AP:7944-7946`; `AP:9700-9724`, `AP:8724-8736`; `AP:9078-9096`; `AP:3806-3823`, `AP:11812-11856`; `globals.css:2252-2254`.