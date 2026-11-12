---
title: Keyboard, pointer, and touchpad
description: Use Airboard without camera gestures and learn the current canvas shortcuts.
category: using-the-board
categoryLabel: Using the board
order: 7
status: shipped
audiences: ["everyone", "keyboard-only"]
lastVerified: 2026-11-12
sources: ["apps/web/src/features/board/AirboardPrototype.tsx", "apps/web/src/features/board/creationToolCatalog.ts", "Docs/Accessibility Audit.md"]
---

You can complete the core board workflow without a camera or microphone. Use
the object dock, a mouse or touchpad, keyboard navigation, and the typed Airo
composer.

## Keyboard shortcuts

| Shortcut | Action |
| --- | --- |
| `Cmd/Ctrl+Z` | Undo the latest board transaction |
| `Shift+H` | Hide or restore the diagram |
| Hold `Space` | Pan the board by dragging while the canvas is active |
| `Tab` / `Shift+Tab` | Move through committed objects while the canvas is active |
| `Enter` or `F2` | Edit the selected object's label |
| `Delete` or `Backspace` | Delete selected objects |
| `Escape` | Cancel the pending command or interaction and clear selection |
| Hold `V` | Voice-edit the single selected object when voice is available |

At the first or last board object, `Tab` is allowed to leave the canvas. The
canvas does not trap keyboard focus.

## Tool shortcuts

These arm a tool from the object dock while the canvas has focus.

| Shortcut | Tool |
| --- | --- |
| `V` / `H` | Move / Hand |
| `S` / `T` | Sticky note / Text |
| `Shift+S` / `Shift+T` | Section / Table |
| `R` / `O` | Square / Ellipse |
| `X` / `L` | Bent connector / Straight connector |
| `M` / `Shift+M` / `W` | Marker / Highlighter / Washi tape |
| `Shift+Delete` | Eraser |
| `E` | Stamp |
| `` ` `` | Code block |

The dock is also a toolbar: `Left` and `Right` arrows move between its
buttons, and `Escape` closes an open tool menu and returns focus to its button.

## Pointer workflow

Choose a tool from the object dock, click or drag onto the board, and use
selection controls to move or edit the object. A small toolbar floats above the
selected object with its colours, layer order, duplicate and delete; **More**
shows every setting, such as exact size and rotation. Double-click a labelled
object to edit it. Use the typed composer for fast multi-object changes. Zoom
sits at the end of the object dock; click the percentage to reset it.

## Touchpad

A touchpad works like a mouse: press and drag to move, place, or draw with the
tool you chose from the object dock. Pinch to zoom around the cursor, and
scroll with two fingers to pan. Zooming and panning change only your view,
never the board.

## Typed-command workflow

Use the Airo composer for create, connect, rename, move, align, distribute,
layout, group, delete, undo, and cancel commands. See
[Commands](/help/using-the-board/commands) for examples.

## Accessibility status

Airboard was last checked on 6 November 2026 against WCAG 2.2 AA with
automated rules, keyboard-only testing, and the accessibility tree that screen
readers use. It was an internal check, not an independent audit, and Airboard
does not yet claim conformance.

What you can rely on outside the canvas:

- Every page and dialog works with a keyboard, shows where focus is, and
  returns focus to the button that opened a menu or dialog when it closes.
- Pages have landmarks, one main heading, labelled fields, and status messages
  that screen readers announce.
- Pages reflow to 320 pixels wide, so you can zoom to 400%. On every screen
  size, the profile icon at the top right opens Profile, Help Center, Plan &
  Billing, Settings and Sign out.
- Animations switch off when your system asks for reduced motion.
- On the board, a screen reader hears which object `Tab` selects, and can read
  the board's words as a list.

Known limitations:

- Freehand drawing, erasing, and placing or resizing an object at an exact
  spot need a pointer or touchpad. Typed commands cover creating, connecting,
  renaming, moving, aligning, and deleting objects.
- The toolbar for the selected object comes early in the `Tab` order, well
  before the canvas.
- On phone-width screens the zoom buttons are hidden; pinch or scroll to zoom.
- Camera gestures and Airo voice need a camera and microphone.
- Airboard has not yet been tested with VoiceOver, NVDA, or JAWS by people who
  use them.

To report a barrier, use [Contact support](/support).
