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
  which the Airboard UI issues only from a user click.
- Frames are posted only to allowlisted Airboard origins (see
  `ALLOWED_ORIGINS` in `content.js`); requests from any other origin are
  ignored.
- Chrome's camera-in-use indicator is visible for the whole session.
- Stopping capture in Airboard, the camera track ending, or leaving the page
  stops the stream immediately.
- Frames are processed in the Airboard iframe for hand tracking (MediaPipe,
  in-browser); the bridge itself stores and uploads nothing.

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
