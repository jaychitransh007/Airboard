# Browser matrix

Evidence for the standalone-GA gate `browser-matrix` in `ops/launch-evidence.json`:
the promised desktop browser and OS matrix passes, with documented exclusions.

**Status (6 November 2026):** macOS passes on the current and previous Chrome.
Windows hasn't been run, so the gate stays pending.

## What is promised

From the [Platform Support Matrix](Platform%20Support%20Matrix.md):

| Browser | Versions | Systems | Status |
| --- | --- | --- | --- |
| Google Chrome | Current and previous release | Windows, macOS | Promised |
| Microsoft Edge | Current and previous release | Windows | Promised |
| Chrome on ChromeOS | Current | ChromeOS | Candidate, not promised yet |
| Firefox, Safari | — | — | Excluded until camera, speech, canvas and browser-test coverage exist |
| Phone and tablet browsers | — | iOS, Android | Excluded; a companion or view-only experience is a later decision |

The help article [System requirements](help/getting-started/02-system-requirements.md)
tells customers the same thing.

## Results

All runs use the full browser suite in `apps/web/e2e`: 87 tests, of which 85 run and 2 skip by design (see below).
The suite covers:
- typed commands and their edits
- board layout on desktop and phone-sized windows
- two-browser live sync and reload
- export
- keyboard access
- the gesture pipeline with a fake camera
- the Meet bridge, emulated
- the shared-board viewer
- the signed-in app: the library, saving, version conflicts, view-only links and Admin invites
- WCAG 2.2 AA checks

The code is `codex/production-readiness` as of `10075ba`, plus the matrix setting below.

| Browser | Version | System | Result |
| --- | --- | --- | --- |
| Google Chrome (installed) | 156.0.8078.80, current stable | macOS 26.5.1, Apple silicon | 85 passed, 2 skipped |
| Chrome for Testing | 155.0.8059.84, previous release | macOS 26.5.1, Apple silicon | 85 passed, 2 skipped |
| Playwright Chromium (CI and local default) | 156.0.8078.4 | Linux (GitHub Actions), macOS | 85 passed, 2 skipped |
| Google Chrome | Current and previous | Windows | **Not run** — needs a Windows machine |
| Microsoft Edge | Current and previous | Windows | **Not run** — needs a Windows machine |

The two skipped tests:
- **`gestureVideoReplay.spec.ts`** replays recorded hand videos. The release dataset declares no browser video yet, and the dataset check fails on its own when one is required.
- **`realDeviceMedia.spec.ts`** uses the real camera and microphone. It only runs when someone sets its opt-in at their own machine.

## Not covered by the automated suite

These need a person on a real device in each promised browser. Record the date, machine, browser version and result here when done:
- Signing in with Google on the live site, then signing out.
- A real camera: Airo's hand tracking with a real hand, and pan and zoom with two hands.
- A real microphone: an Airo voice command spoken in a real meeting.
- Screen sharing a board, and the Meet camera overlay in a real meeting (Chrome only).
- Display scaling of 125–200% on Windows.

## How to run it

From `apps/web`, with the browser installed:

```
AIRBOARD_E2E_CHANNEL=chrome pnpm exec playwright test   # installed Chrome
AIRBOARD_E2E_CHANNEL=msedge pnpm exec playwright test   # installed Edge
AIRBOARD_E2E_EXECUTABLE="/path/to/Chrome for Testing" pnpm exec playwright test   # any other Chromium build
```

`npx @puppeteer/browsers install chrome@<major>` downloads an earlier Chrome for
Testing for the previous-release row. Specs that set their own browser flags
use `e2e/support/launchOptions.ts`, so they run in the chosen browser too.

## Change log

| Date | Change |
| --- | --- |
| 2026-11-06 | First matrix run: macOS Chrome 156 and 155 pass; Windows Chrome and Edge not yet run. Added the `AIRBOARD_E2E_CHANNEL` and `AIRBOARD_E2E_EXECUTABLE` settings. |
