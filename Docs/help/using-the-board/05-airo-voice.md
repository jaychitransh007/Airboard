---
title: Airo voice
description: Start a voice session, address Airo safely, edit selected objects, and recover from misheard speech.
category: using-the-board
categoryLabel: Using the board
order: 5
status: shipped
audiences: ["everyone"]
lastVerified: 2026-11-07
sources: ["apps/web/src/features/board/voiceCommandRouter.ts", "apps/web/src/features/board/palmVoiceGestureTracker.ts", "apps/web/src/features/board/holdToEditTracker.ts", "apps/web/src/features/board/realtimeSpeech.ts", "apps/web/src/features/board/semanticBoardObjects.ts", "packages/core/src/sceneDiagramCommands.ts"]
---

Airo turns finalized speech into the same command pipeline used by typed input.
Turn Airo on once before using voice: use **⏻** on the Airo panel, or
**Turn on Airo voice and hands** in the board menu (**•••**). The interface
shows whether realtime voice is available in the current environment. While
Airo listens, its panel shrinks to a strip in the corner with what it heard,
what it is doing and a line to type into; **⤢** shows its full activity.

Voice stays on for the whole meeting. If the connection drops, for example on
a network blip, Airo reconnects on its own and says when it is listening
again. If nobody has spoken for about 20 minutes, voice pauses so a forgotten
tab doesn't keep streaming; hold an open palm, or press **⏻** (Resume voice) on the
Airo panel, to wake it.

## Address Airo

Use either explicit method:

- Say the `Airo` wake word as part of a command.
- With supported camera input, hold one open palm still for about 0.4 seconds,
  speak, then lower or relax the hand.

Ordinary meeting conversation is not treated as a board command unless it
passes the product's explicit activation and routing gates.

Without a camera, use the wake word or type the command. Core board work does
not depend on the open-palm gesture.

## Edit one object

Select one object, then hold `V` while speaking to scope voice to that object.
With camera input, close one hand over the object and hold it still for about
0.6 seconds before speaking.

Examples:

- `rename to Payments`
- `delete`
- `connect to the database`

Release the key or hand pose when you finish.

## Shapes already on the board

Airo sees every shape on the board, including those you added from the toolbar
or with a typed command such as `add a user`. Ask it to connect, rename, move,
line up, spread out, tidy, copy, group or delete them by their label, and it
reuses them rather than drawing a second copy. Grouping draws a section around
them, as the toolbar does.

Airo can't yet put its own diagram shapes and toolbar shapes in one group. It
says so instead of guessing; select them and use the toolbar.

## If speech is misheard

Read the finalized transcript before repeating the command. Use a shorter
phrase with the visible object label. If a wrong action was safely applied,
undo it immediately.

If realtime transcription is unavailable, switch to the typed composer. If
only semantic recovery is unavailable, canonical commands still work.

## Privacy

Airboard processes microphone audio live while transcription is active and
does not store raw microphone audio. Deepgram receives live audio when the
configured realtime transcription path is used. Sanitized, content-free voice
diagnostic events can persist for up to 14 days.
