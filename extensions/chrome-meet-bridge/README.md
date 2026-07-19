# Airboard for Google Meet (Chrome extension)

Airboard uses a Chrome extension—not a Google Meet activity—to place a private
neon renderer on the presenter's outgoing camera. The audience sees the
ordinary Meet camera tile with Airboard composited into it; no side panel,
main-stage canvas, screen share, or second audience surface is required.

## First-install journey

1. Chrome installs the reviewed extension package and opens Airboard's
   integration page.
2. Airboard preserves the extension identity through sign-in and exchanges a
   one-time link for a revocable installation credential.
3. The toolbar popup requires affirmative camera, microphone, and voice
   processing confirmation. Raw media is processed live and is not stored by
   the extension.
4. On a meeting-code URL, the content script mounts a private 1280×720 engine.
   Overlay, neon theme, gesture-camera, Airo microphone, and person occlusion
   default to enabled, subject to user and organization policy.
5. The main-world compositor upgrades an already-running Meet sender in place,
   so first setup does not require the user to restart their camera.
6. The popup and Airboard account show independent checks for installation,
   account link, consent, Meet detection, compositor engagement, and real
   outbound RTP encoding.

Settings are persisted to the installation record. Installation credentials
use a revocable 90-day sliding window and rotate when status is refreshed. A
revoked or long-dormant installation fails closed and asks the user to connect
again.

## Privacy and trust boundary

- The production package has one host permission: the Airboard API origin.
- Content scripts run only on `https://meet.google.com/*`.
- Frames and PCM chunks move only between Meet, the extension-owned relay, and
  the allowlisted Airboard renderer. The extension stores no raw media.
- The renderer performs on-device hand tracking and person segmentation. Airo
  sends microphone audio to the configured transcription provider only while
  Airo is enabled.
- Chrome's camera and microphone indicators remain visible. Leaving the
  meeting, disabling an input, or disabling Airboard releases its capture.
- The website can read sanitized readiness state through
  `externally_connectable`; the installation credential is never returned.

## Local unpacked verification

1. Open `chrome://extensions` and enable **Developer mode**.
2. Choose **Load unpacked** and select `extensions/chrome-meet-bridge`.
3. Confirm version **0.8.0**.
4. Open the toolbar popup, connect Airboard, and complete the one-time media
   confirmation.
5. Open or refresh a Google Meet meeting. Do not open Airboard from Meet's
   Activities panel.
6. Keep the popup open until all six readiness checks pass, then confirm the
   decoded image from a second participant.

Local development also permits `http://localhost:3000` and
`http://127.0.0.1:3100`. The production package removes those origins.

## Chrome Web Store package

Run:

```sh
pnpm build:extension
```

The upload-ready archive and SHA-256 checksum are written to
`dist/chrome-extension/`. The script excludes development origins, includes
all icons, and fails if the production package retains localhost references.
Publication, privacy declarations, screenshots, review, and the final Web
Store URL remain publisher-console actions; follow
[`Docs/Chrome Web Store Release.md`](../../Docs/Chrome%20Web%20Store%20Release.md).
