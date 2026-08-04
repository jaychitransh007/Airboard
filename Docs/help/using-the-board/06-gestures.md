---
title: Camera gestures
description: Perform the shipped hand poses for aiming, choosing, moving, placing, erasing, speaking, panning, zooming, and hiding.
category: using-the-board
categoryLabel: Using the board
order: 6
status: shipped
audiences: ["everyone"]
lastVerified: 2026-07-30
sources: ["Docs/Gesture Interaction Audit.md", "apps/web/src/features/board/AirboardPrototype.tsx", "packages/gesture-engine/src/hybridGestureController.ts"]
---

Camera gestures are optional. Keep your hand inside the camera frame and wait
for visible state feedback before moving to the next stage. Use pointer,
keyboard, and typed commands whenever camera input is unavailable or
uncomfortable.

## Aim and choose

Move one relaxed hand without holding a command pose to aim. Move near an
object-dock control or board object and start closing one hand. The first
highlighted target activates. Reopen before choosing another target.

Camera gestures select one object at a time and do not draw a lasso.

## Move an object

Keep **Select** active. Close over the object body, wait for **Move locked**,
move it, then reopen to place it.

To voice-edit rather than move, close over the object and hold it still for
about 0.6 seconds before speaking.

## Place an object

Choose a shape first. Move onto the canvas, close one hand, wait for the
holding state, position the preview, then reopen.

## Erase

Choose **Eraser**. Close over an object, wait for the erase state, sweep across
the intended targets, then reopen.

## Speak to Airo

Hold one open palm still, without sideways motion, for about 0.4 seconds to
open push-to-talk. Lower or relax it when finished.

Camera motion does not trigger Undo. Use the board toolbar, press
`Cmd/Ctrl+Z`, or say “Airo, undo.”

## Pan, zoom, and hide

- Use two open palms to pan the canvas.
- Use two closed hands and change the distance between them to zoom.
- Snap your thumb and middle finger to hide or restore the diagram and dark
  scrim while leaving the camera or selected screen running.

If two-hand navigation activates accidentally, separate the one-hand task from
the second hand and wait for the state to settle before continuing.

## If a gesture conflicts

Stop, reopen or relax both hands, and wait for the current interaction state to
clear. Then repeat one gesture deliberately. Pointer and keyboard controls
remain available at every stage.
