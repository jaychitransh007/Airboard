# Airboard

A meeting whiteboard you run with your voice and hands. Say “Airo, …” or hold
an open palm and speak, point at shapes, and close your hand to move them;
the mouse and keyboard work too. In Google Meet you present the Airboard tab,
with nothing to install.

## What is live

- **Standalone web app:** a controlled production pilot on Cloud Run, with
  Google sign-in. The home page lists your Airboards; a board opens with voice
  and camera already on (after the browser's one-time permission prompt).
- **Google Meet:** present the Airboard tab (**Present now → A tab**).
- **Screen behind the board:** **Show a screen behind the board** in the
  board's **•••** menu puts slides or another app behind the diagram.

Current revisions, rollback steps and open items are in
[Docs/Project Status.md](Docs/Project%20Status.md); every change and deploy is
in [Docs/Release Readiness Backlog.md](Docs/Release%20Readiness%20Backlog.md).
User-facing behaviour is documented in the Help Center sources under
[Docs/help](Docs/help).

### How a board works

- Changes apply at once; there is no confirm step. Undo is the safety net:
  the **Undo** arrow at the bottom left of the board, `Cmd/Ctrl+Z`, or
  “Airo, undo”. **Redo** and **Hide diagram** (also `Shift+H`) sit beside it.
- **Share** in the top bar opens Share with people (live link), Export PDF,
  Export PNG and Copy image.
- The Airo panel starts hidden as a tab on the board's right edge; it shows
  what Airo heard and did, and has a box for typing a command.
- Airo's results, misses and questions also show on the board itself, with
  quiet sounds (Board settings → Appearance turns them off).
- Deleting a board is permanent; there is no Trash.

### How voice commands are understood

A finalized transcript addressed to Airo (wake word, open palm, a follow-up
within a few seconds, or hold-to-edit) goes first to fast phrase rules for
short commands, and otherwise to an AI planner (OpenAI `gpt-5.6-luna`) that
returns a typed plan. The plan is checked and applied as one undoable change;
Airo makes a best guess rather than asking, and applies the steps it can match.
Meeting talk not addressed to Airo never changes the board. Details:
[Docs/Voice Agent Architecture and Observability.md](Docs/Voice%20Agent%20Architecture%20and%20Observability.md).

## Repository layout

| Path | What it is |
| --- | --- |
| `apps/web` | Next.js web app: marketing pages, Help Center, the signed-in app and the board |
| `apps/api` | Fastify API on Cloud Run: boards, live sessions, voice transcription (Deepgram), the AI planner (OpenAI), accounts and admin |
| `packages/core` | Board model, commands, phrase rules and the plan contract shared by web and API |
| `packages/drawing-engine` | Canvas rendering and hit-testing |
| `packages/gesture-engine` | Hand-pose and gesture recognition |
| `packages/realtime-client` | Live-board WebSocket client |
| `supabase` | Database migrations and local config |
| `infra/cloud-run` | Docker images and `release.sh` (build, migrate, stage, promote) |
| `scripts`, `evals` | Evaluation runners, datasets, launch checks and smoke tests |

The Chrome Meet extension, the unpublished Meet add-on and the Electron
desktop app were removed from the codebase on 12 Nov 2026.

## Local development

Use Node 22 (see `.nvmrc`) and pnpm 11.

```sh
pnpm install
pnpm supabase:start      # local Supabase on ports 56321–56324
pnpm supabase:reset      # apply migrations and seed data
pnpm dev:api             # API on http://127.0.0.1:4000
pnpm dev:web             # web on http://localhost:3000
```

Without `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` the API uses an
in-memory store. Voice needs `DEEPGRAM_API_KEY` and the AI planner needs
`AIRBOARD_INTENT_API_KEY` in the API's environment; without them the board
says voice or the planner is unavailable and typed commands still work.
`.env.example` lists every variable.

Local Supabase ports: API `56321`, Postgres `56322`, Studio `56323`,
Mailpit `56324`.

## Checks

```sh
pnpm typecheck
pnpm lint
pnpm test                                   # unit tests in every package
pnpm --filter @airboard/web exec playwright test   # browser tests
pnpm test:scripts                           # eval and tooling tests
pnpm eval:false-accepts                     # meeting talk must not change the board
pnpm launch:check:deployed                  # production launch gate
```

The commercial and deploy smoke tests (`pnpm smoke:commercial`,
`pnpm smoke:deploy`) and the operator runbook are described in
[Docs/Commercial Platform Runbook.md](Docs/Commercial%20Platform%20Runbook.md).
