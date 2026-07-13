# Voice Agent Architecture and Observability

## Runtime flow

1. Deepgram emits interim and finalized speech. Only finalized, wake-routed turns can become commands.
2. The deterministic parser handles clear single operations locally.
3. Parse failures and grounding failures call the semantic planner with a generated `voiceTurnId`.
4. The planner receives a bounded graph snapshot, project glossary, and pending clarification state.
5. OpenAI must call the strict `propose_diagram_plan` function once.
6. Airboard validates the typed plan, resolves references without exposing internal IDs, and applies it to a shadow board.
7. The user reviews one atomic preview. Multi-action or destructive changes require confirmation and remain undoable.

The capability registry in `packages/core/src/semanticCapabilities.ts` is the source for the palette, default labels, speech keyterms, deterministic aliases, and planner vocabulary. The typed contract and validator live in `packages/core/src/semanticPlan.ts`.

## Typed grounding

Plans can refer to:

- the current selection;
- the current pointer target;
- an exact visible label plus optional occurrence;
- a node type plus spatial ordinal, such as `user 2`;
- a handle created earlier in the same plan.

The model sees labels, node types, ordinals, selection state, geometry, existing directed edges, and current-board terminology. It never receives trusted board-object IDs. Instance labels remain distinct from type aliases. Branch actions expand into separate labelled connectors, and every action is validated against the rolling preview state captured for that request. A response is rejected if the board or selection changed while planning.

## Clarification

A clarification contains a direct question and at least one typed missing slot but no executable actions. Airboard keeps the previous transcript, question, and slots in memory and supplies them with the next Airo turn. Short answers such as “yes” and “no” are treated as literal slot values when the question requests a branch label. Clarification state is tied to the same board snapshot, expires after two minutes, and is cleared by a board change, Clear, explicit cancellation, or a complete deterministic command.

## Trace contract

One `voiceTurnId` correlates these append-only stages:

- `capture_metadata`
- `stt_final`
- `wake_classification`
- `parser_outcome`
- `semantic_request`
- `semantic_result` or `semantic_failure`
- `clarification`
- `preview`
- `action_applied`, `action_failed`, or `action_undone`
- `turn_completed`

The API adds `semantic.server.requested`, `semantic.server.completed`, and `semantic.server.failed`, including provider/model, bounded redacted input, typed output, OpenAI response/request IDs, client request ID, processing time, total latency, and usage.

Use an allowed Origin header to inspect a local trace:

```sh
curl -H 'Origin: http://localhost:3000' \
  http://127.0.0.1:4000/voice/trace/<voiceTurnId>
```

## Failure taxonomy

Provider failures are not presented as command misunderstanding:

- `SEMANTIC_INTENT_QUOTA_EXHAUSTED`
- `SEMANTIC_INTENT_RATE_LIMITED`
- `SEMANTIC_INTENT_PROVIDER_AUTH_FAILED`
- `SEMANTIC_INTENT_MODEL_UNAVAILABLE`
- `SEMANTIC_INTENT_TIMEOUT`
- `SEMANTIC_INTENT_INVALID_PROVIDER_OUTPUT`
- `SEMANTIC_INTENT_PROVIDER_UNAVAILABLE`

The server records errors with the logger's `err` field so stack/message data remains serializable. OpenAI `x-request-id` and the unique `X-Client-Request-Id` are preserved for support correlation.

## Privacy and retention

- Raw audio is not retained and is rejected by the trace protocol.
- Transcript and board context are bounded and may contain meeting-sensitive content.
- Credentials, authorization values, audio buffers, and secret/token fields are rejected or redacted.
- The local diagnostic buffer is limited by turns and events and disappears on restart.
- Production must add authentication/authorization, encrypted persistent storage where required, retention policy, deletion/export, and audit access before exposing trace retrieval.

## Verification

Run deterministic and contract tests:

```sh
node --test packages/core/test/*.test.mjs apps/api/test/*.test.mjs apps/web/test/*.test.mjs
```

Run live semantic evaluation after starting the API:

```sh
pnpm eval:voice
```

The v1 corpus is `evals/voice-intent/v1.json`. Add a case for every observed production failure and keep expected assertions semantic rather than tied to exact wording.
