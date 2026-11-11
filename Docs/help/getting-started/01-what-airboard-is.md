---
title: What Airboard is
description: Understand Airboard's workspace, input methods, and where you can use it.
category: getting-started
categoryLabel: Getting started
order: 1
status: shipped
audiences: ["everyone"]
lastVerified: 2026-11-11
sources: ["README.md", "apps/web/src/features/board/AirboardPrototype.tsx", "apps/web/src/features/product/AirboardsHome.tsx"]
---

Airboard is a visual workspace for creating and presenting diagrams. You can
work on a board on its own, draw over a screen you choose, or present your
board in Google Meet.

## What you can do

- Create persistent boards and diagram objects.
- Connect, rename, move, duplicate, and delete objects.
- Use typed commands, Airo voice commands, a pointer, keyboard controls,
  touchpad writing, or supported camera gestures.
- Present over a selected screen or camera and export a PNG.

## How changes are applied

Airboard applies valid commands immediately. There is no Preview or Apply step.
Undo is the safety net: choose the **Undo** arrow at the bottom left of the
board, press `Cmd/Ctrl+Z`, or say “Airo, undo.”

When a command could mean more than one thing, Airo applies its best guess
(the selected shape, else the newest), and you can undo it. It asks a short
question only when it truly can't tell what you mean. If a command can't be
applied safely, Airo says so on the board and you can say it again.

## Product surfaces

Airboard runs in your browser; there is nothing to install. Your boards live
on **Airboards**, the page you see after you sign in.

- **Google Meet:** present your Airboard tab in the call. Everyone sees you and
  the diagram, and voice, gestures, typing and the mouse keep working. See
  [Use Airboard in Google Meet](/help/integrations/google-meet).
- **Desktop overlay:** show slides or any app behind your board and draw on
  top. See [Desktop overlay](/help/integrations/desktop-overlay).

## You do not need a camera or microphone

Core board workflows have pointer, keyboard, and typed-command paths. Camera
gestures and voice are optional enhancements. See
[Keyboard, pointer, and touchpad](/help/using-the-board/keyboard-pointer-and-touchpad)
for the non-media workflow.
