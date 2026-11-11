---
title: Airo voice
description: Start a voice session, address Airo safely, edit selected objects, and recover from misheard speech.
category: using-the-board
categoryLabel: Using the board
order: 5
status: shipped
audiences: ["everyone"]
lastVerified: 2026-11-11
sources: ["apps/web/src/features/board/voiceCommandRouter.ts", "apps/web/src/features/board/palmVoiceGestureTracker.ts", "apps/web/src/features/board/holdToEditTracker.ts", "apps/web/src/features/board/realtimeSpeech.ts", "apps/web/src/features/board/semanticBoardObjects.ts", "packages/core/src/sceneDiagramCommands.ts"]
---

Airo turns finalized speech into the same command pipeline used by typed input.
Airo starts listening as soon as a board opens; there is nothing to turn on.
The first time, the browser asks once for the camera and microphone. To keep
the microphone off on every board, turn off **Airboard audio input** in
**Settings → Preferences**. The Airo panel says when voice isn't available.
While Airo listens, its panel shrinks to a strip in the corner with what it heard,
what it is doing and a line to type into; **⤢** shows its full activity.

Voice stays on for the whole meeting. If the connection drops, for example on
a network blip, Airo reconnects on its own and says when it is listening
again. If nobody has spoken for about 20 minutes, voice pauses so a forgotten
tab doesn't keep streaming; hold an open palm, or click the board, to wake it.

If you have Airboard open in more than one tab, only the tab you are using
listens. Going back to another tab moves Airo's voice there.

## Address Airo

Use either method, whichever suits the moment:

- Say `Airo` with your command, at the start of a sentence or in the middle
  of one: “Airo, add a database” and “and now Airo, add a database” both work.
- With a camera, hold one open palm still for about 0.4 seconds and speak.
  Airo keeps listening for as long as you hold it, so you can say several
  commands in a row; lower your hand when you're done.

For about 8 seconds after a command, you can carry on without saying `Airo`
again: “add a cache”, “and connect it to the API”, “make it red”. Anything
that isn't a board command, such as ordinary talk with the room, ends that
window and is ignored.

You can pause to think in the middle of a command: “Airo, add a database…
called Orders” is one command.

Holding your palm flat to aim at a shape or a tool in the dock doesn't turn
the microphone on; only an open palm held still in empty space does.

Ordinary meeting conversation never changes the board, and it isn't shown
on screen: the Airo panel only shows what you said to Airo.

Without a camera, use the wake word or type the command.

## Describe it, and Airo draws it

You can describe a system in plain words and Airo draws the whole diagram:
“Airo, users sign in through the auth service, which checks the user
database.” A description can run to a minute or so. If one part can't be
matched, Airo draws the rest and says what it skipped.

## Point while you talk

“Here”, “this” and “that” mean what your hand (or mouse) points at when you
start speaking:

- `Airo, add a database here`
- `Airo, connect this to that`: point at one shape as you start, and at the
  other as you finish.
- `Airo, make it red`, `delete it`, `call it Payments`: “it” is what you
  pointed at, or else what's selected, or else the shape you added last.

## Edit one object

With a camera, close one hand over a shape and hold it still for about 0.6
seconds, then speak: `rename to Payments`, `delete`, `connect to the
database`. Without one, select the shape and hold `V` while speaking.

## Shapes already on the board

Airo sees every shape on the board, whether it drew it, you added it from
the toolbar, or you placed it by hand. Ask it to connect, rename, recolour,
move, resize, change the type of, line up, spread out, group or delete them
by name, and it reuses them rather than drawing a second copy.

When a name matches more than one shape, Airo picks the selected one, else
the newest. When you mention a shape that isn't there yet (“connect the user
to the cache”), Airo adds it. Airo only asks a question when it truly can't
tell what you mean; answer it out loud within about 10 seconds, without
saying `Airo` first.

## Undo, redo and the view

- `Airo, undo`, `scratch that`, `undo twice`
- `Airo, redo`
- `No, I meant a database` swaps the last change for what you meant.
- `Airo, zoom to fit`, `focus on payments`
- `Airo, bring it to the front`, `send it to the back`

## How you know what happened

Every change applies at once, and a short **Undo** appears on the board.
When Airo can't apply something, or asks a question, a short note appears on
the board itself, so you see it even with the Airo panel hidden. Airo also
plays quiet sounds: a tick when it hears a command, a rising note when it
applies one, a falling note when it can't, and three notes for a question.
Turn the sounds off in the board's settings under **Appearance**. If you
present the tab in Meet with tab audio shared, the audience may hear them.

Voice commands never go into the typing box. If Airo misses one, say it
again, in other words if you can.

## Privacy

Airboard processes microphone audio live while transcription is active and
does not store raw microphone audio. Deepgram receives live audio when the
configured realtime transcription path is used. Sanitized, content-free voice
diagnostic events can persist for up to 14 days.
