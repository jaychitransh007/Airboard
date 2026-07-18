# Airboard Meet Media Bridge (Chrome extension)

Google Meet does not expose its media tracks to add-ons and does not delegate
camera permission to the add-on iframe (confirmed in a real client on
2026-07-16), so the Airboard add-on can never capture video by itself inside
Meet. This extension closes that gap: it runs on `meet.google.com` — the
origin the user already granted camera access to — and streams camera frames
into the Airboard add-on iframe **only after the user clicks "Enable hands"
inside Airboard**.

## Behavior and privacy contract

- No capture happens until the Airboard frame sends an explicit start request,
  which the Airboard UI issues only from a user click (Enable hands for the
  camera, Start Airo for the microphone).
- Frames and audio chunks are posted only to allowlisted Airboard origins (see
  `ALLOWED_ORIGINS` in `content.js`); requests from any other origin are
  ignored.
- Chrome's camera/microphone-in-use indicators are visible for the whole
  session.
- Stopping capture in Airboard, the device track ending, or leaving the page
  stops the stream immediately; camera and microphone stop independently.
- Frames are processed in the Airboard iframe for hand tracking (MediaPipe,
  in-browser). Microphone audio is consumed by Airboard's existing realtime
  transcription session (streamed to the configured speech provider through
  the Airboard API, exactly as on the standalone surface). The bridge itself
  stores and uploads nothing.

## Camera compositor (lightboard on your tile)

`compositor.js` (MAIN world, document_start) can composite the Airboard neon
board onto your outgoing Meet camera so every participant sees you behind the
glowing glass with no tab-sharing. It is inert until the "Lightboard on my
camera" toggle in the Airboard main stage arms it; arming persists in
meet.google.com localStorage because Meet acquires the camera before the
add-on opens — enabling mid-meeting takes one Meet camera off/on cycle. When
off, `getUserMedia` returns Meet's original stream untouched. Overlay frames
come only from allowlisted Airboard origins; leaving the main stage disarms
the compositor.

Mirroring: gestures and board content are authored in mirror space (selfie
mapping), so the compositor transmits the mirrored camera under the overlay —
one canonical frame in which hands align with the shapes they touch and text
reads correctly for every viewer. Because Meet force-mirrors the presenter's
own tile, the compositor also finds the tile carrying its own output track
(track-identity matching, not Meet CSS selectors) and neutralizes the flip
while the overlay is active, so the presenter sees the exact transmitted
frame too. Fallback if Meet's DOM changes: minimize the self-view.

## Install for the pilot (unpacked)

1. Open `chrome://extensions`.
2. Enable **Developer mode** (top right).
3. Click **Load unpacked** and select this directory
   (`extensions/chrome-meet-bridge`).
4. Join a Google Meet meeting, open the Airboard activity, and click
   **Enable hands** on the main stage.

For local development, `http://localhost:3000` and `http://127.0.0.1:3100`
are also allowlisted.

## Publishing

Chrome Web Store publication (listing, privacy disclosures, review) is a
GMEET-010-adjacent work item and must precede any customer-facing use.
