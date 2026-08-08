# Lightboard Mode — Feasibility and Design Directions

> **Status:** Steps 1–4 plus the P0–P2 overlay pass implemented (2026-07-18) — neon theme, camera/screen underlays, adaptive contrast, crop-correct AR, studio recorder, automatic source composition, Meet outbound-RTP proof, and a native click-through desktop shell are live. The later product decision fixes audience composition to video → dark overlay → diagrams, with no presenter cut-out above the scrim. The former presentation wizard and clean-output mode were removed; the regular canvas is the only standalone mode. Receiver-side Meet corroboration and steps 5–6 remain external acceptance/proposals. Not part of the public-beta plan.
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

- **Global scrim as a dial, local contrast as the screen default:** one board-opacity slider runs from 0 (pure AR over video) to 1 (solid near-black board). Camera/personal lightboard can still use the classic ~0.9 look; selecting a real screen lowers an overly dark preference to 0.25 and adds clustered local glass behind diagram objects.
- **Screen as an underlay:** the standalone surface can capture a user-selected screen or window with `getDisplayMedia`, preserve its full frame unmirrored, and place the scrim + structured board above it. The user presents the composed Airboard tab; capture stops explicitly, on source-ended, on theme exit, or on unmount.
- **Neon strokes:** two-pass rendering — wide low-alpha colored halo under a thin bright core, `lighter` composite blending. Palette from real lightboard markers: cyan, magenta, lime, amber; white cores for text.
- **Legibility over video:** implemented local contrast plates merge nearby nodes into softly rounded dark-glass clusters. Connectors, arrows, highlights, group containers, and deleted objects do not generate large opaque regions, preserving the underlying screen between clusters.
- **Occlusion and mirroring:** the camera, landmarks, navigation, and person mask now share the exact centered cover-fit geometry. A local MediaPipe landscape segmenter produces a feathered foreground mask at ~12fps. Standalone preview/recording redraw person pixels above ink; the Meet frame pump cuts those pixels out of the board bitmap before the extension composites it over the mirrored camera.

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
   - **No separate presentation workflow:** the regular canvas automatically uses an active screen/window, otherwise an active camera, otherwise the dark canvas. Virtual meetings use the hidden compositor directly; there is no readiness wizard or audience confirmation step.
   - Starting output enters a strict `broadcast-safe` state. Topbar, sidebar, catalog, typed-command dock, exit button, recording status, voice/onboarding/toast/debug feedback, floating label editor, selection/hover/ghost/guideline overlays, collaboration cursors, and the pointer itself are absent. Escape is the presenter-only exit path.
   - The P0 screen-overlay slice adds an explicit **Use screen** action: the selected screen/window becomes an unmirrored, contain-fit layer beneath the scrim and transparent board. Screen capture automatically enables Lightboard, takes precedence over the camera background, and is included correctly in studio recordings.
   - The P1 contrast pass replaces the screen-hostile 0.85 default during screen use with a 0.25 global dim (while preserving an already-lighter user choice) plus opt-out local contrast plates behind diagram clusters. Plates render below neon content and are included in canvas/studio output.
   - Browser boundary: this composes the audience-facing Airboard tab without opening another canvas tab. The separate native desktop shell now closes the literal overlay boundary described below; browser-only deployments remain limited to the composed tab or an extension-injected overlay inside supported tabs.
   - Verified by pure readiness/scrim/cluster unit tests and Playwright journeys covering source selection, local + meeting-preview verification, pixel-level local contrast, strict output hygiene, source-ended recovery, and Escape restoration.
3a. **[DONE 2026-07-18]** Literal click-through desktop overlay (P0 boundary).
   - `apps/desktop` hosts the existing standalone board in a transparent, frameless Electron `BrowserWindow` sized to an exact OS display. The actual desktop/app remains behind the window; no screen capture or synthetic underlay is used.
   - The native window is always-on-top, visible across workspaces/fullscreen apps where the OS supports it, absent from the taskbar/Dock, and starts with `setIgnoreMouseEvents(true, {forward:true})`, so clicks reach arbitrary apps underneath.
   - A tray/menu-bar control and `Cmd/Ctrl+Shift+O` temporarily disable pass-through and focus the overlay. The renderer then exposes only the small setup HUD (hands, Airo, typed command, Undo, dark-overlay dial); returning to click-through removes the HUD, hides presenter cursors/selection feedback, and relinquishes focus. `Cmd/Ctrl+Shift+H` shows/hides the overlay, and the tray selects the target display.
   - The preload stays sandboxed/context-isolated and exposes a narrow IPC bridge rather than Node/Electron APIs. External windows and cross-origin navigation are denied.
   - Renderer coverage verifies a transparent full-display canvas and scrim with no camera/screen underlay; native unit coverage verifies exact bounds, transparency options, topmost mode, and both sides of mouse pass-through.
4. **[DONE 2026-07-18, receiver corroboration is an external acceptance step]** Extension camera compositor → Meet camera-tile magic.
   - Extension gains a MAIN-world `compositor.js` (document_start): wraps meet.google.com's `getUserMedia`; when armed (localStorage, set only by an allowlisted Airboard frame), Meet receives a composited stream — camera frames + scrim + the transparent neon overlay — via a canvas capture pipeline with clean track-stop propagation. Off = pure passthrough (original stream untouched).
   - Overlay channel (reverse of the capture bridge): the main-stage board streams ~15fps downscaled transparent ImageBitmaps with the scrim value; ack-backpressured; leaving the surface disarms the compositor so a stale overlay can never ride the camera.
   - UI: "Lightboard on my camera" toggle on the Meet main stage (auto-switches to the neon theme) with engaged/pending status — enabling mid-meeting requires one Meet camera off/on cycle since Meet acquires the camera before the add-on opens.
   - **Actual sender verification (extension 0.5.0):** the MAIN-world hook observes Meet's real `RTCRtpSender` attachments and polls outbound video stats only for its composited output track. Airboard exposes extension version, composite-frame count, sender attachment, encoded frames, and outbound bytes. It says “Verified in this Meet client” only when Meet has attached that exact output and is encoding/sending bytes. This closes the former gap between “the local compositor is engaged” and “the actual meeting client is transmitting it.”
   - Verified in automation: protocol/state sanitization, compositor frame and output-track identity, a simulated `RTCPeerConnection`/outbound-RTP stats path using the production extension script, and a full emulated-compositor Playwright journey through the verified UI. Receiver-side appearance still requires a second human/client because no same-page assertion can inspect a remote attendee's decoded tile; the reproducible acceptance record is in `Docs/Meet Camera Composite Verification.md`.
   - Mirroring solved (2026-07-18, extension 0.4.0): the compositor transmits the mirror-space canonical frame (mirrored camera under the overlay — hands align with shapes, text audience-correct) and counter-flips the presenter's own Meet tile by output-track identity, so presenter, remote participants, recordings, and tab-shares all see one identical, correct-reading frame.
   - AR alignment solved (2026-07-18): `object-fit: cover` crop offsets are applied before selfie mirroring and sensitivity for every gesture consumer. The experimental person-mask module remains isolated, but production rendering does not invoke it: camera pixels stay below the full dark scrim and complete diagram layer.
5. Zoom Camera Mode pilot → concrete PF-004 goal.
6. Teams filter-app spike, else virtual camera → PF-003 alignment; D is also the universal streaming/recording end-state.

## Sources

- [Zoom Apps Layers API](https://developers.zoom.us/docs/zoom-apps/guides/layers-api/) · [Using the Layers API](https://developers.zoom.us/docs/zoom-apps/guides/layers-using-api/)
- [Microsoft Teams video filters GA announcement](https://techcommunity.microsoft.com/blog/microsoftteamsblog/introducing-video-filters-in-microsoft-teams-meetings/3764187)
- [Visual Effects for Google Meet (Chrome Web Store)](https://chromewebstore.google.com/detail/visual-effects-google-mee/lcalofoidkpopkkadcjjgcnnkcoalpba) · [AI Webcam Effects](https://chromewebstore.google.com/detail/ai-webcam-effects-+-recor/iedbphhbpflhgpihkcceocomcdnemcbj)
- [Electron BrowserWindow API](https://www.electronjs.org/docs/latest/api/browser-window) · [Electron globalShortcut API](https://www.electronjs.org/docs/latest/api/global-shortcut) · [Electron tray guide](https://www.electronjs.org/docs/latest/tutorial/tray)
- [MediaPipe Image Segmenter API](https://ai.google.dev/edge/api/mediapipe/python/mp/tasks/vision/ImageSegmenter) · [MediaPipe Selfie Segmentation model card](https://storage.googleapis.com/mediapipe-assets/Model%20Card%20MediaPipe%20Selfie%20Segmentation.pdf)
