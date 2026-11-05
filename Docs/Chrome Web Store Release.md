# Chrome Web Store release — Airboard for Google Meet

This is the production distribution runbook for the camera-overlay product.
The legacy Google Workspace Marketplace add-on is not part of this journey and
must not be advertised as the way to add Airboard to a meeting.

## Upload artifact

Build a publishable artifact with `pnpm release:extension`. That command first
checks the deployed renderer, API bridge protocol, extension version, exact
Web Store ID, and API kill switch, then creates the ZIP. Upload the generated
`dist/chrome-extension/airboard-for-google-meet-<version>.zip` and retain the
adjacent SHA-256 and `.permission-review.json` files, plus the compatibility
checker output, with the release evidence.

If the listing does not have an extension ID yet, `pnpm build:extension` may be
used once to create an **unsubmitted draft** in the Developer Dashboard and
obtain that ID. It is not a release artifact. Configure and deploy the ID as
described below, rerun `pnpm release:extension`, and replace the draft package
before adding testers or submitting for review.

## Listing copy

- **Name:** Airboard for Google Meet
- **Single purpose:** Put a private Airboard neon diagram layer into the
  presenter's outgoing Google Meet camera.
- **Short description:** Explain ideas on your Meet video with live neon
  diagrams, Airo voice commands, and gestures.
- **Category:** Productivity
- **Language:** English

The detailed description must explain that Airboard:

1. runs only on Google Meet meeting pages;
2. adds the diagram to the presenter's outgoing camera rather than opening a
   shared Meet canvas;
3. requires an Airboard account and a one-time live-media confirmation;
4. processes camera and microphone data live and does not store raw media;
5. sends microphone audio to the configured transcription provider only while
   Airo is enabled;
6. can be disabled or uninstalled at any time; and
7. may require a paid plan after the three-day trial.

## Permission and data-use declarations

| Capability | Reason |
| --- | --- |
| `storage` | Store the random per-profile installation UUID, revocable credential, settings, consent state, and content-free readiness counters. |
| `https://meet.google.com/*` content scripts | Intercept only Meet's camera acquisition and WebRTC sender so the user-requested composite reaches participants. |
| Airboard API host permission | Link the installation, read entitlement and policy, persist settings, rotate the credential, and report verified outbound counters. |
| Airboard web `externally_connectable` origin | Complete account linking and show sanitized setup readiness without exposing the installation credential. |

Declare authentication information, website content, user-generated content,
and personal communications only to the extent required by Google's current
question wording. The privacy answers and public privacy notice must match the
implemented behavior exactly. Airboard does not sell data, use it for
advertising, or store raw camera/microphone media.

## Required listing assets and validation

- 128×128 product icon: `extensions/chrome-meet-bridge/icons/icon-128.png`
- At least one current screenshot showing the popup's six readiness checks.
- At least one current receiver-side screenshot showing the neon composite in
  a normal Meet camera tile and no dedicated Airboard surface.
- Optional promotional tiles derived from the current Airboard visual system.

Do not reuse the historical Marketplace main-stage screenshot. Run the
two-client acceptance path in `Docs/Meet Camera Composite Verification.md` and
capture the actual 0.8.0 result.

## Release order

1. If necessary, create an unsubmitted draft item to obtain its stable
   32-character extension ID.
2. Set `NEXT_PUBLIC_AIRBOARD_CHROME_EXTENSION_ID` and
   `AIRBOARD_CHROME_EXTENSION_ID` to the same reviewed package ID, set
   `NEXT_PUBLIC_CHROME_EXTENSION_VERSION` to the N+1 package version, and
   explicitly set `AIRBOARD_CHROME_EXTENSION_ENABLED=true` on the API.
3. **Before publishing N+1**, deploy the API and renderer with the same bounded
   overlap window: set `AIRBOARD_CHROME_EXTENSION_COMPATIBLE_VERSIONS=N,N+1`
   and `NEXT_PUBLIC_AIRBOARD_CHROME_EXTENSION_COMPATIBLE_VERSIONS=N,N+1`.
   For the canonical web build, pass the renderer value through Cloud Build's
   `_CHROME_EXTENSION_COMPATIBLE_VERSIONS` substitution (and pass the reviewed
   ID through `_AIRBOARD_CHROME_EXTENSION_ID`). A first release uses N only.
4. Ensure `AIRBOARD_ALLOWED_ORIGINS` explicitly contains the exact
   `AIRBOARD_APP_URL` origin. Run `pnpm verify:extension-deployment`; it must
   confirm the compatibility responses and prove that the renderer Origin
   reaches authentication on semantic intent, voice trace/metrics, and the
   transcription WebSocket. JSON POST preflights must authorize `POST` and
   `content-type`; HTTP probes must return the renderer origin as the exact
   `Access-Control-Allow-Origin` value.
5. Run `pnpm release:extension`; do not upload if the deployment compatibility
   check fails. Upload the resulting ZIP as an unlisted test package. The
   packager also refuses a compositor `EXTENSION_VERSION` that differs from
   `manifest.json`.
6. Complete automated checks and the two-client real Meet acceptance. Add
   trusted testers and verify clean install, sign-in return, consent,
   automatic live-sender upgrade, disable/restore, and credential rotation.
7. Complete Privacy practices and store listing fields, then submit N+1 for
   Chrome Web Store review.
8. After approval, set `NEXT_PUBLIC_CHROME_WEB_STORE_URL` to the final detail
   URL whose last path segment is the same reviewed 32-character
   `NEXT_PUBLIC_AIRBOARD_CHROME_EXTENSION_ID`, then redeploy the web app. The
   runtime, image build, launch check, and deployment verifier all reject a
   malformed listing or a listing for another package. Production renderer
   traffic remains restricted to the configured exact `chrome-extension://`
   origin; local unpacked previews use a fresh per-frame 256-bit nonce only in
   non-production builds.
9. Keep both services accepting N and N+1 while Chrome rolls the update out.
   Verify adoption and retain deployment-check plus two-client evidence; do not
   infer adoption merely from Web Store approval.
10. Only after the agreed adoption evidence is complete, contract both overlap
    variables to N+1, deploy API and web, rerun
    `pnpm verify:extension-deployment`, and verify every **Add to Chrome** button
    resolves to the reviewed listing.

## Emergency disable and rollback

Set `AIRBOARD_CHROME_EXTENSION_ENABLED=false` on the API and deploy the API
configuration. New link, exchange, consent, settings, and preflight requests
then fail closed. Existing installations receive a policy without
`chrome_meet` on their next status refresh (normally within five minutes),
which unmounts the private engine and restores Meet's original sender. Verify
that behavior with a connected test profile before recording the rollback gate.

Re-enable only after the corrected Web Store version is available to the test
profile, set the variable back to `true`, refresh status, and repeat the
two-client receiver acceptance. Withdrawing or rolling back the store version
remains a Chrome Developer Dashboard action.

The website deliberately shows **Private preview** and no install button until
the Web Store URL is configured. This prevents a false or deceptive install
claim.
