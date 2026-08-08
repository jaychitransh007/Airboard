---
title: Screen and camera composition
description: Present Airboard over a selected screen or camera and understand exactly what the audience sees.
category: using-the-board
categoryLabel: Using the board
order: 8
status: shipped
audiences: ["everyone", "creators", "tutors"]
lastVerified: 2026-07-30
sources: ["README.md", "apps/web/src/features/board/lightboardComposition.ts", "apps/web/src/features/board/screenUnderlay.ts", "apps/web/src/features/board/lightboardRecorder.ts"]
---

The standalone workspace can place your diagram over a selected screen, active
camera, or dark canvas. Source selection is automatic: selected screen first,
then active camera, then dark canvas.

## Use a screen

1. Choose **Use screen**.
2. Select the screen or window in the browser picker.
3. Confirm the intended source appears behind the diagram.
4. Stop sharing from Airboard or the browser when finished.

The selected screen is used locally by this composition flow. The board uses a
light global dim and local contrast plates to keep diagram content legible.

## Use a camera

Camera composition uses a fixed order:

1. Camera video.
2. Full-frame dark transparent scrim.
3. Diagram canvas.

Airboard does not segment the presenter or redraw the presenter above diagram
ink.

## Hide the diagram

Use the overflow menu, press `Shift+H`, say a supported hide/show command, or
use the thumb–middle-finger snap gesture. Hiding removes the diagram and scrim
while leaving the screen or camera source running.

## Record or export

Studio recording uses the same unmirrored full-frame composition shown in the
workspace. PNG export captures the diagram output. Verify the file before
sharing it externally.

For a meeting integration, always ask a second participant to confirm the
receiver-side image. Local preview alone is not audience verification.
