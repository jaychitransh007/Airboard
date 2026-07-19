# Chrome Web Store release — Airboard for Google Meet

This is the production distribution runbook for the camera-overlay product.
The legacy Google Workspace Marketplace add-on is not part of this journey and
must not be advertised as the way to add Airboard to a meeting.

## Upload artifact

Run `pnpm build:extension`. Upload the generated
`dist/chrome-extension/airboard-for-google-meet-<version>.zip` and retain the
adjacent SHA-256 file with the release evidence.

## Listing copy

- **Name:** Airboard for Google Meet
- **Single purpose:** Put a private Airboard neon diagram layer into the
  presenter's outgoing Google Meet camera.
- **Short description:** Explain ideas on your Meet video with live neon
  diagrams, Airo voice commands, gestures, and presenter-aware depth.
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
| `storage` | Store the revocable installation credential, settings, consent state, and content-free readiness counters. |
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

1. Complete automated checks and the two-client real Meet acceptance.
2. Upload the ZIP as an unlisted test item first.
3. Complete Privacy practices and store listing fields.
4. Add trusted testers and verify clean install, sign-in return, consent,
   automatic live-sender upgrade, disable/restore, and credential rotation.
5. Submit for Chrome Web Store review.
6. After approval, set `NEXT_PUBLIC_CHROME_WEB_STORE_URL` to the final detail
   URL and `NEXT_PUBLIC_CHROME_EXTENSION_VERSION` to the approved version.
7. Deploy the web build and verify every **Add to Chrome** button resolves to
   the reviewed listing.

The website deliberately shows **Private preview** and no install button until
the Web Store URL is configured. This prevents a false or deceptive install
claim.
