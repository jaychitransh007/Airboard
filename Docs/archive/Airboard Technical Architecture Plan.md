# Airboard Technical Architecture Plan

## 1. Objective

Build Airboard as a meeting-native gesture whiteboard where a logged-in owner starts a board session and participants in the same Google Meet can collaborate while the owner keeps the canvas active.

The MVP must prove the core interaction first:

- Right hand marker gesture writes.
- Left hand duster gesture erases.
- Local drawing feels very low latency.
- Strokes are smoothed and lightly predicted.
- Board state syncs to participants in real time.
- Google Meet is implemented as an adapter, not as core architecture.

## 2. Key Product Decisions

### 2.1 Owner and Participant Model

- The owner is the logged-in user who starts an Airboard session.
- The owner must have an active entitlement to start a board.
- For local development, entitlement is mocked through local Supabase data.
- Meeting participants can join as guests while the owner's canvas is active.
- Guests do not need paid accounts for MVP participation.
- Guests can draw if the owner allows participant drawing.
- If the owner ends the board, guest participation ends.
- If the owner disconnects unexpectedly, keep the session alive for a short grace period before locking it.

Recommended owner disconnect grace period:

- `ownerGracePeriodSeconds = 180`

### 2.2 Local-First Development

Use local Supabase before any hosted subscription or free trial:

- Supabase CLI local stack for Auth, Postgres, Storage, and local Studio.
- Local Docker Compose for Redis if needed.
- Local API/WebSocket server for Airboard-specific realtime collaboration.
- Local web app served over localhost for standalone testing.
- Later, use a public HTTPS tunnel only when testing Google Meet add-on iframe behavior.

### 2.3 Realtime Sync Direction

Use Airboard's own WebSocket event sync for MVP instead of relying on Google Meet Co-Doing APIs.

Reasons:

- Board events are high-frequency.
- We need the same realtime behavior in standalone mode and Google Meet mode.
- The core collaboration engine should not depend on Meet APIs.
- Google Meet should only pass launch/session context.

## 3. Recommended Stack

### 3.1 Frontend

- React + Next.js + TypeScript.
- Canvas API for low-latency drawing.
- Optional SVG overlay only for UI cursors and debugging.
- Zustand for local UI/session state.
- Pure reducers in `packages/core` for board state.
- MediaPipe Tasks Vision for hand landmarks.
- Web Worker for gesture processing if main-thread blocking is visible.

### 3.2 Backend

- Node.js + Fastify.
- Native WebSocket or Socket.IO.
- Supabase local Postgres for sessions, events, users, entitlements, and snapshots.
- Supabase local Storage for exported PNGs.
- Redis local container for room presence/pubsub if one API instance is not enough.

### 3.3 Local Infrastructure

- Supabase CLI local stack.
- Optional Redis via Docker Compose.
- No hosted Supabase required for initial development.
- No Stripe subscription required for local development; use mock entitlement rows.

### 3.4 Future Hosted Infrastructure

When ready to test externally:

- Frontend: Vercel.
- API/WebSocket: Fly.io, Railway, or Render.
- Database/Auth/Storage: hosted Supabase.
- Redis: Upstash, Railway Redis, or Fly Redis-compatible deployment.
- Payments: Stripe.

## 4. Proposed Repository Structure

```text
apps/
  web/
    app/
      board/
      meet/
        side-panel/
        main-stage/
      onboarding/
    src/
      components/
      features/
      adapters/
  api/
    src/
      http/
      websocket/
      sessions/
      boards/
      auth/
      entitlement/
      analytics/

packages/
  core/
    src/
      board/
      events/
      permissions/
      session/
      types/
  drawing-engine/
    src/
      canvas/
      stroke-renderer/
      eraser/
      export/
  gesture-engine/
    src/
      mediapipe/
      classifier/
      smoothing/
      calibration/
      prediction/
      workers/
  realtime-client/
    src/
      transport/
      reconciliation/
      presence/
  integrations/
    standalone/
    google-meet/

supabase/
  migrations/
  seed.sql

infra/
  docker-compose.yml

docs/
```

Note: the existing folder is `Docs/`; implementation docs can either stay there or use lowercase `docs/` after repo initialization. Keep one convention once the app is scaffolded.

## 5. Architecture

```mermaid
flowchart TD
  User["Owner or Participant"] --> Web["Airboard Web App"]
  Web --> Adapter["Integration Adapter Layer"]
  Adapter --> Standalone["Standalone Adapter"]
  Adapter --> Meet["Google Meet Adapter"]

  Web --> Gesture["Gesture Engine"]
  Web --> Drawing["Drawing Engine"]
  Web --> RealtimeClient["Realtime Client"]
  Web --> Core["Core Board State"]

  Gesture --> Core
  Drawing --> Core
  RealtimeClient --> Core

  RealtimeClient <--> API["Fastify API and WebSocket Server"]
  API --> SupabaseAuth["Local Supabase Auth"]
  API --> Postgres["Local Supabase Postgres"]
  API --> Storage["Local Supabase Storage"]
  API --> Redis["Local Redis Optional"]

  Meet -. "SDK only inside adapter" .-> Adapter
```

## 6. Hard Architecture Rules

- `packages/core` must not import Google Meet SDKs.
- `packages/gesture-engine` must not import Google Meet SDKs.
- `packages/drawing-engine` must not import Google Meet SDKs.
- `packages/realtime-client` must not import Google Meet SDKs.
- Google Meet-specific logic must live under `packages/integrations/google-meet` or route-level Meet wrappers.
- Board state must be reproducible from persisted events plus snapshots.
- Webcam frames must never be sent to the backend in MVP.
- Local strokes render before server acknowledgement.

## 7. Core Domain Model

### 7.1 Session

```ts
type BoardSession = {
  id: string;
  ownerUserId: string;
  provider: 'standalone' | 'google_meet';
  providerMeetingId?: string;
  title?: string;
  status: 'active' | 'owner_disconnected' | 'locked' | 'ended';
  allowParticipantDrawing: boolean;
  ownerLastSeenAt: string;
  expiresAt: string;
  createdAt: string;
  updatedAt: string;
};
```

### 7.2 Participant

```ts
type Participant = {
  id: string;
  boardSessionId: string;
  userId?: string;
  guestId?: string;
  displayName: string;
  role: 'owner' | 'editor' | 'viewer';
  inputEnabled: boolean;
  connectedAt: string;
  lastSeenAt: string;
};
```

### 7.3 Stroke

```ts
type Stroke = {
  id: string;
  boardId: string;
  userId: string;
  tool: 'marker';
  color: string;
  thickness: number;
  points: StrokePoint[];
  createdAt: string;
  updatedAt: string;
  status: 'active' | 'committed' | 'deleted';
};

type StrokePoint = {
  x: number;
  y: number;
  t: number;
  pressure?: number;
  confidence?: number;
};
```

### 7.4 Erase Action

```ts
type EraseAction = {
  id: string;
  boardId: string;
  userId: string;
  eraserPath: StrokePoint[];
  radius: number;
  affectedStrokeIds: string[];
  createdAt: string;
};
```

## 8. Database Plan

Use local Supabase migrations for all schema.

### 8.1 Tables

#### `profiles`

- `id uuid primary key`
- `email text`
- `display_name text`
- `created_at timestamptz`

#### `entitlements`

- `id uuid primary key`
- `user_id uuid references profiles(id)`
- `plan text`
- `status text`
- `source text`
- `valid_until timestamptz`
- `created_at timestamptz`

Local development seed:

```sql
insert into entitlements (user_id, plan, status, source, valid_until)
values ('LOCAL_OWNER_USER_ID', 'dev_pro', 'active', 'local_seed', now() + interval '1 year');
```

#### `board_sessions`

- `id uuid primary key`
- `owner_user_id uuid references profiles(id)`
- `provider text`
- `provider_meeting_id text null`
- `title text null`
- `status text`
- `allow_participant_drawing boolean`
- `owner_last_seen_at timestamptz`
- `expires_at timestamptz`
- `created_at timestamptz`
- `updated_at timestamptz`

#### `participants`

- `id uuid primary key`
- `board_session_id uuid references board_sessions(id)`
- `user_id uuid null`
- `guest_id text null`
- `display_name text`
- `role text`
- `input_enabled boolean`
- `connected_at timestamptz`
- `last_seen_at timestamptz`

#### `board_events`

- `id uuid primary key`
- `board_session_id uuid references board_sessions(id)`
- `sequence bigint`
- `actor_participant_id uuid references participants(id)`
- `event_type text`
- `payload jsonb`
- `created_at timestamptz`

Indexes:

- `(board_session_id, sequence)`
- `(board_session_id, created_at)`

#### `board_snapshots`

- `id uuid primary key`
- `board_session_id uuid references board_sessions(id)`
- `last_sequence bigint`
- `state jsonb`
- `created_at timestamptz`

#### `exports`

- `id uuid primary key`
- `board_session_id uuid references board_sessions(id)`
- `requested_by_participant_id uuid references participants(id)`
- `storage_path text`
- `format text`
- `created_at timestamptz`

#### `analytics_events`

- `id uuid primary key`
- `board_session_id uuid null`
- `participant_id uuid null`
- `event_name text`
- `payload jsonb`
- `created_at timestamptz`

## 9. Local Supabase Setup Plan

### 9.1 Required Local Commands

```bash
supabase init
supabase start
supabase migration new initial_airboard_schema
supabase db reset
```

### 9.2 Local Environment Variables

```bash
NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:56321
NEXT_PUBLIC_SUPABASE_ANON_KEY=<local anon key>
SUPABASE_SERVICE_ROLE_KEY=<local service role key>
DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:56322/postgres
AIRBOARD_WS_URL=ws://localhost:4000/ws
AIRBOARD_OWNER_GRACE_SECONDS=180
AIRBOARD_LOCAL_ENTITLEMENTS=true
```

### 9.3 Local Seed Strategy

Create:

- one local owner user
- one active local entitlement
- one expired local entitlement for negative tests
- sample standalone board session
- optional sample board events

### 9.4 Local Auth Strategy

For the first implementation:

- Use Supabase email/password auth locally.
- Seed a known test owner.
- Allow guest participants through signed session join tokens.

Later:

- Add Google OAuth for production owner login.
- Add Stripe entitlement sync.

## 10. Authentication and Entitlement Flow

### 10.1 Start Board

```mermaid
sequenceDiagram
  participant Owner
  participant Web
  participant API
  participant Supabase

  Owner->>Web: Click Start Airboard
  Web->>API: POST /sessions/start
  API->>Supabase: Verify owner auth
  API->>Supabase: Check active entitlement
  Supabase-->>API: Entitlement active
  API->>Supabase: Create board session
  API-->>Web: boardSessionId + join token
  Web->>API: Open WebSocket room
```

### 10.2 Join Board as Meet Participant

```mermaid
sequenceDiagram
  participant Guest
  participant MeetAdapter
  participant API
  participant Supabase

  Guest->>MeetAdapter: Join Airboard activity
  MeetAdapter->>API: POST /sessions/:id/join
  API->>Supabase: Check session active and owner present
  API->>Supabase: Create guest participant
  API-->>MeetAdapter: participant token
  MeetAdapter->>API: Open WebSocket room
```

### 10.3 Owner Presence Rule

- Owner sends heartbeat over WebSocket.
- API updates `owner_last_seen_at`.
- If heartbeat is stale, session moves to `owner_disconnected`.
- Guests can keep viewing during grace period.
- Guest drawing is disabled after grace period.
- Session moves to `locked` if owner does not return.

## 11. Gesture Engine Plan

### 11.1 Pipeline

```text
webcam frame
-> MediaPipe Hand Landmarker
-> handedness normalization
-> gesture classifier
-> confidence gate
-> activation duration gate
-> coordinate mapper
-> dead-zone filter
-> One Euro Filter
-> velocity estimate
-> prediction
-> gesture event
```

### 11.2 Default Thresholds

```ts
const gestureDefaults = {
  markerGestureConfidenceThreshold: 0.75,
  dusterGestureConfidenceThreshold: 0.75,
  activationDurationMs: 150,
  minTrackingConfidence: 0.6,
  predictionWindowMs: 20,
};
```

### 11.3 Marker Gesture

Initial heuristic:

- right hand
- thumb and index are close enough
- index direction is stable
- middle/ring/pinky are curled or semi-curled
- palm orientation is plausible
- cursor is inside drawable area

### 11.4 Duster Gesture

Initial heuristic:

- left hand
- closed fist or semi-closed fist
- stable for activation duration
- confidence above threshold

Duster has priority over marker if both are active.

### 11.5 Smoothing and Prediction

Use:

- confidence filter
- dead-zone filter
- One Euro Filter
- velocity estimate
- small prediction window

Disable prediction when:

- confidence is low
- direction changes sharply
- hand is nearly stationary
- gesture just activated
- gesture just deactivated

### 11.6 Performance Targets

- Gesture processing: 24-30 FPS minimum.
- Canvas rendering: 60 FPS target.
- Local perceived drawing latency: under 80 ms.
- Ideal local drawing latency: 50 ms or lower on modern laptops.

## 12. Drawing Engine Plan

### 12.1 Rendering

- Use Canvas API.
- Keep vector state in memory.
- Render committed strokes to an offscreen/static canvas layer.
- Render active local stroke, cursors, and eraser preview on a dynamic overlay layer.
- Repaint only dirty regions where practical.

### 12.2 Erasing

MVP:

- stroke-level erasing
- if eraser path intersects stroke, mark stroke as deleted
- emit `StrokeDeleted` and `EraseCommitted`

Later:

- segment-level erasing that splits strokes into remaining segments

### 12.3 Export

- Export current board as PNG from composed canvas.
- Store export in local Supabase Storage.
- Save export metadata in `exports`.

## 13. Realtime Collaboration Plan

### 13.1 Event Types

```ts
type BoardEvent =
  | StrokeStarted
  | StrokePointAdded
  | StrokeCommitted
  | EraseStarted
  | EraseMoved
  | EraseCommitted
  | StrokeDeleted
  | UndoRequested
  | RedoRequested
  | BoardCleared
  | CursorMoved
  | ParticipantJoined
  | ParticipantLeft
  | OwnerPresenceChanged
  | PermissionChanged;
```

### 13.2 Event Flow

```text
local gesture
-> local render immediately
-> local board event appended optimistically
-> WebSocket send
-> API validates permission/session state
-> API assigns sequence
-> API persists event
-> API broadcasts event
-> clients reconcile by sequence
```

### 13.3 Persistence Strategy

- Store all committed board events.
- Store cursor events only in memory unless diagnostics are enabled.
- Create board snapshot every N events or every M seconds.
- On reload, load latest snapshot and replay later events.

Recommended initial values:

- `snapshotEveryEvents = 100`
- `snapshotEverySeconds = 30`

## 14. Integration Adapter Layer

### 14.1 Adapter Interface

```ts
interface MeetingAdapter {
  provider: 'google_meet' | 'standalone' | 'zoom' | 'teams' | 'chrome_overlay';

  initialize(config: AdapterConfig): Promise<void>;
  getMeetingContext(): Promise<MeetingContext>;
  getCurrentUser(): Promise<MeetingUser>;
  getParticipants(): Promise<MeetingParticipant[]>;
  startBoardSession(input: StartBoardSessionInput): Promise<BoardSession>;
  joinBoardSession(sessionId: string): Promise<BoardSession>;
  inviteParticipants(sessionId: string): Promise<void>;
  onParticipantJoined(callback: (participant: MeetingParticipant) => void): void;
  onParticipantLeft(callback: (participant: MeetingParticipant) => void): void;
  onMeetingEnded(callback: () => void): void;
  getCapabilities(): AdapterCapabilities;
  dispose(): Promise<void>;
}
```

### 14.2 Standalone Adapter

Responsibilities:

- create board without meeting context
- create owner session from logged-in user
- create guest link
- support local development and Phase 0/1 validation

### 14.3 Google Meet Adapter

Responsibilities:

- initialize Meet add-on session
- provide side panel and main stage flows
- start activity with `boardSessionId`
- retrieve activity starting state on join
- map Meet participant context where available
- pass normalized context to Airboard core

Non-responsibilities:

- gesture recognition
- drawing engine
- board state reducer
- persistence
- billing entitlement logic

## 15. Google Meet Add-On Plan

### 15.1 Side Panel

Controls:

- Start Airboard
- Join ongoing Airboard
- Board name
- Participant list
- Allow participants to draw toggle
- Export
- End board
- Camera/gesture troubleshooting link

### 15.2 Main Stage

Controls:

- full board canvas
- tiny participant cursors
- gesture status indicator
- calibration overlay
- pause input button
- minimal bottom control strip

### 15.3 Meet Activity Start

```text
GoogleMeetAdapter.startBoardSession()
-> API creates Airboard board session
-> API validates owner entitlement
-> Adapter stores providerMeetingId when available
-> Adapter starts Meet collaborative activity
-> Adapter passes boardSessionId in activity starting state
-> Meet opens main stage URL
```

### 15.4 Meet Activity Join

```text
GoogleMeetAdapter.joinBoardSession()
-> reads boardSessionId from activity starting state
-> creates guest identity or maps logged-in identity
-> joins realtime board room
-> loads current board state
```

## 16. UX Plan

### 16.1 First-Time Owner Flow

```text
Sign in locally
-> entitlement check
-> Start Airboard
-> grant camera permission
-> choose dominant writing hand, default right
-> marker gesture calibration
-> duster gesture calibration
-> test drawing
-> enter board
```

### 16.2 Participant Flow

```text
Join Airboard activity
-> view board
-> optional enable gestures
-> camera permission
-> calibration
-> collaborate if owner allows drawing
```

### 16.3 Safety Controls

- Always visible pause/resume input button.
- Spacebar toggles pause/resume.
- Esc stops active gesture.
- Low-confidence warning.
- Camera permission warning.
- Owner disconnected/locked state warning.

## 17. Analytics Plan

Track locally first by writing to `analytics_events`.

Events:

- `board_started`
- `board_joined`
- `camera_permission_granted`
- `camera_permission_denied`
- `calibration_completed`
- `marker_gesture_detected`
- `duster_gesture_detected`
- `stroke_started`
- `stroke_committed`
- `erase_committed`
- `undo_used`
- `export_used`
- `participant_collaborated`
- `board_duration`
- `gesture_confidence_low`
- `owner_disconnected`
- `session_locked`

Core metrics:

- time to first stroke
- average local gesture confidence
- stroke abandonment rate
- accidental stroke undo rate
- average board session duration
- percent of sessions with collaborator drawing
- export/save rate
- local draw latency estimate
- remote sync latency estimate

## 18. Implementation Phases

### Phase 0: Local Technical Spike

Goal: prove hand writing and erasing quality before Meet integration.

Build:

- standalone Next.js page
- local webcam input
- MediaPipe Hand Landmarker
- right-hand marker gesture
- left-hand duster gesture
- canvas drawing
- One Euro smoothing
- small prediction window
- basic stroke-level erase
- latency/debug overlay

Exit criteria:

- user can draw box-arrow-box with right hand
- user can erase with left hand
- local drawing feels under 80 ms perceived latency
- no obvious smoothing lag or jitter problem

### Phase 1: Local Board Product

Build:

- vector board model
- undo
- clear board
- export PNG
- local Supabase schema
- local owner auth
- local entitlement seed
- session creation
- session reload

Exit criteria:

- logged-in entitled owner can start a standalone board
- board state persists across reload
- export PNG works locally

### Phase 2: Local Realtime Collaboration

Build:

- Fastify API
- WebSocket room server
- board event sequencing
- participant presence
- participant cursors
- guest join token
- owner presence heartbeat
- owner disconnect grace period

Exit criteria:

- two local browser windows can join same board
- owner and guest can draw together
- guest drawing stops when owner ends session
- guest drawing locks after owner grace period

### Phase 3: Adapter Layer

Build:

- `MeetingAdapter` interface
- `StandaloneWebAdapter`
- adapter capabilities
- core import boundary tests
- route-level adapter selection

Exit criteria:

- standalone app uses adapter interface
- core packages have no Meet imports
- tests fail if Google Meet SDK leaks into core

### Phase 4: Google Meet Add-On MVP

Build:

- Meet add-on manifest
- side panel route
- main stage route
- Google Meet adapter
- activity starting state with `boardSessionId`
- participant join through board session
- HTTPS/tunnel setup for local Meet testing

Exit criteria:

- owner can launch Airboard from Meet
- Airboard opens in main stage
- participants can join same board
- board collaboration uses Airboard WebSocket backend

### Phase 5: Quality and Beta Hardening

Build:

- gesture confidence dashboard
- calibration improvements
- low-light/low-confidence warning tuning
- better eraser feedback
- undo/redo polish
- production entitlement integration
- Stripe subscription integration
- hosted Supabase migration

Exit criteria:

- first-time user can draw a simple flow in under 60 seconds
- 90%+ of strokes start only when intended in beta tests
- stable 5-minute use in real meetings
- participants see remote strokes under 300 ms in typical conditions

## 19. Testing Strategy

### 19.1 Unit Tests

- board event reducer
- undo/redo behavior
- stroke-level erase intersection
- permission checks
- entitlement checks
- owner presence state machine
- gesture classifier heuristics
- One Euro Filter behavior

### 19.2 Integration Tests

- start session with active entitlement
- reject session start without entitlement
- guest join while owner active
- guest lock after owner grace period
- event sequence persistence
- snapshot + replay restore
- export metadata save

### 19.3 Browser Tests

- standalone board renders
- canvas export works
- pause/resume works
- keyboard controls work
- two tabs sync board events
- camera permission error state renders

### 19.4 Manual Gesture QA

Run on Chrome desktop:

- good lighting
- poor lighting
- fast hand movement
- stationary hand
- accidental open-palm talking
- both hands visible
- owner using Meet camera at same time

## 20. Security and Privacy

### 20.1 Privacy

- Do not send webcam frames to backend.
- Process hand tracking in browser.
- Store only drawing events and optional gesture diagnostics.
- Keep diagnostics anonymized where possible.

### 20.2 Session Security

- Use unguessable session IDs.
- Use signed guest join tokens.
- Expire meeting-linked boards by default.
- Require owner/editor permission for export.
- Require active owner entitlement to start sessions.

### 20.3 Local Development Security

- Local Supabase keys are for development only.
- Do not commit production secrets.
- Keep `.env.local` untracked.

## 21. Initial Local Development Checklist

1. Initialize repository and package manager.
2. Scaffold `apps/web`, `apps/api`, and shared packages.
3. Add local Supabase config.
4. Create initial migrations.
5. Seed local owner and entitlement.
6. Build standalone camera + canvas spike.
7. Add gesture classifier and smoothing.
8. Add local board model and export.
9. Add WebSocket sync.
10. Add owner/guest session lifecycle.
11. Add adapter interface.
12. Add Google Meet adapter and add-on routes.

## 22. Open Decisions

- Which package manager: `pnpm` is recommended.
- Which WebSocket library: native `ws` is enough; Socket.IO is acceptable if reconnection ergonomics matter more.
- Whether to use Supabase Auth UI or custom auth screens for local MVP.
- Whether Redis is needed immediately or only after single-instance WebSocket limits appear.
- Whether local Google Meet testing should use ngrok, Cloudflare Tunnel, or another HTTPS tunnel.

## 23. Recommended Immediate Next Step

Start with Phase 0 and Phase 1 together:

- scaffold the monorepo
- start local Supabase
- create owner/auth/entitlement schema
- build standalone gesture drawing prototype

Do not start with Google Meet integration first. The riskiest product assumption is whether gesture writing and erasing feel natural enough in real conversation.
