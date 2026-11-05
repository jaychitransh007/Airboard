---
title: Google Meet
description: Connect the private-preview Chrome extension, run preflight, and verify what a remote participant receives.
category: integrations
categoryLabel: Integrations
order: 10
status: private-preview
audiences: ["everyone", "admins"]
lastVerified: 2026-11-05
sources: ["extensions/chrome-meet-bridge/README.md", "extensions/chrome-meet-bridge/popup.html", "Docs/Meet Camera Composite Verification.md", "apps/web/src/features/product/IntegrationsPage.tsx"]
---

The Google Meet camera overlay is a private preview. It uses a private Airboard
engine and composites the transparent diagram plane into your outgoing Meet
camera. There is no dedicated shared Airboard canvas inside Meet.

## Install and connect

1. Install the approved preview build in the Chrome profile you use for Meet.
2. Open the Airboard extension popup and choose **Connect Airboard**.
3. Sign in, choose **Connect extension** on the setup page, and return to the
   popup.
4. Read the one-time live-media disclosure, tick the box, and choose
   **Enable Airboard**.

If Chrome cannot reach the installation, reload the extension and reopen the
setup page from the toolbar popup. A one-time connection token can expire; in
that case, start **Connect Airboard** again.

## Run preflight

Open or refresh a standard Google Meet meeting-code URL and turn on your normal
Meet camera. In the extension popup, confirm all six readiness checks complete:

1. **Account connected**
2. **Media confirmed**
3. **Meet detected**
4. **Private engine**
5. **Camera engaged** (the composite track is attached)
6. **Outgoing verified** (encoded frames and bytes are being sent)

Readiness requires both a local compositor and evidence that the outgoing
sender is transmitting.

## Receiver verification from a second participant

Ask a participant using a second account or device to confirm that your camera
tile contains the expected neon diagram. A local preview or sender counter is
not receiver-side proof.

## What the audience sees

The audience sees your normal Meet camera tile with the Airboard diagram
composite. Account settings, setup controls, logs, private rendering surfaces,
and selection feedback do not enter the intended audience output.

## Disconnect or revoke

To pause the overlay, turn off **Meeting overlay** in the extension popup. To
disconnect, remove the extension from Chrome; Airboard then opens
**Integrations**, where you choose **Revoke installation**. Owners and
administrators can also revoke installations from **Installation health**.
