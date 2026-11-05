# Meet Camera Composite Verification

This is the acceptance record for the audience-facing camera path. Airboard
can now prove from inside a real Meet client that Meet attached the composited
track and is encoding outbound RTP. A second participant is still required to
confirm the decoded remote image, compression quality, and recovery behavior.

## Prerequisites

- Serve the Airboard build being accepted from an origin allowlisted by the
  extension-owned `engine-relay.js`; Meet accepts messages only from that exact
  mounted relay iframe.
- Load/reload the unpacked bridge and confirm extension version **0.8.0**.
- Join one real Meet from the presenter Chrome profile and another from a
  separate browser/device/account. Keep the remote client muted to avoid echo.
- Do not open an Airboard activity. Open or refresh the meeting after reloading
  the extension so its hidden overlay engine starts with the page.

## Acceptance path

1. Join the meeting with the Meet camera on. Confirm there is no Airboard main
   stage or dedicated canvas and the neon board appears only on the camera tile.
2. Draw a labelled object near each horizontal edge and place one stroke across
   a shoulder/hand. Move the hand through the cropped camera edges.
3. Inspect the compositor protocol in a development build (the standalone
   diagnostics page will surface this later) and record all of these as
   true/increasing:
   - extension `0.8.0`;
   - composite frames greater than zero and increasing;
   - Meet sender `attached`;
   - encoded frames greater than zero and increasing;
   - outbound bytes greater than zero and increasing.
4. On the remote client, confirm:
   - labels read normally (not mirrored);
   - the pointer/hand stays aligned at the center and cropped edges;
   - the complete diagram remains above the camera image, including where ink
     crosses the presenter, with no segmentation cut-out or halo claimed;
   - the board contains no Airboard controls, selection feedback, or cursors;
   - motion and glow remain usable after Meet compression.
5. Turn **Meeting overlay** off in the popup and confirm the existing sender
   returns to plain camera passthrough without a camera restart. Turn it on and
   confirm sender and counters recover without opening a Meet activity.

## Evidence record

Record the date, Airboard revision/build, Chrome version, Meet meeting type,
extension version, presenter/receiver OS, the five metrics above, and one
presenter plus one receiver screenshot. Mark each remote assertion pass/fail
and link any recording. Do not mark receiver verification complete from the
presenter's self-view alone.

## Automated coverage boundary

`apps/web/test/chromeCompositor.test.mjs` executes the production compositor
against a simulated peer connection and asserts that only the composited
output track produces the sender/encoding proof. `apps/web/e2e/meetMediaBridge.spec.ts`
exercises the UI and frame pump with the bridge emulator. Those checks prevent
protocol regressions; the two-client run above is the final network/receiver
acceptance step.
