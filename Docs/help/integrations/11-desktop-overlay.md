---
title: Desktop overlay
description: Run the native click-through development overlay and use its safety controls.
category: integrations
categoryLabel: Integrations
order: 11
status: development-preview
audiences: ["everyone", "creators"]
lastVerified: 2026-11-07
sources: ["README.md", "apps/desktop/README.md", "apps/desktop/src/main.mjs", "apps/desktop/src/overlayWindow.mjs", "apps/desktop/src/autoUpdate.mjs"]
---

The desktop overlay is a native Electron development preview. It places a
transparent, frameless, always-on-top Airboard above desktop applications and
can pass pointer events through to the application underneath.

The app can now be packaged as a macOS and Windows installer that updates
itself, but it isn't distributed yet: installers have to be signed with
Airboard's Apple and Microsoft signing accounts first. Until then, run it from
the source code as below.

The overlay lets only the Airboard page use the camera and microphone, for
hands and Airo's voice, and refuses every other permission.

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
