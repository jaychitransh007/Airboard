# Lightboard Mode — Feasibility and Design Directions

> **Status:** Steps 1–3 implemented (2026-07-18) — neon theme, camera underlay, scrim dial, studio recorder, and presenting mode live on the standalone surface; steps 4–6 remain proposals. Not part of the public-beta plan.
> **Date:** 2026-07-17
> **Context:** Inspired by physical lightboard videos (presenter behind glass, neon marker strokes on black). Goal: Airboard delivers that experience digitally — gesture/voice-built neon diagrams composited over the presenter's own camera video, visible to other meeting participants — without the glass, the darkroom, or the mirror rig.
> **Relationship to the beta checklist:** This is not beta work. If adopted, the Zoom and Teams paths below become concrete goals inside PF-004 and PF-003 respectively; the Meet path extends the existing Media Bridge extension; everything else is standalone product work.

## The reframe

Airboard should not imitate the glass — it should beat it:

- **No mirror-flip problem.** Strokes render audience-correct while the presenter sees a mirrored self-view. The physical lightboard's biggest operational headache disappears because the ink is digital.
- **The overlay is a live shared board, not baked pixels.** It renders board-session state, so another participant's edit appears inside the presenter's video. No camera-filter product has this.
- **The output is a diagram, not a video of a diagram.** Export, undo, rearrange — after the meeting the artifact is still structured.

## Can an overlay ride the presenter's outgoing video? (verified 2026-07-17)

| Path | Platform | Verdict | Basis |
| --- | --- | --- | --- |
| **A. Extension camera compositor** — extend the existing Meet Media Bridge with a MAIN-world stage that wraps `getUserMedia`, pipes the camera through a canvas adding the neon layer, and hands Meet the composited track | Google Meet web (Chrome) | Highly feasible; effects composited this way are visible to all participants | Whole product ecosystem works this way (Visual Effects for Google Meet, AI Webcam Effects). We already own the extension and proved the canvas→`captureStream` pattern in the bridge |
| **B. Zoom Camera Mode** — `runRenderingContext({view:"camera"})` renders the app off-screen *as the user's video stream*; `drawParticipant` composites the presenter's own camera inside it (default 1280×720 target) | Zoom desktop | Native and sanctioned — the API is effectively this feature | Official Zoom Apps Layers API docs; developer-forum threads show Windows maturity caveats to spike in PF-004 |
| **C. Teams video-filter app** | Microsoft Teams | Possible, unverified boundary — third-party video filters went GA (2023) as a Teams-platform app category; unknown whether a filter app may render *live external state* (board session) vs. self-contained effects. Spike in PF-003; fallback is path D | Microsoft Teams blog GA announcement |
| **D. Virtual camera desktop companion** — native app composites camera + board and exposes "Airboard Camera" as a system device (mmhmm/OBS pattern; macOS Camera Extensions, Windows virtual camera APIs) | Every client incl. Teams, Webex, OBS, recorders | Feasible; biggest build (first native component); universal end-state incl. streaming/recording | Mature precedent products and OS APIs |
| **E. Screenshare presenting mode** — lightboard-themed board with the camera as its background layer, shared via "Present a tab" | Everywhere, today | Zero platform risk; not the camera-tile magic, but *crisper*: screenshare content codecs preserve thin neon lines that camera-channel compression smears | Needs only the theme + camera underlay |

## Why Airboard is unusually close

Existing building blocks: the MediaPipe hand pipeline (AR mode *simplifies* coordinate mapping — the hand draws where the hand appears, an identity mapping); the themeable canvas renderer; standalone camera capture; the canvas→`captureStream` compositor proven in the Meet bridge; board-session sync (what makes the overlay multiplayer); and the wake-word/palm-gate discipline with its zero-false-accept record, which lets a presenter narrate continuously without speech mutating the board — the enabling property for the education use case. MediaPipe's segmentation model (same vendored family) enables the depth illusion: strokes rendered behind the presenter's body where they overlap, like real glass.

## Interface: transparent black + neon

- **Scrim as a dial, not a mode:** one board-opacity slider from 0 (pure AR over video) to 1 (solid near-black board — also the personal/standalone look). The classic lightboard aesthetic sits around 0.9.
- **Neon strokes:** two-pass rendering — wide low-alpha colored halo under a thin bright core, `lighter` composite blending. Palette from real lightboard markers: cyan, magenta, lime, amber; white cores for text.
- **Legibility over video:** auto-scrim behind stroke clusters; stroke weights tuned per path (camera-channel compression kills fine glow — chunkier cores there; screenshare can stay fine).
- **Occlusion and mirroring:** segmentation-based person occlusion; presenter-mirrored preview with audience-correct text.

## Use-case readings

1. **Meetings with stakeholders:** staged — screenshare mode (E) now; Meet camera tile becomes the lightboard via the extension (A); Zoom native (B). Differentiator: the overlay is a live multiplayer board.
2. **Personal diagramming (no meeting):** the theme at scrim 1.0 is simply a beautiful dark canvas, camera optional; same gestures/voice/muscle memory; neon PNG export. Smallest lift.
3. **Educational content (the screenshot's world):** the strongest wedge — a **digital lightboard studio**: talk to camera while gestures place glowing shapes and Airo builds what is narrated; built-in recording via canvas `captureStream` + the existing mic pipeline → WebM; later path D feeds OBS/YouTube Live. Versus the physical rig: no glass, no darkroom, no re-shoots — Undo. No lightboard creator today has "the diagram draws itself while I speak."

## Honest constraints

- **Freehand air-writing is the wrong battle.** Marker-on-glass is optimized for handwriting; unsupported air-writing is wobbly and tiring. Airboard's winning move is structured strokes — shapes, connectors, voice-labeled text in the neon skin — with freehand as an accent.
- CPU budget: hands + segmentation + composite + encode concurrently needs a performance gate for low-end laptops.
- Meet-extension maintenance fragility; Chrome Web Store review and disclosure updates (board content leaves via the video channel).
- Zoom Camera Mode Windows maturity; Teams filter-app capability boundary unknown.

## Recommended sequence (when adopted)

1. **[DONE 2026-07-18]** Neon theme + camera underlay + scrim dial on standalone (unlocks use case 2; foundation for all).
   - Renderer: `theme: "lightboard"` draws content through an offscreen layer composited as a blurred additive halo under a sharp core; dark inks are lifted via colorfulness-aware adaptation (`neonInk.ts`, unit-tested) so light-board content stays legible. Classic theme is byte-identical to before (identity transform).
   - App: Appearance section (theme toggle everywhere; camera-underlay toggle standalone-only; board-dimming slider 0–1), DOM-layer underlay video (mirrored, shares the tracker stream — no per-frame canvas compositing) + scrim div, redundant corner self-preview hidden while the underlay is on, preferences in localStorage.
   - Verified: 5 Playwright journeys with pixel-level assertions (opaque white classic corner, transparent lightboard canvas, neon brightness, fake-camera underlay, persistence).
   - Known limits: PNG export of a lightboard board has a transparent background (glow preserved); gesture cursor is not yet AR-anchored to the underlay video.
2. **[DONE 2026-07-18]** Built-in recorder → use case 3 ships as the "lightboard studio" (no platform gatekeepers; most differentiated).
   - `lightboardRecorder.ts`: a recording canvas re-composites the DOM stack per frame (mirrored cover-fit underlay → scrim → neon board canvas), capped at 1920 wide with even dimensions; `captureStream(30)` plus a best-effort microphone track feed MediaRecorder (VP9→VP8→WebM fallback); stop() yields a Blob downloaded locally as `airboard-lightboard-<timestamp>.webm`. Nothing uploads.
   - UI: Studio section (standalone only) with record/stop and elapsed clock; pulsing REC badge over the board; denied microphone degrades to video-only with a notice.
   - Verified: pure-geometry unit tests (dimensions, cover-fit, filename) and a Playwright journey that records ~2.5s with the fake camera/mic and asserts a real >5KB WebM download.
3. **[DONE 2026-07-18]** Screenshare presenting mode → use case 1 usable in Meet immediately.
   - A Present toggle (standalone toolbar) strips the topbar, sidebar, and catalog to a full-bleed stage for "Present a tab"; a translucent floating dock keeps typed commands and Airo feedback reachable (no dead end), Escape or the corner button exits, and the REC badge stays visible while recording.
   - Verified by a Playwright journey: chrome hidden, typed command applied through the floating dock, Escape restores the app.
4. Extension camera compositor → Meet camera-tile magic.
5. Zoom Camera Mode pilot → concrete PF-004 goal.
6. Teams filter-app spike, else virtual camera → PF-003 alignment; D is also the universal streaming/recording end-state.

## Sources

- [Zoom Apps Layers API](https://developers.zoom.us/docs/zoom-apps/guides/layers-api/) · [Using the Layers API](https://developers.zoom.us/docs/zoom-apps/guides/layers-using-api/)
- [Microsoft Teams video filters GA announcement](https://techcommunity.microsoft.com/blog/microsoftteamsblog/introducing-video-filters-in-microsoft-teams-meetings/3764187)
- [Visual Effects for Google Meet (Chrome Web Store)](https://chromewebstore.google.com/detail/visual-effects-google-mee/lcalofoidkpopkkadcjjgcnnkcoalpba) · [AI Webcam Effects](https://chromewebstore.google.com/detail/ai-webcam-effects-+-recor/iedbphhbpflhgpihkcceocomcdnemcbj)
