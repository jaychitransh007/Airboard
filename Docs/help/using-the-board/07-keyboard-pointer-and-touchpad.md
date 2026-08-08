---
title: Keyboard, pointer, and touchpad
description: Use Airboard without camera gestures and learn the current canvas shortcuts.
category: using-the-board
categoryLabel: Using the board
order: 7
status: shipped
audiences: ["everyone", "keyboard-only"]
lastVerified: 2026-07-30
sources: ["apps/web/src/features/board/AirboardPrototype.tsx", "Docs/Touchpad Writing Mode Implementation Notes.md"]
---

You can complete the core board workflow without a camera or microphone. Use
the object dock, pointer, keyboard navigation, touchpad writing, and typed Airo
composer.

## Keyboard shortcuts

| Shortcut | Action |
| --- | --- |
| `Cmd/Ctrl+Z` | Undo the latest board transaction |
| `Shift+H` | Hide or restore the diagram |
| `Space` | Pause or resume gesture input; in active touchpad mode, hold to pan |
| `Tab` / `Shift+Tab` | Move through committed objects while the canvas is active |
| `Enter` or `F2` | Edit the selected object's label |
| `Delete` or `Backspace` | Delete selected objects in object/gesture mode |
| `Escape` | Cancel the pending command or interaction and clear selection |
| Hold `V` | Voice-edit the single selected object when voice is available |
| Hold `E` | Temporarily erase in touchpad mode |
| Hold `Shift` | Draw a straight line in touchpad mode |

At the first or last board object, `Tab` is allowed to leave the canvas. The
canvas does not trap keyboard focus.

## Pointer workflow

Choose a tool from the object dock, click or drag onto the board, and use
selection controls to move or edit the object. Double-click a labelled object
to edit it. Use the typed composer for fast multi-object changes.

## Touchpad writing

Switch the input mode to touchpad when available. Draw with the pointer or
touchpad, hold `Shift` for a straight line, hold `E` for temporary erasing, and
hold `Space` to pan.

## Typed-command workflow

Use the Airo composer for create, connect, rename, move, align, distribute,
layout, group, delete, undo, and cancel commands. See
[Commands](/help/using-the-board/commands) for examples.
