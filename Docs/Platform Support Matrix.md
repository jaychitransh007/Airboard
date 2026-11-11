# Airboard Platform Support Matrix

> **Status:** current channel inventory for the controlled pilot
> **Last updated:** 2026-11-12
> **Owner:** Product and platform engineering
> **Decision scope:** current availability for standalone web, Google Meet, Microsoft Teams and Zoom

## Decision

Airboard has no generally available platform commitment yet. The launch scope
(owner decision, 11 November 2026) is the live web app and Google Meet by
presenting the Airboard tab:

1. **Standalone web** is the shipped controlled-pilot surface.
2. **Google Meet** works by presenting the Airboard tab in the call
   (**Present now → A tab**). Nothing is installed; voice, hands, keyboard and
   mouse keep working in the Airboard tab.
3. **A screen behind the board** (slides or another app) is part of the web
   app: **Show a screen behind the board** in the board's **•••** menu.
4. Microsoft Teams, Zoom, phones and tablets are not available.

The Chrome Meet extension (`extensions/chrome-meet-bridge`), the unpublished
Meet add-on surfaces and the native Electron overlay (`apps/desktop`) are still
in the repository but are **not offered**: the extension is switched off in
production and is not in the Chrome Web Store, the add-on was never published,
and the Electron app is not advertised. Reviving any of them is an owner
decision.

## Browser support

| Browser | Versions | Systems | Status |
| --- | --- | --- | --- |
| Google Chrome | Current and previous release | Windows, macOS | Promised |
| Microsoft Edge | Current and previous release | Windows | Promised |
| Chrome on ChromeOS | Current | ChromeOS | Candidate, not promised yet |
| Firefox, Safari | — | — | Excluded until camera, speech, canvas and browser-test coverage exist |
| Phone and tablet browsers | — | iOS, Android | Excluded |

## Current release support matrix

| Channel | Current availability | Eligible client | Product surface | Promotion boundary |
| --- | --- | --- | --- | --- |
| Standalone web | Controlled pilot | Desktop Chrome and Edge on the browser table above | Full-page Airboard with voice, hands, typing, pointer and a screen behind the board, subject to device permission and provider configuration | General availability needs the standalone launch gate and its browser and device evidence |
| Google Meet (present the tab) | Controlled pilot | Chrome or Edge desktop, with Meet in the same browser | The presented Airboard tab | Same as standalone web; no Meet-specific install or review |
| Chrome Meet extension | Not offered | — | In the repo, switched off | Owner decision, Web Store review and receiver-side Meet evidence |
| Native desktop overlay (Electron) | Not offered | — | In the repo, not advertised | Owner decision, signed installers, updates and OS validation |
| Microsoft Teams and Zoom | Not supported | None | None | Each provider needs its own implementation, identity, store, privacy and operations gate |

The add-on-era provider research (through 16 July 2026) is kept in
[Docs/archive/Meet Add-on Provider Feasibility Record.md](archive/Meet%20Add-on%20Provider%20Feasibility%20Record.md).
