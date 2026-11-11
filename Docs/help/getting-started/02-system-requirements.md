---
title: System requirements
description: Check the browser, permissions, hardware, and provider requirements for each Airboard capability.
category: getting-started
categoryLabel: Getting started
order: 2
status: reference
audiences: ["everyone", "admins"]
lastVerified: 2026-11-11
sources: ["Docs/Platform Support Matrix.md", "Docs/Browser Matrix.md", "apps/api/src/config.ts", "apps/web/src/features/board/mediaPermissionPreference.ts", "apps/web/src/features/board/screenUnderlay.ts"]
---

Use Google Chrome on a desktop or laptop for the standalone Airboard workspace.
Camera, microphone, and screen capture depend on browser permissions and your
organization's Airboard policy. There is nothing to install.

## Supported browsers

- Google Chrome, current or previous version, on Windows or macOS.
- Microsoft Edge, current or previous version, on Windows.

Firefox, Safari, and phone or tablet browsers are not supported yet. A board may
open in them, but camera gestures, Airo voice, and the canvas are not tested
there.

## Standalone workspace

You need:

- A supported browser.
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
provider. A board asks for the camera and microphone as soon as it opens. If
voice is unavailable, hand tracking still starts and the Airo panel says why
voice is off. Typed commands keep working.

Natural-language recovery additionally depends on the semantic intent provider.
Canonical commands continue to work when that provider is unavailable.

## Google Meet

To use Airboard in a Meet call, you need a supported browser, an Airboard
account, and the Meet call open in the same browser as your Airboard tab. You
present the Airboard tab from Meet; there is nothing to install. See
[Use Airboard in Google Meet](/help/integrations/google-meet).

## Desktop overlay

The desktop overlay runs in the web app. Your browser must be allowed to share
a screen or window, and it asks you to choose one each time you start. See
[Desktop overlay](/help/integrations/desktop-overlay).
