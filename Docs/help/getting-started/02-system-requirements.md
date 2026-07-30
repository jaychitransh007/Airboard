---
title: System requirements
description: Check the browser, permissions, hardware, and provider requirements for each Airboard capability.
category: getting-started
categoryLabel: Getting started
order: 2
status: reference
audiences: ["everyone", "admins"]
lastVerified: 2026-07-30
sources: ["Docs/Platform Support Matrix.md", "apps/api/src/config.ts", "apps/web/src/features/board/mediaPermissionPreference.ts", "extensions/chrome-meet-bridge/manifest.json"]
---

Use a current desktop browser for the standalone Airboard workspace. Camera,
microphone, screen capture, and meeting integration support depend on browser
permissions and your organization's Airboard policy.

## Standalone workspace

You need:

- JavaScript and browser storage enabled.
- A stable network connection for sign-in, saving, realtime voice, and semantic
  command recovery.
- Permission to open Airboard's web origin.

Typed commands, pointer controls, keyboard navigation, and saved boards do not
require a camera or microphone.

## Camera gestures

Use a front-facing camera with your hand inside the frame. Even lighting and a
background that separates your hand from the room improve tracking. Avoid
strong backlighting and keep both hands visible for two-hand pan and zoom.

If camera permission is denied or unavailable, switch to pointer and keyboard
input. Airboard must not block the board because camera input is missing.

## Airo voice

Airo requires microphone permission and a configured realtime transcription
provider. If voice is unavailable, Airboard disables the voice entry point
while typed commands continue to work.

Natural-language recovery additionally depends on the semantic intent provider.
Canonical commands continue to work when that provider is unavailable.

## Google Meet private preview

The Meet overlay requires the approved Chrome extension build, a supported
Chrome profile, an Airboard account, affirmative live-media confirmation, and
a standard Google Meet meeting-code URL. The public Chrome Web Store install
link appears only after the reviewed listing URL is configured.

## Desktop development preview

The native overlay currently runs as an Electron development build. General
distribution still requires signed installers and an automatic-update path.
