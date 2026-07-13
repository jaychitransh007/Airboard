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
