# Airboard

Intent-driven diagram canvas for meetings, with typed, voice, pointer, and hand-gesture control.

## Current Product Slice

The current prototype is **Intent Canvas**: users describe a diagram change and it is applied instantly — by voice, gesture, or typed command — with no confirmation step. Undo is the safety net. To edit an existing element, grab it (or select it) and say what you want (e.g. "Airo, rename this to Payments"). Pointer and camera gestures are used for placement, selection, and precise object manipulation rather than mid-air freehand drawing.

See [Intent Canvas Implementation Notes](Docs/Intent%20Canvas%20Implementation%20Notes.md) for the supported commands, interaction model, test path, and current browser/hardware limits.

## Local Development

The first implementation is local-first:

1. Install dependencies with `pnpm install`.
2. Start local Supabase with `pnpm supabase:start`.
3. Reset and seed local data with `pnpm supabase:reset`.
4. Run the web app with `pnpm dev:web`.
5. Run the API/WebSocket service with `pnpm dev:api`.

The local slice focuses on proving the Intent Canvas interaction before meeting-platform integration.

## Screen-overlay presentation

On the standalone surface, **Use screen** lets the presenter choose a screen or window as the live background. Airboard renders a light global dim plus local dark-glass plates behind diagram clusters, keeping slides readable without sacrificing neon contrast. **Present** opens a source/readiness workflow, automatically enables Lightboard, and requires both a local composite check and confirmation of the meeting share preview before starting strict broadcast-safe output. That output contains no command dock, exit button, selection handles, collaboration cursors, onboarding, recording badge, or other presenter feedback; press Esc to return. The selected screen is never uploaded by this flow, capture ends when the user stops it or the source ends, and studio recording uses the same unmirrored full-frame composition.

Camera AR now uses the same centered `object-fit: cover` transform for the visible video, hand landmarks, two-hand navigation, and the hybrid controller, so a cropped 16:9 camera remains aligned at every canvas aspect ratio. A vendored on-device MediaPipe person-segmentation model creates a feathered foreground mask at a bounded rate: local preview and recordings redraw the presenter above the diagram, while the Meet overlay cuts the person out of the transmitted board layer so its camera compositor produces the same depth ordering. The feature is enabled by default and can be disabled under Appearance.

This browser flow is an audience-facing composite rather than an operating-system overlay. For the literal desktop experience, Airboard now also includes a native Electron shell in `apps/desktop`. It opens the same live board as a transparent, frameless, always-on-top window and passes mouse events through to arbitrary apps underneath.

## Native desktop overlay

Start the Airboard web surface and desktop shell in separate terminals:

```sh
pnpm dev:web
pnpm dev:desktop
```

The native overlay starts in broadcast-safe click-through mode on the display containing the pointer. Use the Airboard tray/menu-bar item to change displays or quit. `Cmd/Ctrl+Shift+O` temporarily turns pointer control on so you can enable hands or Airo, type a command, undo, or change the dark-overlay strength; **Return to click-through** removes the setup HUD and gives mouse focus back to the app underneath. `Cmd/Ctrl+Shift+H` shows or hides Airboard.

The desktop shell defaults to `http://127.0.0.1:3000`. Point it at a deployed Airboard web origin with `AIRBOARD_DESKTOP_URL=https://your-airboard-host pnpm dev:desktop`. The renderer bridge is sandboxed and exposes only overlay state, click-through, and hide operations.

## Meet camera overlay

Version 0.8.0 of the Meet extension removes the dedicated Airboard canvas from Meet. On meeting-code URLs the extension mounts a private 1280×720 engine offscreen, enables the neon overlay plus gesture-camera and Airo microphone inputs by default after affirmative media confirmation, and composites only the transparent diagram plane onto the outgoing Meet camera. If Meet already has a camera sender when setup finishes, Airboard upgrades that sender in place—no camera restart is required. Opening the legacy Meet add-on side panel closes it; opening an activity created by an older revision ends it. Settings, account controls, and six-step readiness diagnostics belong in the extension popup and standalone Airboard page rather than in the audience surface.

The main-world hook still tracks the composited output through `RTCRtpSender` and reads outbound WebRTC stats. A remote participant must confirm the receiver-side image; use the evidence checklist in [Docs/Meet Camera Composite Verification.md](Docs/Meet%20Camera%20Composite%20Verification.md).

## Realtime Voice

Airo now sends microphone audio to the Airboard API over a provider-neutral WebSocket instead of relying on Chrome's opaque speech-recognition model. The first provider adapter uses Deepgram Flux. Provider credentials remain in the API process, partial transcripts update the UI as speech arrives, and only a provider-finalized turn can reach the deterministic diagram-command parser.

Airboard supplies a focused vocabulary of complete phrases such as `Airo add a circle here` and `connect User to API`, rather than relying only on isolated words. If a finalized transcript is still unparsable, Airboard reports the rejection and the user simply repeats the command; it never silently executes a corrected guess.

For local use, start the API with a Deepgram key in its environment:

```sh
DEEPGRAM_API_KEY=your_key pnpm dev:api
```

Then run `pnpm dev:web` and open `http://localhost:3000`. The web app discovers voice availability through `GET /transcription/config`; if the key is missing, it clearly disables Airo while leaving typed commands available.

The model is selected per new voice session. Change the default and allowlist without changing frontend code:

```sh
AIRBOARD_TRANSCRIPTION_MODEL=flux-general-en \
AIRBOARD_TRANSCRIPTION_ALLOWED_MODELS=flux-general-en,flux-general-multi \
DEEPGRAM_API_KEY=your_key \
pnpm dev:api
```

The Intent Canvas sidebar also lets a tester switch among the server-approved models. A model switch closes the old stream safely and, when Airo is active, opens a fresh session automatically with the selected model. Chrome speech remains available only as an explicit development fallback by setting `NEXT_PUBLIC_AIRBOARD_SPEECH_FALLBACK=browser` before starting the web app.

The gateway rejects missing/unapproved browser origins and bounds concurrent streams, session duration, audio throughput, and queued audio. The default API bind is loopback-only. Production exposure still requires the product's authenticated user/session boundary in front of `/transcription/ws`; origin checks and rate limits are not a substitute for authentication.

## Semantic Command Interpretation

Airboard separates transcription from command understanding. Every typed command and finalized, wake-routed voice command first goes through the local deterministic diagram parser. Commands it already understands take the zero-network fast path, preserving the lowest latency.

Any explicitly activated, non-empty command that the deterministic parser cannot safely finish—or parses but cannot ground against the current board—is eligible for semantic planning. This includes acoustic fragments such as `add a q`, named edits, branching, incomplete phrases, ambiguous references, and narrative diagram requests. Activation failures, empty commands, and unsupported counts never reach the model.

The browser sends the transcript plus bounded graph context to `POST /intent/resolve`: visible labels, node types and spatial ordinals, selection state, geometry, directed edges, pointer availability, current-board vocabulary, and any pending clarification. Instance labels are never persisted as authoritative type aliases, and internal board IDs are never exposed to the model.

The graph, selection, and pointer are snapshotted when interpretation starts. If the board or selection changes before the model responds, Airboard rejects the stale plan and asks for the command again instead of grounding it against different objects. Clarifications are bound to that board snapshot, expire after two minutes, and are cleared with the board.

The OpenAI Responses adapter requires one strict `propose_diagram_plan` function call. Its versioned typed actions cover create, connect, labelled decision branches, rename, delete, duplicate, move, align, distribute, layout, group, select, undo, and cancel. References can target the current selection, pointer, visible label, node type plus ordinal, or a same-plan handle. Model output is validated against the shared contract and then grounded against a rolling shadow board. The model cannot mutate the board directly. A valid plan is applied immediately as one atomic, single-undo transaction — including multi-action and destructive plans (Undo reverts them). Invalid, unsafe, oversized, timed-out, or stale results fail closed.

Clarifications are conversational. For example, `connect the decision to user one and user two with yes and…` produces a focused question instead of guessing, and the next Airo turn completes the pending request.

The first server adapter uses the OpenAI Responses API. The default is `gpt-5.6-terra` with reasoning effort `none`, chosen to keep command interpretation capable while avoiding unnecessary reasoning latency. The default model and its allowlist are runtime configuration, so models can be evaluated without code changes. Intent Canvas also exposes a separate **Intent model** selector; changing it affects the next unclear command immediately and does not restart the microphone stream:

```sh
AIRBOARD_INTENT_PROVIDER=openai \
AIRBOARD_INTENT_MODEL=gpt-5.6-terra \
AIRBOARD_INTENT_ALLOWED_MODELS=gpt-5.6-terra,gpt-5.6-luna,gpt-5.4-mini \
AIRBOARD_INTENT_REASONING_EFFORT=none \
AIRBOARD_INTENT_TIMEOUT_MS=5000 \
AIRBOARD_INTENT_API_KEY=your_server_side_key \
pnpm dev:api
```

`AIRBOARD_INTENT_API_KEY` is preferred; `OPENAI_API_KEY` is accepted as a fallback. Both are API-process variables and must never use the `NEXT_PUBLIC_` prefix. `GET /intent/config` exposes only availability, provider, default model, and allowed models. `POST /intent/resolve` accepts an optional allowlisted model with the transcript and sanitized context; it never returns a credential. The API also enforces the configured origin allowlist, timeout, transcript bound, and concurrent-request limit.

Provider failures remain distinct from language-understanding failures. Quota, authentication, rate limits, model availability, timeouts, malformed output, and network failures use separate stable error codes. Successful calls return response/model IDs, OpenAI `x-request-id`, the supplied client request ID, provider processing time, total latency, and token usage. Airboard follows OpenAI's recommendation to retain request IDs for troubleshooting.

If no supported semantic provider/key is configured, `GET /intent/config` reports `available: false` and the client simply skips semantic fallback. Canonical typed commands and canonical Airo commands continue through the deterministic parser; only natural-language recovery is unavailable. Deepgram and OpenAI keys serve different roles: Deepgram enables realtime transcription, while the semantic key enables LLM-assisted interpretation of finalized text.

### Voice diagnostics and privacy

Every finalized command gets a `voiceTurnId` that links capture metadata, final STT text, wake classification, parser/grounding outcome, semantic input/output or failure, clarification, preview, final action, undo, and terminal outcome. Browser stages are appended with `POST /voice/trace`; a bounded local trace can be inspected with `GET /voice/trace/:voiceTurnId` using an allowed Origin header. Semantic server logs carry the same ID and provider request metadata.

Raw microphone audio is never stored or accepted by the trace API. Trace payloads are size/depth bounded and reject audio blobs, credentials, tokens, secrets, and passwords. The current prototype keeps only a bounded in-memory diagnostic buffer; production deployment still needs authenticated trace access, configurable transcript retention, encryption, deletion/export, and access auditing.

### Voice semantic evaluation

With the API running, replay the versioned regression corpus:

```sh
pnpm eval:voice
```

The corpus covers condition blocks, named rename, complete and truncated branches, a literal `No` clarification answer, `q`→queue repair, and a multi-node narrative. The runner forwards multi-turn clarification context, reports each typed plan, pass rate, and p50/p95 latency, and exits non-zero on regression. Use `pnpm eval:voice -- --help` for model, endpoint, case, and timeout options.

## Local Supabase Ports

Airboard uses a separate local Supabase port range so it can run beside other local projects:

- API: `http://127.0.0.1:56321`
- Postgres: `postgresql://postgres:postgres@127.0.0.1:56322/postgres`
- Studio: `http://127.0.0.1:56323`
- Mailpit: `http://127.0.0.1:56324`

The API uses Supabase persistence when `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are present. Without those variables, it falls back to the in-memory local store.

## Commercial platform

Airboard now includes the public acquisition site, Supabase-backed account and tenant bootstrap, invitation acceptance, three-day value-triggered trial, persistent/versioned boards, Stripe checkout/webhook/portal integration, organization administration, installation health, SAML/OIDC configuration, SCIM 2.0 provisioning, privacy requests, support intake, consent records, content-free product events, audit logs, request tracing and lifecycle jobs.

The implemented routes, data contract, environment variables, acceptance test and honest external launch gates are documented in [Commercial Platform Runbook](Docs/Commercial%20Platform%20Runbook.md). Run the complete local control-plane journey with a local API and Supabase stack using:

```sh
pnpm smoke:commercial
```
