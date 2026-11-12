---
title: Camera gestures
description: Perform the shipped hand poses for aiming, choosing, moving, placing, connecting, selecting, erasing, speaking, panning, zooming, and hiding.
category: using-the-board
categoryLabel: Using the board
order: 6
status: shipped
audiences: ["everyone"]
lastVerified: 2026-11-11
sources: ["Docs/Gesture Interaction Audit.md", "apps/web/src/features/board/AirboardPrototype.tsx", "apps/web/src/features/board/gestureObjectManipulation.ts", "packages/gesture-engine/src/hybridGestureController.ts"]
---

Camera gestures are optional. Keep your hand inside the camera frame and wait
for visible state feedback before moving to the next stage. Use pointer,
keyboard, and typed commands whenever camera input is unavailable or
uncomfortable.

Hands work on every shape on the board, whether Airo drew it, you typed or
said a short command, picked it from the toolbar, or carried it from the dock.

## Aim and choose

Move one relaxed hand without holding a command pose to aim. Move near an
object-dock control or board object and start closing one hand. The first
highlighted target activates. Reopen before choosing another target.

An open palm that is aiming at a dock tile or a shape stays a pointer: it
doesn't open the microphone.

If you close your hand where there is nothing to grab, a short note appears
next to your hand: **Nothing to grab here**.

## Move an object

Close over the object body, wait for **Move locked**, move it, then reopen to
place it. Undo puts it back, just like a mouse drag.

To voice-edit rather than move, close over the object and hold it still for
about 0.6 seconds before speaking.

A slightly loosened fist doesn't drop what you're holding: the grab holds for
about a second. Open your hand fully to drop on purpose. If the board drops
or cancels something, a short note next to your hand says why.

## Place an object

Pick a shape from the dock with a closed hand, carry it onto the board, and
open your hand to place it. No typing box opens. The new shape is selected, so
you can name it by voice, for example “Airo, call it Payments.”

The shape stays armed after you place it:

- Close your hand on an empty part of the board and open it to place another.
- Close your hand over an existing shape to move that shape instead.
- Move your hand back to the dock, or pick another tile, to stop placing.

**More shapes** at the bottom of the shape menu opens the full shape library,
and works by hand too.

## Connect two shapes

Carry a connector from the dock and release it between two shapes, or over
one of them. Its ends attach to those shapes and stay attached when they move.

While the connector is armed, close your hand on one shape, move to another,
and open your hand there. The connector runs from the first shape to the
second.

## Select several shapes

Select one shape first, for example by grabbing and dropping it. Then rest
your open hand still on another shape for about a second. It's added to the
selection, and a note next to your hand confirms it. Repeat to add more, then
say what to do with them, such as “Airo, group these.”

## Point while you talk

Your hand also tells Airo where you mean. Point at an empty spot and say
“Airo, add a database here”, and it lands there. Point at a shape as you start
speaking and say “Airo, make it red”. Point at one shape, then another, and
say “Airo, connect this to that”. See [Airo voice](/help/using-the-board/airo-voice).

## Erase

Choose **Eraser**. Close over an object, wait for the erase state, sweep across
the intended targets, then reopen.

## Speak to Airo

Hold one open palm still, away from the dock and from shapes, without sideways
motion, for about 0.4 seconds to open push-to-talk. Lower or relax it when
finished.

Camera motion does not trigger Undo. Choose the **Undo** arrow at the bottom
left of the board, press `Cmd/Ctrl+Z`, or say “Airo, undo.”

## Pan, zoom, and hide

- Hold two open palms still for about half a second, then move them together
  to pan the canvas.
- Hold two closed hands still for about half a second, then change the
  distance between them to zoom.
- Snap your thumb and middle finger to hide or restore the diagram and dark
  scrim while leaving the camera or selected screen running.

Hands moving as you talk don't pan or zoom, because the pose has to be held
still first. A second hand coming into view while you carry or move a shape
doesn't interrupt it, and pan and zoom never start during a carry.

## If the camera stops

If hand tracking hits an error, the camera is unplugged, or another app takes
it, Airboard restarts the camera and hand tracking on its own after a few
seconds. Your open-palm voice gesture works again once hands are back. If it
can't restart after several tries, switch to another tab and back, or reload
the board.

## If a gesture conflicts

Stop, reopen or relax both hands, and wait for the current interaction state to
clear. Then repeat one gesture deliberately. Pointer and keyboard controls
remain available at every stage.
