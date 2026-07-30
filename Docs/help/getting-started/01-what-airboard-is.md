---
title: What Airboard is
description: Understand Airboard's workspace, input methods, and preview integrations.
category: getting-started
categoryLabel: Getting started
order: 1
status: shipped
audiences: ["everyone"]
lastVerified: 2026-07-30
sources: ["README.md", "apps/web/src/features/board/AirboardPrototype.tsx", "apps/web/src/features/product/Dashboard.tsx"]
---

Airboard is a visual workspace for creating and presenting diagrams. You can
work in a standalone board, place that board over a selected screen, or use a
preview integration that composites the diagram into your meeting camera.

## What you can do

- Create persistent boards and diagram objects.
- Connect, rename, move, duplicate, and delete objects.
- Use typed commands, Airo voice commands, a pointer, keyboard controls,
  touchpad writing, or supported camera gestures.
- Present over a selected screen or camera and export a PNG.
- Restore deleted boards during your workspace's recovery window.

## How changes are applied

Airboard applies valid commands immediately. There is no Preview or Apply step.
Undo is the safety net: use the toolbar, press `Cmd/Ctrl+Z`, say “Airo, undo,”
or use the supported open-palm undo gesture.

If Airboard cannot safely understand or ground a command, it rejects the
command or asks a focused question instead of guessing.

## Product surfaces

The standalone web workspace is the primary shipped surface. The Google Meet
camera overlay is a private preview. The native desktop overlay is a development
preview without generally distributed signed installers or automatic updates.

Zoom and Microsoft Teams are not current Airboard product channels.

## You do not need a camera or microphone

Core board workflows have pointer, keyboard, and typed-command paths. Camera
gestures and voice are optional enhancements. See
[Keyboard, pointer, and touchpad](/help/using-the-board/keyboard-pointer-and-touchpad)
for the non-media workflow.
