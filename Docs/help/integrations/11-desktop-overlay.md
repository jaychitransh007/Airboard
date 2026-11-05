---
title: Desktop overlay
description: Run the native click-through development overlay and use its safety controls.
category: integrations
categoryLabel: Integrations
order: 11
status: development-preview
audiences: ["everyone", "creators"]
lastVerified: 2026-07-30
sources: ["README.md", "apps/desktop/src/main.mjs", "apps/desktop/src/overlayWindow.mjs"]
---

The desktop overlay is a native Electron development preview. It places a
transparent, frameless, always-on-top Airboard above desktop applications and
can pass pointer events through to the application underneath.

Signed installers and automatic updates are still required before general
distribution.

## Launch the development preview

Run the Airboard web surface and desktop shell:

```text
pnpm dev:web
pnpm dev:desktop
```

The shell uses the local Airboard web origin by default. Operators can point it
at an approved deployed origin with the documented desktop URL environment
setting.

## Control click-through

- Press `Cmd/Ctrl+Shift+O` to temporarily enable pointer control.
- Use the setup controls to enable hands or Airo, type a command, undo, or
  change dark-overlay strength.
- Choose **Return to click-through** to remove the setup HUD and return pointer
  focus to the application below.
- Press `Cmd/Ctrl+Shift+H` to show or hide Airboard.

Use the tray or menu-bar item to change displays or quit.

## Safety notes

Confirm which display contains the overlay before presenting or recording.
Return to click-through after setup so Airboard does not capture pointer
interaction intended for another application.
