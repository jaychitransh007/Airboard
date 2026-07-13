# Intent Canvas Implementation Notes

## Summary

Intent Canvas replaces mid-air freehand drawing as Airboard's primary diagram workflow. A user states the intended board change, reviews a clean semantic preview, and explicitly commits it. Pointer and camera gestures remain useful for indicating *where* and *which object*, while object geometry is generated and maintained by the diagram command layer.

## Current Workflow

1. Type one command in the Intent Canvas field, or press **Start Airo** once and leave wake-word listening armed.
2. Press **Preview**. A valid command is resolved against the current pointer, focus, and selection, then every affected object is shown as a ghost. Destructive previews use red deletion marks.
3. For typed commands, press **Apply**, press Enter again, or close the hand anywhere on the canvas to commit the pending command. Wake-word commands are applied automatically and remain undoable.
4. Press **Cancel** or Escape to discard a pending preview. Use **Undo**, Cmd/Ctrl+Z, or the `undo` command to apply the command's compensating events.

Typed commands do not require a wake phrase. Airo's primary voice path captures mono microphone audio, converts it to 16 kHz PCM16 in 80 ms frames, and streams it through the Airboard API to the configured transcription adapter. The initial adapter uses Deepgram Flux with Airboard vocabulary supplied as keyterms. Partial transcripts update `Mic heard` in realtime; only a finalized end-of-turn transcript is allowed to enter the wake router and command pipeline. Ordinary conversation without **Airo** is never executed. Multiple wake commands are queued and applied in order.

The keyterm context includes complete high-value command phrases, not only object nouns. The deterministic parser remains the first command stage. When it recognizes a command, the command follows the existing local preview/apply path without an LLM request. Any explicitly activated, non-empty parser failure can use semantic planning, except activation failures, empty commands, and unsupported counts. This covers acoustic fragments such as `add a q`, incomplete syntax, ambiguous node vocabulary, and narrative multi-object descriptions. A small audited acoustic-alias recovery remains a non-destructive final fallback; unrestricted fuzzy matching is deliberately avoided.

The API exposes only an allowlisted provider/model configuration, and provider credentials never enter the browser. The sidebar shows the actual provider and model and can select another allowed model without a code change. Providers cannot change the model inside an already-open stream, so changing the dropdown closes the old session safely and, when Airo is active, automatically opens a fresh session using the selected model. Chrome Speech Recognition is retained only as an explicitly configured development fallback, not a silent fallback.

## Semantic Intent Fallback

Semantic interpretation is provider-neutral at the browser/API contract. The implemented adapter currently uses the OpenAI Responses API with strict structured output. Its default model is `gpt-5.6-terra` with reasoning effort `none`; the default allowlist is `gpt-5.6-terra`, `gpt-5.6-luna`, and `gpt-5.4-mini`. Set `AIRBOARD_INTENT_MODEL` to an allowlisted value to choose the server default, or use the separate **Intent model** selector in Intent Canvas to switch per request. Model choice does not require restarting an Airo transcription stream, although API environment changes require restarting the API process.

The fallback receives the transcript plus bounded, sanitized board context: selected and visible labels/types, selection count, and pointer availability. It does not receive board object IDs or coordinates. Its Airboard capability catalog is shared with the deterministic node vocabulary and describes supported node types, operations, canonical grammar, and connector nomenclature. Existing board labels provide project-specific terminology. It must return exactly one of:

- `resolved` with an ordered plan of one to twelve canonical commands;
- `clarification` with an ambiguity, missing-context, unsafe-combination, or oversized-plan issue; or
- `unsupported` for non-board or unavailable operations.

The LLM is a planner, not an executor. Its output cannot create arbitrary command objects or mutate state. The browser reparses every step with the deterministic grammar, applies each resolved step to a shadow board, and discards the entire plan if any step fails. Later steps can therefore reference named nodes created earlier without partially changing the real board. A valid plan becomes one preview, one explicit commit, and one undo transaction. Multi-step plans initially allow additive create/connect operations only. Invalid JSON, invalid schema, an unapproved model, provider failure, timeout, or a superseded response produces no board change.

The API exposes `GET /intent/config` for the non-secret public configuration and `POST /intent/resolve` for interpretation. The resolve route is origin-restricted and applies the configured request timeout, transcript length, model allowlist, and concurrency limit. Configure the server with `AIRBOARD_INTENT_API_KEY` or the fallback `OPENAI_API_KEY`; never expose either through a `NEXT_PUBLIC_` variable. `OPENAI_RESPONSES_URL` can point the adapter at a compatible endpoint. If the provider or key is absent, config reports the feature unavailable, the client skips the network fallback, and deterministic commands continue to work.

## Supported Commands

- Create 1–20 process, service, database, queue, user, API, decision, note, circle, or component nodes. Placement can be `here`, on the left/right of the canvas, or left/right/above/below the current focus or selection. Labels can be introduced with `named`, `called`, or `labeled`.
- Connect selected/focused nodes with `connect this to that`, or use visible labels directly, such as `connect User with API` and `connect database to payment share`. Ambiguous or missing names produce clarification instead of guessing. An optional connector label can follow `as` or `with label`.
- Rename, delete, duplicate, or move the current selection.
- Align two or more selected objects by edge or shared horizontal/vertical axis.
- Distribute three or more selected objects horizontally or vertically.
- Arrange two or more selected objects left-to-right, right-to-left, top-to-bottom, bottom-to-top, or in a grid.
- Undo the last committed local change or cancel the pending command.

Examples:

- `Add an API named Orders here`
- `Add a circle here`
- `Add a database on the right`
- `Connect this to that as writes`
- `Connect User with API`
- `Move selected left`
- `Align selected horizontally`
- `Distribute selected vertically`
- `Arrange selected in a grid`

Shift-click adds objects to a multi-selection. Deictic commands such as `this` and `that` resolve from the primary selection, hovered target, and remaining selected objects; the UI asks for a usable selection when those references cannot be resolved safely.
Semantic placement is clamped to the unobstructed diagram region so nodes do not appear under the command panel or object dock. Double-click a labeled object to edit its label directly; ordinary selection and dragging do not open the editor.

## Gesture and Geometry Behavior

- Hand movement is mapped from a compact camera control zone to an area cursor that can acquire nearby object targets.
- Hover smoothing and sticky target acquisition reduce focus changes caused by tracking jitter.
- Closed-hand grab detection combines curl evidence from all four fingers instead of relying on a fragile thumb/index pinch.
- When a dock object is selected, closing the hand starts placement even though the translucent preview has not been committed to the board yet. Move the closed hand to position it and open the hand to create it. Arrows and connectors use the close and open positions as their endpoints.
- Once a fist is confirmed, the focused target remains latched and movement switches to responsive relative dragging. Reopening the hand drops it. A short tracking dropout freezes movement; a longer loss cancels the grab rather than allowing an object jump.
- The Hand confidence control is applied to the active hybrid controller, and Pause suppresses camera-driven commits and movement.
- Nodes and line/connector midpoints are hand-acquirable targets.
- Pointer and closed-hand dragging use object/grid snapping and display alignment guides.
- The status panel reports detected hands, tracking confidence, grab strength, the actually focused/grabbed target, placement state, and an actionable setup hint. A closed hand with no real target reports `no target` instead of claiming that an object was grabbed.
- Connectors remain bound to node anchors when nodes move or resize. Orthogonal connector routing and hit testing follow the rendered route.

## Browser and Hardware Limits

- Typed commands are the deterministic fallback and should be used for automated or cross-browser validation.
- Realtime voice requires the Airboard API, a configured provider key, WebSocket connectivity, microphone permission, and a browser with `getUserMedia`, WebSocket, and Web Audio support. If any requirement is missing, the interface reports the failure and leaves typed commands available.
- Model selection is provider-neutral at the browser/API boundary, but the implemented provider adapter is currently Deepgram Flux. Adding another provider requires a server adapter, not changes to the board component or audio protocol.
- Semantic command interpretation is a separate provider-neutral request path. Its implemented adapter currently uses the OpenAI Responses API. Without its server-side key, deterministic commands still work but disfluent or natural-language commands that need normalization do not.
- Airo currently uses keyterm-boosted streaming transcription as its wake boundary; it is not a local, on-device wake-word model. Audio is streamed only after the user presses **Start Airo**, and final transcripts still must contain the wake phrase before a command can execute.
- Recognition latency varies with end-of-turn detection, network conditions, and provider response time. The client uses bounded 80 ms frames and drops stale queued audio to preserve interactivity, but sub-second completion is a measurement target rather than a universal guarantee.
- Both browser-to-API and API-to-provider queues are capped at roughly one second of PCM audio. The gateway also applies origin, concurrency, session-duration, and audio-rate limits. Production deployment still needs authenticated access to the paid transcription route.
- Hand control requires camera permission, a browser that supports `getUserMedia`, suitable lighting, and reliable MediaPipe hand landmarks. Camera automation is not a substitute for testing with the target webcam and physical setup.
- The implementation improves object manipulation precision, but it does not make freehand handwriting in air a supported precision workflow.
- Meeting-platform embedding and mobile/phone-as-precision-surface input remain outside this slice.

## Manual Test Path

1. Start the API with `DEEPGRAM_API_KEY` and either `AIRBOARD_INTENT_API_KEY` or `OPENAI_API_KEY` set, start the web app, and leave **Input Mode** on **Intent Canvas**. Confirm Status shows the expected voice engine/model rather than `not configured`.
2. Type `Add a user on the left` and `Add an API on the right`, applying each preview.
3. With nothing specially selected, preview/apply `Connect user with API` and confirm a bound arrow appears.
4. Repeat with `Connect database to payment share` using those visible labels.
5. Type `Add a circle here` and confirm the result is an actual ellipse rather than a rectangular node.
6. Multi-select objects and test rename, move, align, distribute, layout, delete, and duplicate commands.
7. Undo each change and confirm the previous geometry, labels, selection, and connector bindings are restored.
8. Enable hands, choose **Flow** from the dock, and confirm the translucent preview does not increase `Board > Visible strokes`. Close all four fingers, move the fist, and reopen it. Confirm `Object control` changes to `placing`, the preview follows the hand, and opening commits one visible object.
9. With **Select** active, keep one open hand fully visible, move the area cursor over that committed object, close all four fingers briefly, move the fist, and reopen it. Confirm grab strength rises, a target stays latched, and the object follows responsively. Closing over empty space must report `no target`.
10. Press **Start Airo** once, allow microphone access, then say `Airo, add a circle`, `Airo, add a user`, and `Airo, connect User to API`. Confirm partial words appear while speaking and each finalized command mutates the board exactly once. Confirm ordinary speech without a wake phrase is shown as `wake word not detected` and does not alter the board.
11. Say `Airo, add a q` and confirm it becomes one Queue. Then say `Airo, create a diagram where a user, uh, makes an API request and the data is updated to the API`. Confirm a five-step User → API → Data Store plan appears as one preview and does not change **Visible strokes** until you press Apply or say `Airo, confirm`. Apply it, then press Undo once and confirm the entire plan is undone.
12. While Airo is active, choose another allowed **Voice model**. Confirm the old transcription session stops, a fresh session starts automatically, and the UI reports the selected speech model as active. Then change **Intent model** and confirm the next disfluent command uses it without reconnecting Airo. Separately change `AIRBOARD_INTENT_MODEL` to another value in `AIRBOARD_INTENT_ALLOWED_MODELS`, restart the API, and confirm `GET /intent/config` reports the new server default.
13. Remove only the semantic provider key and restart/reload. Confirm canonical typed and Airo commands still work through the deterministic parser while disfluent commands fail safely without mutation. Then stop the API or remove the Deepgram key and reload; confirm Airo transcription is disabled with an actionable message while typed commands remain available.

## Validation

Run from the repository root:

- `CI=true pnpm test`
- `CI=true pnpm typecheck`
- `CI=true pnpm build`

The package-level tests cover semantic command planning and undo, named-reference parsing, deterministic-fast-path and semantic-fallback routing, strict semantic output validation, provider/config failure behavior, wake-word routing, realtime audio framing and cleanup, transcription protocol validation, Flux event translation and final-turn deduplication, true circle creation, connector geometry/hit testing, multi-finger grab estimation, sticky target acquisition, relative dragging, and tracking-loss behavior. The production builds validate integration across the workspace packages.
