---
title: Google Meet
description: Connect the private-preview Chrome extension, run preflight, and verify what a remote participant receives.
category: integrations
categoryLabel: Integrations
order: 10
status: private-preview
audiences: ["everyone", "admins"]
lastVerified: 2026-07-30
sources: ["extensions/chrome-meet-bridge/README.md", "extensions/chrome-meet-bridge/popup.html", "Docs/Meet Camera Composite Verification.md", "apps/web/src/features/product/IntegrationsPage.tsx"]
---

The Google Meet camera overlay is a private preview. It uses a private Airboard
engine and composites the transparent diagram plane into your outgoing Meet
camera. There is no dedicated shared Airboard canvas inside Meet.

## Install and connect

1. Install the approved preview build in the Chrome profile you use for Meet.
2. Open the Airboard extension popup and choose **Connect Airboard**.
3. Sign in, connect the detected installation, and return to the popup.
4. Review and accept the one-time live-media disclosure.

If Chrome cannot reach the installation, reload the extension and reopen the
setup page from the toolbar popup. A one-time connection token can expire; in
that case, start **Connect Airboard** again.

## Run preflight

Open or refresh a standard Google Meet meeting-code URL and turn on your normal
Meet camera. In the extension popup, confirm all readiness checks complete:

- private engine ready;
- media confirmation complete;
- compositor engaged;
- sender attached;
- encoded frames increasing;
- outbound bytes increasing.

The wording may be condensed in the popup, but readiness requires both a local
compositor and evidence that the outgoing sender is transmitting.

## Receiver verification from a second participant

Ask a participant using a second account or device to confirm that your camera
tile contains the expected neon diagram. A local preview or sender counter is
not receiver-side proof.

## What the audience sees

The audience sees your normal Meet camera tile with the Airboard diagram
composite. Account settings, setup controls, logs, private rendering surfaces,
and selection feedback do not enter the intended audience output.

## Disconnect or revoke

Disconnect from the extension and revoke the installation from **Airboard →
Integrations** when the preview should no longer access the organization.
Administrators can also revoke installations from installation health.
