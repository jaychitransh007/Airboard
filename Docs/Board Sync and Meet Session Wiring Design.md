# Board Sync and Meet Session Wiring — Design Plan

Status: **Design (not yet implemented).** This is the tier-5 item deferred from the fix
sequencing because it is net-new architecture, not a bug fix.

## Problem

Today the web app has **no board-sync path at all**, and the meeting surfaces cannot
collaborate:

- `BOARD_SESSION_ID = "local-standalone-board"` is a compile-time constant
  (`apps/web/src/features/board/AirboardPrototype.tsx`). The component's only prop is
  `{ surface }`; nothing reads a `boardSessionId` from the URL.
- `GoogleMeetAdapter.startMeetActivity` builds
  `.../meet/main-stage?boardSessionId=${boardSessionId}` and `.../side-panel?...`
  (`packages/integrations/src/googleMeetAdapter.ts`), but the page components render
  `<AirboardPrototype surface=… />` and never read that query param. The server-created
  `BoardSession` id from `POST /sessions/start` is discarded.
- `applyLocalEvent` only mutates `boardRef.current`; it never POSTs to the API nor
  subscribes to the WS stream. So every surface (standalone / main-stage / side-panel)
  is an independent in-memory board keyed to the same constant, and none of them sync.
- `packages/realtime-client` (`AirboardRealtimeClient`) is a declared dependency of the
  web app and `transpilePackages` includes it, but it is **never imported**.

Net effect: the meeting/collaboration premise — the product's core — is silently
non-functional. The server-side multiplayer work already done (WS authorization,
`appendEvents` atomic batch, broadcast hardening, owner-absence locking) has **no client
consumer yet**. This plan wires that consumer.

## Goals

1. Thread a real `boardSessionId` (and `participantId`) from the URL / session lifecycle
   into `AirboardPrototype`, replacing the constant.
2. Persist local mutations to the server and converge surfaces that share a
   `boardSessionId` via the authorized WS board-event stream.
3. Hydrate initial board state on mount from the server.
4. Degrade gracefully to today's local-only behavior when no session context exists
   (so standalone dev keeps working with zero backend).

## Non-goals (this pass)

- Presence cursors, participant avatars, or per-user color (a follow-up).
- Conflict-free merge / OT / CRDT. The existing event-sourced reducer with a
  server-assigned contiguous sequence is the ordering authority; last-writer-wins per
  stroke is acceptable for the current object model.
- Offline queue / optimistic-with-rollback beyond what is described below.

## Current server surface (already built)

- `POST /sessions/start` → `{ session, ownerParticipant }` (requires `x-airboard-user-id`).
- `POST /sessions/:sessionId/join` → `{ session, participant, state }`.
- `POST /sessions/:sessionId/heartbeat` → `{ session }`.
- `GET /sessions/:sessionId/state` → `{ session, state }`.
- `WS /ws?boardSessionId=…&participantId=…` — authorizes the connection and each event,
  appends via `store.appendEvents` (atomic, contiguous sequence), and broadcasts
  `{ type: "board.event", event }`. Rejections come back as `event.rejected` /
  `event.append_failed`.
- Board events are validated against a known-type set and the reducer ignores unknown
  types and non-finite point timestamps (tier 2).

## Design

### 1. Session context resolution (client)

Add a small `useBoardSession(surface)` hook that resolves, in order:

1. `boardSessionId` + `participantId` from the URL (`useSearchParams`). Meet surfaces
   already receive `boardSessionId`; add `participantId` to the adapter URLs, or have the
   surface call `POST /sessions/:id/join` on mount to obtain its own `participantId`.
2. For the standalone `/` surface with no params: call `POST /sessions/start` once
   (owner) to create a session, or fall back to **local-only mode** (no network) when the
   API is unreachable — preserving today's zero-backend dev experience.

The hook returns `{ mode: "local" | "synced", boardSessionId, participantId }`. Thread
`boardSessionId` into `AirboardPrototype` as a prop and use it for
`createInitialBoardState` and every `createEventEnvelope`/`createStroke` `boardId`,
replacing the `BOARD_SESSION_ID` constant (keep the constant only as the local-mode
fallback).

### 2. Outbound: persist local mutations

Introduce a `boardTransport` abstraction with two implementations:

- `LocalBoardTransport` — today's behavior: `applyLocalEvent` only.
- `SyncedBoardTransport` — wraps `AirboardRealtimeClient`:
  - `applyLocalEvent(event)` still updates `boardRef.current` immediately (optimistic),
    **and** calls `client.sendEvent(event)` (or a new `sendEvents(events)` for compound
    commands, see §5).
  - The server re-stamps `actorParticipantId` and assigns `sequence`, then broadcasts.

`applyLocalEvent` becomes: reduce locally for latency, then hand the event to the
transport. Because the reducer is idempotent-ish per stroke and the server echoes back
the sequenced event, the inbound handler (§3) must de-duplicate the echo (match on
`event.id`) so the actor doesn't double-apply.

### 3. Inbound: converge from the stream

- `client.onEvent(event)` → if `event.id` was locally originated and already applied,
  skip (dedupe set of recent local ids); otherwise `boardRef.current =
  applyBoardEvent(boardRef.current, event)` and re-render.
- Order by `event.sequence`; drop/queue out-of-order events against the current
  `state.lastSequence` (the server assigns contiguous sequences, so gaps mean a missed
  message → trigger a state re-hydrate rather than applying out of order).

### 4. Hydration on mount

On entering synced mode, `GET /sessions/:id/state` (or use the `state` returned by
`join`), set `boardRef.current` to the returned `BoardState`, record its `lastSequence`,
then connect the WS. Any events that arrive during hydration are buffered and applied
after, deduped by sequence. (Note: the Supabase `getState` pagination fix from tier 3 is
a prerequisite so hydration of a long session is not truncated.)

### 5. Compound commands as atomic batches

`applyLocalEvent` is currently called once per event, but diagram commands emit several
events (create-node = `stroke.started` + `stroke.committed`; move = N
`annotation_updated`). To use the server's atomic `appendEvents`:

- Add `AirboardRealtimeClient.sendEvents(events: BoardEvent[])` that sends
  `{ type: "board.events", events }` (the server already accepts this).
- Have the diagram-apply path collect a command's events and send them as one batch, so
  peers never see a connector before the node it binds to.

### 6. Prerequisite fixes in `realtime-client` (Low items from the audit)

Wiring the client requires fixing its known defects first:

- `scheduleReconnect` uses `window.setTimeout` → use `globalThis.setTimeout` (SSR/worker
  safety), add jitter, and allow an immediate first retry.
- `close()` cannot cancel a pending reconnect timer (and `connect()` resets
  `manuallyClosed`), so a closed client silently reconnects → store the timer handle and
  clear it in `close()`.
- Detach old socket listeners before reconnecting to avoid listener leaks.
- Surface `event.rejected` / `event.append_failed` frames to the UI (retry or toast).

### 7. Meet adapter completeness

- Thread the authenticated user id through `AdapterConfig` instead of the hard-coded
  `"local-owner"` (`googleMeetAdapter.ts`, `standaloneAdapter.ts`).
- Implement the participant listeners (currently no-op stubs) so Meet presence propagates,
  or explicitly mark the adapter as a stub until presence is in scope.

## Rollout / sequencing

1. `realtime-client` hardening (§6) + `sendEvents` (§5) — isolated, unit-testable.
2. `boardTransport` abstraction + `useBoardSession` hook with local-mode fallback (§1–§2)
   — no behavior change in standalone/local mode.
3. Inbound convergence + hydration (§3–§4) behind the synced-mode branch.
4. Meet page wrappers read `boardSessionId`/`participantId` and pass them down (§1, §7).
5. End-to-end: two browser tabs sharing a `boardSessionId` converge; Meet main-stage
   reflects side-panel edits.

## Testing

- `realtime-client`: reconnect cancellation, jitter bounds, listener cleanup, single vs.
  batch send, echo dedupe by event id (unit).
- Inbound convergence: out-of-order/gap detection triggers re-hydrate (unit against a
  fake transport).
- Integration: a WS harness (needed anyway to lock down the server authz/batch work) —
  two clients, one session, assert both reduce to the same `BoardState`; an unauthorized
  event is rejected; a compound command applies atomically on the peer.

## Risks

- Optimistic local apply + server echo requires disciplined de-dup; getting it wrong
  double-applies or drops the actor's own edits.
- The reducer is last-writer-wins per stroke; concurrent edits to the same object can
  clobber. Acceptable for v1 but should be called out to users (or gated to owner-edit).
- Hydration of very large boards depends on the Supabase pagination fix and, longer term,
  a `board_snapshots` compaction (table already exists in the migration).
