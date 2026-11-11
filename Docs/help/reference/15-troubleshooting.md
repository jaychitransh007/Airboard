---
title: Troubleshooting
description: Resolve common camera, voice, command, meeting, saving, and sign-in problems.
category: reference
categoryLabel: Troubleshooting and reference
order: 15
status: reference
audiences: ["everyone", "admins"]
lastVerified: 2026-11-11
sources: ["apps/web/src/features/board/AirboardPrototype.tsx", "apps/web/src/features/board/screenUnderlay.ts", "apps/web/src/platform/auth.tsx"]
---

Start with the symptom you can see. Do not include board content, transcripts,
meeting URLs, credentials, or raw media in a support request.

## Airboard does not see my hands

1. Confirm camera permission for the Airboard origin.
2. Make sure the active camera is not blocked by another application.
3. Put your entire hand inside the frame with even lighting.
4. Reopen or relax both hands to clear any locked gesture state.
5. Switch to pointer and keyboard input if tracking remains unreliable.

## Airo voice is unavailable

1. Confirm the browser allows the microphone for this site, then reload the
   board; Airo starts on its own.
2. Check that **Airboard audio input** is on in **Settings → Preferences**.
3. Check whether organization policy permits audio input.
4. Use the typed composer.

If typed canonical commands work but natural-language recovery does not, the
semantic provider may be unavailable while the deterministic path remains
healthy.

## A command was rejected

Use one action and visible labels: `connect Customer to API`. Select the object
before using `selected`, `this`, or `that`. If the board changed during an
online interpretation request, repeat the command against the current state.

## People in Google Meet can't see my board

1. Open Airboard in the same browser as the Meet call.
2. In Meet, present again and choose your Airboard tab, not a window or your
   whole screen.
3. If your camera is busy or black in one of the tabs, turn off your Meet camera
   while you present; the audience sees you behind the board instead.
4. Switch back to the Airboard tab to keep drawing.

See [Use Airboard in Google Meet](/help/integrations/google-meet).

## My board will not save

Keep the page open. Check the network connection and account state, then retry.
Copy the visible error code and request ID if available. Avoid refreshing until
you have confirmed whether the latest state was persisted.

## I am stuck in a sign-in loop

Confirm browser storage is enabled and that the callback returns to the same
Airboard origin. Retry with the identity provider and email address associated
with the workspace. For an invitation, use the invited email address.

## Contact support

Create a seven-day diagnostic in **Settings → Privacy & data**, then submit a
[support request](/support) with the browser and OS, approximate time, steps,
first failed check, visible error code, request ID, and diagnostic bundle ID.
