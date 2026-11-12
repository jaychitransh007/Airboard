# Refactoring plan: need and scope

> **Date:** 12 November 2026, on `codex/production-readiness` at `27886a2` (PR #51 has since merged to `main`).
> **Method:** seven analysts each measured one item in today's code and defined its need and scope. A cross-checker then verified the key claims and set one order across all seven. The analysts' full findings are in the appendix; the cross-checker's corrections are folded into the summary below.
> **Rule for everything here:** no refactor changes behaviour unless it says so. Each phase ships on its own, passes the full test suite, and can be reverted alone.

## Summary

The removals on 11–12 November already shrank three of these items: the board file is now 12,521 lines (it was 15,400), the stylesheet 5,709 (it was 6,300), and the API control-plane routes 1,948 (they were 2,953).

| Item | Today | The need, in one line | Verdict | Effort |
| --- | --- | --- | --- | --- |
| Remove tokens in URLs | 1 query-token path, 1 HTTP route taking a ticket in its query | The operator token never expires and bypasses sign-in and spend limits; one eval run would write it into a 30-day log | **Do now**, shrunk to the operator-token part | ~1 day |
| Trim eval and CI plumbing | 30,751 lines of scripts; 29 test files run twice per CI run; reports nothing reads | Text-matching build checks would break the board and stylesheet refactors, and the plumbing hides what really guards the product | **Do now**, before the code refactors | ~1.5 days |
| Cut the docs down | ~92,000 words of top-level docs; a 633-word rollback line; 5 launch to-do lists | Wrong guidance at the worst moment: the rollback list's first step would make board saves fail | **Do now**, before the code refactors | ~1.25 days (two passes) |
| Merge the two shape models | 10 parallel command pairs; 80 bridge checks; 3 live user-facing problems | The core "say it, then fix it by hand or name" loop keeps half-working; every Airo diagram adds legacy data to migrate later | **Do soon**, after a shared safety net | 11–16 days |
| Split the board file | 12,521 lines, 80 state values, 150 refs, 30 commits in 9 days | Its logic can't be unit-tested, so tested helpers and production drift apart (2 confirmed defects); agents can't hold it | **Do soon**, mostly after the shape merge | 12–13 days after the merge (16–18 before) |
| Merge the stylesheet layers | 5,709 lines; 2 product layers; 141 overridden values; 60 `!important` | Second most-edited file; every November styling bug came from rules stacked on rules | **Do soon**, layers only | ~2.5–3 days |
| Split the renderer and API route files | renderer 2,928; control plane 1,948; server 1,075; transcription 992 | Copied auth and validation helpers have drifted; billing (untested) will be edited next | **API helpers soon; the rest skip or later** | ~1.5–2 days now |

**Recommended programme: about 35–38 engineer-days** (an AI agent editing, a person reviewing), plus 3–4 days of your time for real-device voice and camera checks, screenshot approvals and the data-migration sign-off. Run alongside pilot work, that is about 8–10 weeks of calendar time. The analyses as first written added up to 46–50 days; the cross-check cut the renderer split, the transcription split and the page-by-page stylesheet split, and merged three separate safety nets into one.

**If you fund only half (about 14–15 days):** do steps 1–4 below, the first phase of the shape merge (Airo draws only the newer shapes), the first two board-split phases, the stylesheet tidy and the API helpers. That stops new legacy shape data from piling up and removes most of the review pain.

## Recommended order

0. **Merge PR #51 to `main` first.** Done: it merged on 12 November, so `main` now matches production.
1. **Remove the operator token from URLs** (~1 day). Security work, small, and it touches the eval harness before the eval trim does.
2. **Trim eval and CI** (~1.5 days) **and the first docs pass** (~0.75 day), in parallel. The trim decides once what replaces the text-matching build checks, so the code refactors don't each have to work around them.
3. **One shared safety net** (~4 days), replacing three separate "phase 0"s:
   - a computed-style check plus about 8 screenshots for the stylesheet and Airo shape types;
   - a "golden journey" board fingerprint, a save-after-every-change test and a raw-hand-frame browser test;
   - one model-independent view of the diagram that the evals and the layout scorer read, so they keep working when Airo switches shape model;
   - one shared type for the browser-test hooks.
   Anything touching voice or camera waits for the real-microphone-and-camera check of RGB-049, which hasn't happened yet.
4. **Shape merge, phase 1: Airo draws only the newer shapes** (~3–4 days). The biggest user-facing gain. In parallel, without conflicts: board-split phases 1–2 (pure helpers, view components) and the stylesheet layer merge.
5. **Shape merge, phases 2–3: convert old boards, then delete the legacy path** (~8 days). First get a read-only count of production boards with legacy shapes: if there are only a handful, a one-off conversion is simpler than converting on every read. This needs your sign-off, because it rewrites saved boards.
   > **Status 12 November 2026:** phase 2 was a one-off conversion: `scripts/convert-legacy-boards.mjs` rewrote every production board holding committed legacy annotation strokes, and a re-count found 0 boards holding any strokes. Phase 3 is implemented on `codex/production-readiness`, not yet committed or deployed. It deletes the legacy path and adds what the one-off conversion left out: convert-on-load (`upgradeLegacyBoardState` in normalizeBoardState, sharedBoardState and the boardSync join/resync intake), `replayBoardEvents` for stored `stroke.*` rows in the API's getState, and the scene-version gate 2→3 in three steps. Step A (API): accept scene versions 2 and 3, reject new `stroke.*`/`erase.committed` writes with `LEGACY_EVENT_RETIRED`, and add `strokes: {}` to the join, resume and `/state` responses for launch-f5e326e tabs. Step B (web): sends version 3 and has no legacy code. Step C (API, at least 24 h after B, separate deploy): accept only 3; remove the `strokes: {}` shim at least 7 days after C. Deploy order A → B → C; the API must not roll back below A while the web is on B. The reverse floor: once C is live, rolling the web back below B also needs the API rolled back to A (or B's API), because a launch-f5e326e tab sends scene version 2, gets `UPGRADE_REQUIRED` and a reload serves the same old web; once the `strokes: {}` shim is removed, a web rollback to launch-f5e326e is not supported (it reads `state.strokes` from join, resume and `/state` responses and throws without it).
6. **Board split, phases 3–6** on the smaller post-merge file (~12 days), so hooks are extracted once, in their final form.
7. **API auth and validation helpers** (~1.5–2 days): any time after step 1, ideally before the next security fix. Split the control-plane file as the first step of paid-launch billing work, not before.
8. **Final docs pass** (~0.5 day).

**How the items affect each other:**
- The shape merge deletes about 850 lines from the renderer, leaving about 2,050 lines that change about once a month, so the renderer split stops being worth doing.
- The shape merge also deletes about 1,000 lines from the board file and most of the board split's last phase.
- The eval trim must come before the board and stylesheet refactors: its build checks match exact text in both files.
- Docs go first because every code refactor adds change-log entries and line references to them.

## What to skip or shrink

- **Skip:** the renderer split (after the shape merge it isn't needed), extracting the transcription stream handler (one well-tested state machine), and splitting the stylesheet by page (small gain, and Next.js can load page stylesheets in an unpredictable order).
- **Make optional:** moving `/sessions/:id/state` to a POST, since the same short-lived ticket still appears in logged WebSocket URLs, which browsers can't avoid. Do the `server.ts` split only when the next live-session change touches it.
- **A bigger lever than any token phase:** decide whether the operator API token should exist in production at all.
- **Corrections to the premises:**
  - "Most of the hands-free review findings came from the gap between the shape models" can't be verified: the review's 20 findings aren't itemised by file. In the original audit, 1 of 12 gaps is directly this split and 2 more partly. The need for the merge still holds, because 3 problems from it are live today.
  - The board file's "1 in 3 commits is a fix" overstates its cost: those fixes were cross-cutting and touched it lightly. Two defects really trace to its size.

## Decisions for you

1. Approve the order, or fund the half programme.
2. Before shape-merge phase 2: approve rewriting saved boards in production (after a read-only count).
3. Whether the operator API token should exist in production.
4. Whether the eval "meta" layer (quality gate, quality report, coverage policy; about 9,300 lines) stays as policy or goes.

---

## Appendix: the analysts' findings per item

Line numbers are as of `27886a2` and will move as soon as any refactor starts; the cross-checker's corrections above take precedence where they differ.

### Remove tokens in URLs

**Analyst verdict:** Do now · about 2 engineer-days as first scoped.

Do now, but only the operator-token and HTTP /state parts. Together that is about 2 engineer-days with 3 staged deploys. It closes Threat Model I-5, which is security work on a secret that never expires and bypasses spend limits. Production request logs for the last 30 days confirm nothing depends on the query form. Moving the WebSocket tickets out of the URL is not worth doing now. Browsers force the URL there, the tickets expire in 60 seconds or 30 minutes, only the owner can read the logs, and the change would touch the socket admission and ticket lifecycle that caused RGB-045. Record that as an accepted risk instead.

#### Today

Measured 2026-11-12 on codex/production-readiness at 27886a2. Churn is the number of commits since 2026-10-01.

1) Operator token in the URL. apps/api/src/security.ts (218 lines, churn 2) has apiTokenAllowed at :143-159. It still accepts AIRBOARD_API_TOKEN as a `token` query parameter (:156-158), and the comment at :140 still gives the browser-WebSocket reason. The only entry point is configuredApiTokenAllowed, so the query form works on four surfaces, not just one socket:
- POST /intent/resolve (semanticIntent/routes.ts:94)
- POST /voice/trace (voiceTrace/routes.ts:95)
- POST /transcription/ticket (transcription/routes.ts:178)
- WS /transcription/ws, as the fallback when no ticket is sent (transcription/routes.ts:231)

The token is set in production from Secret Manager `airboard-api-token` (Threat Model Q-7) and never expires. A caller using it has profileId null. As a result, voice (transcription/routes.ts:582, :789) and Airo (semanticIntent/routes.ts:232-236) never charge the per-person or service-wide daily allowances. The token bypasses sign-in, entitlement, org voice policy and the RGB-044 spend ceiling; only per-minute rate limits and instance stream caps still apply.

The only code that puts it in a URL is the voice eval harness. scripts/lib/audio-stt-eval/adapters.mjs:327-371 adds `?token=` to the voice WS URL, and does so even after it has traded a sign-in token for a ticket (:341). scripts/test/audio-stt-eval.test.mjs:565 asserts that the token IS in the URL, and security.test.mjs:31-32 asserts the query form works. CI no longer holds the token: evals.yml, which the Cleanup Review cites as supplying it, was deleted in 2ddda24, and ci.yml has no API token. The harness's Node `ws` client already sends custom headers (adapters.mjs:436-440). The server already accepts the token as a Bearer header on POST /transcription/ticket and on the WS upgrade, and transcriptionRoutes.test.mjs already connects with Authorization headers.

2) GET /sessions/:id/state?ticket= (server.ts:637-659). This is the last plain HTTP route that takes a credential in the query. The ticket is the 30-minute realtime ticket, which allows reading board state and writing live events as that participant. /events, /heartbeat and /ticket already take credentials in POST bodies (server.ts:521-616). server.ts is 1,075 lines with churn 15. Callers:
- web boardSync.ts:531-536, used to re-read guest permission after a reconnect and for the guest deep resync at :585 (boardSync.ts is 828 lines, churn 4)
- scripts/smoke-commercial-journey.mjs:122
- tests boardSocketLimits.test.mjs:116 and web boardSync.test.mjs:432

3) WebSocket URLs.
- Board WS /ws reads `?ticket=` (server.ts:685). It is the same 30-minute realtime ticket, set by packages/realtime-client/src/client.ts:124-125. client.ts:126-131 still has a dead bare boardSessionId/participantId fallback that the server ignores, and client.test.mjs:81-82 still asserts it.
- Voice WS /transcription/ws reads a 60-second, voice-only ticket (transcription/routes.ts:222; web realtimeSpeech.ts:360). transcription/routes.ts is 992 lines (churn 12); realtimeSpeech.ts is 1,492 (churn 10).
- Browsers cannot set Authorization headers on a WebSocket upgrade. Only Sec-WebSocket-Protocol or a first-message handshake are available.

4) Leftovers. auth.ts (570 lines, churn 7) has been header-only since RGB-016 (2d24ae8, deployed as launch-fc7bc79 on 7 Nov). Its RequestLike still declares an unused `query?: unknown` (:20). security.ts:146 has the same field.

Production evidence: a read-only gcloud logging query on 12 Nov, with all values stripped before printing.
- Cloud Run's platform request log (run.googleapis.com/requests) keeps full query strings, and app-side redaction (requestLogging.ts) does not reach it. This answers Threat Model Q-5: yes.
- The _Default bucket keeps logs 30 days. There are no export sinks. Only one human (the owner) holds a log-reading role.
- API entries in the 30-day window: 30 /ws?ticket=, 23 /sessions/:id/state?ticket=, 6 /transcription/ws?ticket=, 2 /me?access_token= (the RGB-016 staged refusal check, 401), 1 /transcription/ws?access_token= (before RGB-016), and 0 with operator `?token=`/`&token=`.
- Browser history and referrers are not involved for these paths. They are fetch and WebSocket URLs, not page URLs, and the web sends strict-origin-when-cross-origin (securityHeaders.ts:40).

Findings in this area:
- Threat Model I-5: operator token accepted as a query parameter. Low, open.
- Threat Model A-5: Medium, fixed by RGB-016. The row text is stale.
- Threat Model Q-5: open until this check.
- Threat Model Q-7: half answered.
- Cleanup Review appendix: one entry (effort M, payoff medium). Its line numbers and CI reference are stale.
- Backlog: RGB-016 and RGB-015 done. RGB-045, a production incident in this ticket lifecycle, is the cautionary neighbour.
- The RGB-049 review history has 0 findings here.

Baseline tests, run 12 Nov on Node 22.23.4, all green: 47 tests in the 6 affected API test files, 52 web (boardSync, realtimeSpeech), 10 realtime-client, 17 eval harness.

#### Need

Why it matters: a credential in a URL is copied wherever URLs are logged. Here that is Cloud Run's platform request log, kept 30 days. The app's own redaction does not reach it.

The real exposure is uneven:

(a) The operator token is the one that matters. It never expires and grants unmetered Deepgram and LLM spend, bypassing sign-in, entitlement and the RGB-044 daily ceiling. Nothing in production has sent it in a URL in the last 30 days. But the code invites it: the eval harness appends `token=` to the voice socket URL whenever AIRBOARD_EVAL_API_TOKEN is set, even after it already has a ticket. So one live `pnpm eval:audio` run against production writes the token into the request log for a month. A leak means paying for someone else's voice and Airo use until the token is rotated. The only callers are a local script that can already send a header and a test that asserts the unsafe behaviour. Removing it is about 20 lines.

(b) /state?ticket= is the last HTTP route with a credential in its query string; 23 such entries were logged in 30 days. The ticket expires in 30 minutes. The same ticket also appears in the logged /ws URLs, so moving /state to a POST body adds little on its own. Its value is a simple invariant that a test can enforce: no HTTP route reads a credential from the URL. The board socket is the only exception, because browsers force it.

(c) WebSocket tickets are short-lived and purpose-scoped by design: 60 seconds for voice, 30 minutes for the board. Today one person can read the logs, and that person already has full access.

Cost of not doing it:
- Threat Model I-5 stays open.
- The pilot cannot claim "no long-lived secret is accepted in a URL".
- The eval harness remains a foot-gun with a month-long blast radius.
- The planned API route split (item 4) would have to carry the dual header-or-query check into its shared auth guard, which spreads the pattern rather than removing it.

Day-to-day breakage from not doing it: none.

#### In scope

- Eval harness (scripts/lib/audio-stt-eval/adapters.mjs): always trade the available credential (sign-in token or operator token) for a 60-second voice ticket via POST /transcription/ticket with an Authorization: Bearer header, and connect with ?ticket= only. Drop the apiToken parameter from buildLiveGatewaySocketUrl, and flip scripts/test/audio-stt-eval.test.mjs:565 to assert that no `token` appears in the URL in either configuration
- API: make apiTokenAllowed header-only (security.ts:139-159): delete the query branch, the `query?: unknown` field and the stale WebSocket comment, and update security.test.mjs:30-32 to assert the query form is refused
- Add apps/api/test/urlCredentials.test.mjs: `?token=<operator>` alone is refused on POST /intent/resolve, POST /voice/trace, POST /transcription/ticket and WS /transcription/ws, and the Bearer header is still accepted on all four
- Add POST /sessions/:sessionId/state taking { realtimeTicket } in the body, mirroring /events (same rate limiter, same 401 code, same payload). Switch web boardSync.ts fetchSessionState to postJson, and switch smoke-commercial-journey.mjs:122 and boardSocketLimits.test.mjs:116 over too
- After the web has served POST /state for at least one day (sessions live at most 6 h; realtime tickets 30 min), delete GET /sessions/:sessionId/state
- Leftovers: remove `query?: unknown` from auth.ts RequestLike (:20). Remove the dead bare boardSessionId/participantId fallback in packages/realtime-client/src/client.ts:126-131 and its assertions in client.test.mjs:81-82
- Docs: Threat Model I-5 marked fixed for the query form. Q-5 answered: Cloud Run request logs keep full query strings, 30-day _Default retention, no sinks, owner-only log access, checked 2026-11-12. Q-7 updated: no ?token= in 30 days of logs. A-5 row text refreshed. The accepted WebSocket-ticket risk recorded under P-3/A-5. Cleanup Review appendix entry marked done. A backlog RGB row with the deploy and rollback order
- Production verification: rerun the value-stripped Cloud Run request-log query before the phase-2 deploy and 48 h after the last one

#### Out of scope

- Moving the board-socket and voice-socket tickets out of the URL (Sec-WebSocket-Protocol carrier or first-message auth). Browsers cannot set headers on the upgrade, and it would touch socket admission, where RGB-045 broke live sessions. Revisit if anyone besides the owner gets log-read access or before a public launch that promises zero URL credentials
- Shortening the 30-minute realtime ticket or minting a separate 60-second board-socket ticket (ticket lifecycle; RGB-045 risk)
- Capability links that are shared on purpose: the live join link /live/<id>?joinToken= (2 h), share links /s/:token and invitations /invite/:token. Path-token log redaction is Threat Model P-3
- Whether AIRBOARD_API_TOKEN should exist in production at all (launch-ready-check.mjs:130 requires it), and whether operator traffic should count against the RGB-044 service ceiling. Both are founder decisions under Threat Model I-5
- Removing the Authorization-header fallback on /transcription/ws for Node clients (headers are not logged; many transcription tests rely on it)
- Redacting, excluding or re-retaining Cloud Run platform request logs
- Splitting server.ts or transcription/routes.ts, or building a shared auth guard (item 4, API route split)

#### Target structure

No new modules. The surface shrinks; net source change is about -25 lines plus about 90 lines of tests.
- security.ts (218 to about 212 lines): `apiTokenAllowed(request: { headers }, token)` reads only `authorization`. configuredApiTokenAllowed is unchanged except the narrower type.
- auth.ts (570 to 569): RequestLike = { headers }.
- server.ts (1,075, about +/-0): GET /sessions/:id/state is replaced by POST /sessions/:id/state with Body { realtimeTicket?: unknown }, validated like /events. During phases 3-4 both exist, sharing one handler function.
- transcription/routes.ts: unchanged in code (the WS takes a ?ticket=, or a header for Node clients). One comment is updated.
- web boardSync.ts (828): fetchSessionState uses the existing postJson helper (-2 lines).
- packages/realtime-client/src/client.ts (351 to about 345): a ticket is required; the bare-id branch is gone.
- scripts/lib/audio-stt-eval/adapters.mjs (449 to about 445): authorizedLiveGatewaySocketUrl always calls POST /transcription/ticket with whichever Bearer credential it holds; buildLiveGatewaySocketUrl(url, apiBaseUrl, ticket) loses its apiToken parameter.
- New apps/api/test/urlCredentials.test.mjs (about 80 lines): one test per operator-token surface for the query form (refused) and the header form (accepted), plus POST /state happy path, wrong-session 401 and GET 404 after phase 4.

The resulting invariant, stated in security.ts and the Threat Model: credentials travel only in headers or JSON bodies. The single exception is the WebSocket upgrade, which accepts only short, purpose-scoped signed tickets (realtime 30 min, voice 60 s) and never the operator token or a sign-in token.

#### Phases

1. **Phase 0: characterization tests first** (0.25 days): Add urlCredentials.test.mjs pinning today's header behaviour: a Bearer operator token is accepted on POST /intent/resolve, POST /voice/trace, POST /transcription/ticket and the /transcription/ws upgrade. Add a test that the POST /state body shape will equal today's GET /state body (sceneVersion, session, state). The query-form cases are added as expected-to-pass-now and flipped in phase 2. No production code changes.
   - *Safety:* Test-only change. pnpm test, typecheck and lint stay green. It fixes the header path as the contract before anything is removed.
2. **Phase 1: eval harness stops putting the operator token in a URL** (0.25 days): adapters.mjs: authorizedLiveGatewaySocketUrl trades accessToken ?? apiToken for a ticket via POST /transcription/ticket (Bearer header). buildLiveGatewaySocketUrl drops the apiToken parameter. Flip audio-stt-eval.test.mjs:565 to assert searchParams.get('token') === null, and add an operator-token-only case asserting a Bearer ticket request plus ?ticket=.
   - *Safety:* Local script, not deployed. The server already accepts both forms, so this ships alone with no behaviour change for production. pnpm test:scripts must stay green (17 tests today). Optionally run one live eval against local dev with only AIRBOARD_EVAL_API_TOKEN set.
3. **Phase 2: API refuses the operator token in the query (API deploy)** (0.35 days): Make apiTokenAllowed header-only. Remove `query?: unknown` from security.ts and auth.ts, and fix the comment at security.ts:139-141. Update security.test.mjs:30-32 and flip the phase-0 query cases to 'refused'. Before deploying, rerun the value-stripped Cloud Run request-log query for `?token=`/`&token=` on both services (0 hits from 2026-10-13 to 2026-11-12). Staged API deploy, then promote.
   - *Safety:* Depends only on phase 1 being merged. Web, smoke and CI never send ?token=. Tests that must stay green: security, transcriptionRoutes, semanticIntentRoutes and voiceTrace route tests, urlCredentials. Rollback: the previous API revision, independent of the web.
4. **Phase 3: add POST /sessions/:id/state; web switches (API deploy, then web deploy)** (0.5 days): Add the POST route sharing one handler with GET (body realtimeTicket, same limiter and errors). Deploy the API. Then switch boardSync.ts fetchSessionState to postJson, plus smoke-commercial-journey.mjs:122 and the boardSync and boardSocketLimits tests. Deploy the web.
   - *Safety:* Additive on the API, so old tabs keep using GET. Characterization: POST and GET return deepEqual bodies; a wrong-session or expired ticket gives 401 on both. Must stay green: liveSessionTickets, boardSocketLimits, sessionAccess, the web boardSync unit tests (52), and the Playwright boardSync.spec (two browsers plus reload) and liveLinks.spec against the real local API. Rollback order: web first, then API; record it in the deploy note.
5. **Phase 4: delete GET /sessions/:id/state (API deploy, at least 1 day after phase 3's web deploy)** (0.25 days): Confirm in Cloud Run request logs that no GET /state?ticket= arrived in the last 24 h. Then delete the GET route and add a urlCredentials case that GET /state returns 404 or 405.
   - *Safety:* After this, rolling the web back to a pre-phase-3 build would break guests' permission re-read and deep resync. The board stays live but stale. So the rollback paragraph must say: web rollbacks past phase 3 also need the API from before phase 4. Same test set as phase 3.
6. **Phase 5: leftovers and records** (0.4 days): Remove the realtime-client bare-id fallback and its client.test.mjs assertions. Update the Threat Model (I-5 fixed; Q-5 answered with today's log facts; Q-7 updated; A-5 text refreshed; WebSocket tickets recorded as accepted risk). Mark the Cleanup Review appendix entry done, and add the backlog RGB row. 48 h after phase 4, rerun the log query as the done check.
   - *Safety:* The web never constructs the client without a ticket, so this is no behaviour change; realtime-client tests (10) and Playwright boardSync.spec stay green. docs:check must pass.

#### Risks

- Hidden operator-token caller using ?token= (an ad-hoc curl, a forgotten job). Containment: 30 days of production request logs show zero ?token=/&token= on either service; Cloud Scheduler uses the cron secret in a header (controlPlaneRoutes.ts:1114). Rerun the query right before the phase-2 deploy. If anything breaks, the fix is a Bearer header, not a rollback.
- Rollback-order trap once the web uses POST /state (phase 3) and the GET is gone (phase 4): an API rollback below phase 3 breaks guests' permission and resync reads, and a web rollback below phase 3 does the same after phase 4. Containment: ship the API one deploy ahead, keep GET at least 1 day, and write the web-first order into the rollback note.
- Regressing live-session ticket handling, as in RGB-045 (sessions died within an hour). Containment: no change to ticket TTLs, refresh, WS admission or EXPIRED_TICKET handling. liveSessionTickets.test.mjs, boardSocketLimits.test.mjs and the Playwright two-browser boardSync.spec must stay green, followed by a short owner-plus-guest live session on the staged revision.
- POST /state adds a CORS preflight that the GET avoided. It only runs on reconnects and deep guest resyncs, and /events already pays the same cost, so the effect on perceived latency is negligible. Note it in the change rather than design around it.
- Eval harness operator-only runs now depend on POST /transcription/ticket succeeding. That route has no origin check and Node fetch is not subject to CORS. Cover it with the new operator-only harness test.
- Merge conflicts with the API route split (server.ts, transcription/routes.ts) and the eval trim (adapters.mjs). Containment: land this first; it is about 2 days and touches only a few lines in each file.
- False sense of completion: realtime and voice tickets still appear in Cloud Run logs via the WebSocket URLs. Containment: record this explicitly as an accepted risk with its conditions for revisiting, so nobody reports 'no credentials in URLs' as done.

#### Done when

- apiTokenAllowed reads only the Authorization header. Neither security.ts nor auth.ts declares or reads a query field.
- urlCredentials.test.mjs passes: `?token=<operator>` alone is refused on POST /intent/resolve, POST /voice/trace, POST /transcription/ticket and WS /transcription/ws, and Bearer <operator> is accepted on all four.
- No non-WebSocket route reads a credential from the query string. POST /sessions/:id/state with a body ticket returns the same payload the GET did, and GET /sessions/:id/state returns 404 or 405.
- The eval harness never emits `token=` or `access_token=` in a URL in any credential configuration (audio-stt-eval.test.mjs).
- pnpm typecheck, lint, test, test:scripts and docs:check are green, as are Playwright boardSync.spec and liveLinks.spec. Baseline counts are not reduced except for deliberately flipped or removed assertions.
- Measurable done: 48 h after the last deploy, the value-stripped Cloud Run request-log query on airboard-pilot-api returns 0 entries matching `?token=`, `&token=`, `access_token=` or `/state?ticket=`. The only remaining `ticket=` URLs are `/ws?` and `/transcription/ws?`.
- Threat Model I-5 closed for the query form, Q-5 answered, Q-7 updated, the WebSocket-ticket accepted risk recorded, and the Cleanup Review entry marked done.

#### Depends on

No item blocks this one, and it should go first.
- Board-file split (AirboardPrototype.tsx): independent. Nothing here touches that file; boardSync.ts is separate.
- Shape-model merge: independent.
- Renderer/API route splits: this should precede the API split. It removes the dual header-or-query check, so the split's shared auth guard is header-only from the start, and it avoids conflicts in server.ts and transcription/routes.ts. The renderer split is unrelated.
- Stylesheet layers: independent.
- Eval/CI plumbing trim: overlaps on scripts/lib/audio-stt-eval/adapters.mjs and its test. Land phase 1 here first, or fold it into the trim if the trim deletes the live-gateway adapter. In that case phase 1 becomes 'delete the adapter' and phase 2 is unblocked as soon as it does. CI no longer supplies the operator token since evals.yml was removed, so there is no workflow to change.
- Docs consolidation: this item updates Threat Model I-5/Q-5/Q-7/A-5 and the Cleanup Review appendix. Do the consolidation after it, so the consolidated docs do not carry stale token-in-URL rows. The rollback note for phases 3-4 must fit whatever shortened rollback format the docs item adopts.

### Trim eval and CI plumbing

**Analyst verdict:** Do soon · about 3.5 engineer-days as first scoped.

The trim is about 3.5 days of low-risk work that deletes test plumbing, not product code. Pilot users gain nothing directly, and the CI time saved is small, so it is not urgent on its own.

Phases 1-2 must land before the board-file split and the stylesheet split, because the source-grep contracts would break both refactors in CI and in the production image build. Phase 1 also restores the help-docs check, which today can't fail. Phases 3-5 can follow in the same week.

Phase 3 deletes release machinery (quality gate and report, browser evidence, real-device specs). It follows from the owner's 12 Nov decision to remove the release tiers, but the owner should confirm it explicitly. If the owner wants a smaller step, do Phases 0-2 only (about 1.5 days): that removes all double runs and frees the board and CSS splits.

#### Today

CI (ci.yml, 103 lines, the only workflow) has 3 jobs, and branch protection requires all three by name: "Typecheck, tests, safety evals", "Playwright E2E (interaction layer)" and "Secret scan". Recent green runs (43070968132, 43069812449, 42944456308, 43173988601):
- verify: 95-155 s. Build apps 35-61 s, typecheck 12-20 s, unit 14-19 s, script tests 3-6 s, eval:pr 7-12 s.
- e2e: 384-446 s, with one 1,189 s outlier when "Install Playwright browsers" stalled for 733 s. Its "Build packages" step (`pnpm -r build`, which includes `next build`) takes 43-62 s, but Playwright runs `next dev` and builds the API itself in webServer, so that step looks unnecessary.
- secrets: about 11 s.
- The PR's critical path is the e2e job. 166 CI runs since 16 Jul: 141 passed, 23 failed. The offline eval gate failed once (8 Aug). The other failures: Dependabot build breaks ×6, secret scan ×8, E2E ×6, script tests ×1, browser install ×1.

eval:pr --skip-browser has 21 steps and takes 4 s locally:
- 6 steps are `node --test` re-runs of 29 unique test files (30 entries; inputCapabilities runs twice) that the same job already ran: 15 of the 17 scripts/test files (via test:scripts) and 14 apps/web and apps/api tests (via `pnpm test`, where every package is a bare `node --test`).
- 2 steps (eval-quality-report and eval-quality-gate --mode pr) write `status: "config_only", metrics: {}`. Their only producer, the release tier, was removed on 12 Nov.
- `semantic-ambient-negative-contract` (--validate-only) is a strict subset of the `--replay` step.
- The `core-browser-journeys` step and its 6-file list are always skipped in CI, because the e2e job runs every spec.

Report writers: 5 remain (run-eval-suite, eval-audio-stt, eval-gesture-replay, interaction-eval-reporters, eval-voice-intent), about 700 lines writing .xml, .html and .md next to JSON. Nothing reads them. CI uploads artifacts/evals/ on every run: 142 eval-pr artifacts, about 12 MB, with no consumer. Because the upload uses `if: always()` plus `if-no-files-found: error`, it added a second red step to 7 of the 23 failed runs.

Release-only machinery left without a producer:
- quality gate and report: libs 1,712 + 1,301, CLIs 164 + 150, tests 730 + 596.
- gesture-browser-evidence: 736 + 482 test lines, plus the gestureVideoReplay.spec.ts e2e (754).
- real-device media: realDeviceMedia.spec.ts (308), realDeviceMediaEval.ts (98) and its test (103).
- release branches in validate-eval-datasets (about 500 of 1,094 lines), eval-gesture-replay and eval-capability-coverage.
- The data behind them: the audio corpus has 0 assets, participant-splits has 0 participants, and the gesture corpus has 1 synthetic trace that packages/gesture-engine/test/landmarkTrace.test.mjs already replays.

Build-time source-grep contracts (verify-automated-command-contract.mjs 234 lines, verify-camera-layer-contract.mjs 69) run in every web build, in CI and in the production web.Dockerfile:
- 15 forbidden markers plus a check for a deleted model file, all for features removed 26 Jul-4 Aug.
- About 30 exact-text markers in AirboardPrototype.tsx and globals.css (for example `snapGestureTrackerRef.current!.reset()` and `.canvas-copilot {`).
- They forced a fix-only commit (6c4ca43).

The "Help documentation" check (docs:check) can never fail in CI: it runs after "Build apps", whose web build has just regenerated the tracked apps/web/src/generated/helpContent.ts.

The capability registry (evals/capability-coverage/v2.json) has 52 static evidence entries, 15 of them keyed by browser test title. It was touched in 8 commits since 4 Nov. A test-title rename turned CI red (42950465520, `evidence.stale-id`), which needed fix commit 930eba4.

Size: scripts/ is 60 files and 30,751 lines, against 75,406 lines of product source (41%); evals/ is 352 KB. Churn since 1 Oct: ci.yml 5 commits, run-eval-suite 2, scripts/lib 11, scripts/test 17, evals 16 (registry 8), ops/launch-evidence.json 21. Nearly all were removals or false-alarm repairs, not new checks.

Findings: the Cleanup Review has 6 items under Scripts, evals and CI, plus 2 related ones. Its figures ("32 files", "six writers") are out of date after 2ddda24; the current figures are above.

The parts that do their job: the semantic-negatives replay found RGB-038, and its request hash forced a re-record in RGB-049 (928def2). eval-false-accepts was extended for RGB-049.

Fidelity gap: the replay grounds plans through a hand copy of the board's prepareSemanticActionPlan (semantic-grounding-eval.mjs:181), not production groundSemanticPlan. That is harmless today, because all 60 recorded answers are `unsupported` with 0 actions.

The launch-evidence gate `automated-regression` says "verified", but its evidence is the 4 Aug 14151b6 run, which included the removed Meet replay and extension.

#### Need

CI speed is not the reason: at most about 1 minute per PR comes back, mostly the unused e2e build. The real reasons:
1. The grep contracts block other refactors. They match exact text in AirboardPrototype.tsx and globals.css, and they run inside both the CI build and the production web image build. Every board-file-split or stylesheet-split PR would fail "Build apps" and Cloud Build until about 30 markers were edited in step. A harmless layout change already broke this once (6c4ca43).
2. The plumbing gives false assurance. About 7,100 lines of release-gate code, specs and tests run or sit in every PR but assert nothing: the quality gate passes on an empty `config_only` report, and the media specs are skipped. Meanwhile one real check, the help-docs drift check, is silently disabled by step order. Reviewers and agents read 30k lines of scripts and can't tell what actually guards the product.
3. Duplicate lists rot. 29 test files are listed twice, so renaming or deleting a test means editing run-eval-suite.mjs too. A browser list, a `--skip-browser` mode and a composition test that regex-checks the runner's source all guard a step CI never runs.
4. Noise. The upload step adds a second red X to unrelated failures, and 142 artifacts were uploaded that nothing downloads.

Cost of not doing it: about 1 fix-only commit a week from the grep and registry checks, which gets worse once the board and CSS splits start. Help docs can drift from the committed generated file unnoticed. Agents keep reading and maintaining roughly 9k lines that protect nothing. The safety net itself is cheap and must stay; the trim only removes the layers around it.

#### In scope

- Remove the 6 `--test` steps from the eval:pr tier, so each of the 29 duplicated test files runs once, via `pnpm test` or `pnpm test:scripts`.
- Remove the `semantic-ambient-negative-contract` step, which is a subset of the --replay step.
- Remove the `core-browser-journeys` step, the coreBrowserFiles list and the --skip-browser flag; CI runs plain `pnpm eval:pr`.
- Move the CI `Help documentation` (docs:check) step before `Build apps`, so a stale helpContent.ts fails CI again.
- Remove the redundant `Build packages` step from the e2e job (Playwright webServer builds the API itself and runs `next dev`).
- Delete the CI `Upload privacy-safe evaluation reports` step. The runner prints the full output of a failing step in the log instead of a 12-line tail.
- Replace verify-automated-command-contract.mjs and verify-camera-layer-contract.mjs with one node:test file in apps/web/test, keeping only the real invariants: hand model SHA-256, exactly one HandLandmarker.createFromOptions, .detectForVideo and MediaPipeHandTracker.create across runtime sources, camera-layer z-index order read from every CSS file under app/, and the scrim constants imported rather than grepped.
- Drop the forbidden-marker lists for features removed Jul-Aug and every exact-text AirboardPrototype marker. Take both scripts out of the apps/web build script, and delete their 2 COPY lines from web.Dockerfile (keep `COPY apps/api/src`, which the help generator needs, and fix its comment).
- Make the AirboardPrototype.tsx text-grep test in gestureFrameCoordinator.test.mjs:262-282 robust to the board split: count across the board feature folder instead of one file.
- Delete the release-only machinery (owner confirmation): eval-quality-gate and eval-quality-report (libs, CLIs, tests), evals/quality-gates/*, the eval:quality* package scripts, gesture-browser-evidence (lib and test), gestureVideoReplay.spec.ts, realDeviceMedia.spec.ts, realDeviceMediaEval.ts and its test, evals/datasets/participant-splits.v1.json, and the --release and --browser-evidence-dir paths in validate-eval-datasets, eval-gesture-replay and eval-capability-coverage. Keep the raw-media-in-git rejection and the manifest shape checks.
- Remove the JUnit, HTML and Markdown writers from run-eval-suite, eval-audio-stt, eval-gesture-replay and interaction-eval-reporters (including the 3 alias exports), and trim the matching test assertions. Keep JSON output. eval-voice-intent (manual) keeps JSON plus its Markdown summary.
- Write local eval output to a fixed artifacts/evals/latest instead of a new timestamped folder per run.
- Rewrite eval-suite-composition.test.mjs to import an exported step list rather than regex-matching source, and assert that the safety-net steps are present.
- Rewrite evals/README.md to describe only the offline gate and the manual live tools, removing the 'not the merge gate' contradiction. Trim the eval:* aliases in package.json to the documented ones.
- Refresh the `automated-regression` evidence text in ops/launch-evidence.json to cite the three required CI checks on main.

#### Out of scope

- Changing any eval corpus or expectation (evals/voice-intent/*, evals/interactions/v1.json, evals/audio/stt-scenarios.v1.json, the recorded negatives or the known list). No safety expectation moves in this refactor.
- Removing the manual live tools the owner kept on 12 Nov: eval:voice, eval-semantic-negatives --live/--record, and eval-audio-stt's live-websocket and mounted-WAV adapters.
- Switching semantic-grounding-eval.mjs from its copy of prepareSemanticActionPlan to production grounding. That follows the board split, once the planner is extracted.
- Changing how the capability-coverage registry matches evidence (for example stable test IDs instead of titles). Revisit if test-title renames keep causing fix-only commits.
- Speeding up the Playwright browser install (container image or apt cache), despite the 733 s stall and 1 failed install in recent runs.
- The double typecheck: next build and the API build each type-check again before `pnpm typecheck`. That costs about 10-15 s, and `pnpm typecheck` still covers the packages.
- The deploy smoke scripts (smoke:deploy, smoke:commercial), fixed on 12 Nov, and the launch-ready-check logic, which is tested and used for deploy decisions.
- Docs/* consolidation and the four launch to-do lists (the docs item).
- Eval-only test hooks inside product code, such as eval_landmark_injection in AirboardPrototype.tsx (board-split item).
- Renaming CI jobs, which would break the required status checks.

#### Target structure

ci.yml: about 85 lines, with the same 3 job names.
- verify: install → help docs check → build apps (api build; web: help generation, then `next build` only) → typecheck → lint → unit → script tests → prod audit → `pnpm eval:pr`. No upload step.
- e2e: install → playwright install → e2e. No build step.
- secrets: unchanged.

scripts/run-eval-suite.mjs: about 150 lines (from 429). It exports `prSteps` and writes one suite-results.json plus a console summary. 12 PR steps, all eval CLIs:
1. dataset-policy
2. capability-coverage
3. deterministic-contract-matrix
4. deterministic-positive-corpus
5. grounded-ambient-negatives (eval-false-accepts)
6. semantic-ambient-negative-replay
7. provider-event-replay
8. seeded-evaluator-faults
9. canonical-interactions
10. landmark-replay (synthetic replay and fault trials only)
11. semantic-metamorphic-contract
12. audio-adapter-replay

Steps 5, 6, 8, 9 and 2-4 are the safety net that must stay.

Deleted whole files, about 7,400 lines in 14 files:
- scripts/eval-quality-{gate,report}.mjs and scripts/lib/eval-quality-{gate,report}.mjs
- scripts/test/eval-quality-{gate,report}.test.mjs
- scripts/lib/gesture-browser-evidence.mjs and its test
- scripts/verify-{automated-command,camera-layer}-contract.mjs
- apps/web/e2e/{gestureVideoReplay,realDeviceMedia}.spec.ts
- apps/web/src/features/board/realDeviceMediaEval.ts and its test
- also evals/quality-gates/ and evals/datasets/participant-splits.v1.json

Trimmed, about 1,700 lines: validate-eval-datasets.mjs (about 1,094 → 550), eval-gesture-replay.mjs (about 1,661 → 1,250), eval-audio-stt.mjs (906 → about 780), interaction-eval-reporters.mjs (391 → about 100), eval-capability-coverage and its lib (release flag), interaction-eval-foundation.test.mjs (JUnit and HTML assertions).

New: apps/web/test/runtimeInvariants.test.mjs, about 80-100 lines.

Result: scripts/ goes from 60 files and 30,751 lines to about 50 files and 23,000 lines. evals/README.md goes from about 400 lines to about 150. Every test file runs exactly once per CI run.

#### Phases

1. **0. Baseline and characterization** (0.25 days): Record the baseline from a clean main run: per-package test counts and test names (core, drawing-engine, gesture-engine, api, web, scripts), and each eval:pr step's result line. Expected values: grammar N/N, false-accept HARD 0, 60/60 semantic negatives quiet with an empty known list, all seeded faults caught, interaction pass count, and job and step durations. Export the PR step array from run-eval-suite.mjs. Rewrite eval-suite-composition.test.mjs to import it and assert that the safety-net step IDs are present and that no step uses `--test`.
   - *Safety:* Behaviour unchanged. The new composition test fails if any safety step is removed later. The baseline table goes in the PR description and is the reference for every later phase.
2. **1. Remove double runs and fix CI ordering** (0.5 days): Delete the 6 `--test` steps, the negatives --validate-only step, the browser step, coreBrowserFiles and --skip-browser. CI calls `pnpm eval:pr`. Move docs:check before Build apps. Remove the e2e `Build packages` step. Delete the upload step and print the full output of a failing step. Keep all job names.
   - *Safety:* Compare test names from the CI logs with the Phase 0 baseline: every one of the 29 files still runs once, via pnpm test or test:scripts. eval:pr results for the kept steps are identical. Get 2 green e2e runs without the build step (restore just that step if one fails). Mutation check: edit a Docs/help article without regenerating, and docs:check must fail. The 3 required checks still report on the PR.
3. **2. Replace the source-grep build contracts with tests** (0.75 days): Add apps/web/test/runtimeInvariants.test.mjs covering the hand model SHA-256, the single HandLandmarker create, detect and tracker sites across runtime sources, the camera-layer z-index order read from all CSS under app/, and the scrim constants via import. Gesture arbitration order is already tested in gestureFrameArbitration.test.mjs; confirm it. Make the gestureFrameCoordinator.test.mjs text grep scan the board folder. Remove both verify scripts from the apps/web build script, and their COPY lines from web.Dockerfile.
   - *Safety:* Each new invariant has a negative control: a fixture string with a second createFromOptions, or a wrong z-index, must fail. Local `docker build -f infra/cloud-run/web.Dockerfile` succeeds, or use the owner's staged 0% Cloud Build deploy. Web build output is otherwise identical. Must merge before the first board-split or CSS-split PR.
4. **3. Delete release-only machinery (owner confirms)** (1.25 days): Tag the commit first (e.g. eval-release-machinery-final). Delete the quality gate and report (libs, CLIs, tests, evals/quality-gates), the eval:quality* scripts, gesture-browser-evidence and its test, the gestureVideoReplay and realDeviceMedia specs, realDeviceMediaEval.ts and its test, and participant-splits. Strip the --release and --browser-evidence-dir paths from validate-eval-datasets, eval-gesture-replay and eval-capability-coverage, and update capability-coverage v2.json's physicalMedia pointer.
   - *Safety:* The 12 kept eval steps give the Phase 0 results exactly. Seeded faults are still all caught. Playwright's passed count is unchanged; only the skipped count drops. No change under evals/voice-intent or evals/interactions (git diff --stat must be empty). Live adapters and manual CLIs still start with --help.
5. **4. JSON-only reports** (0.5 days): Remove the JUnit, HTML and Markdown writers from run-eval-suite, eval-audio-stt, eval-gesture-replay and interaction-eval-reporters, and trim the matching test assertions. Keep Markdown only in manual eval-voice-intent. Point the default output at artifacts/evals/latest.
   - *Safety:* JSON reports are byte-compatible in structure (same top-level keys) with the Phase 0 run. `git grep -E 'junit|\.xml"|\.html"' scripts` is empty, except eval-voice-intent's Markdown. eval:pr results are unchanged.
6. **5. Docs and evidence ledger** (0.25 days): Rewrite evals/README.md for the offline gate and the manual live tools. Trim the package.json eval:* aliases to the documented set. Update the automated-regression evidence in ops/launch-evidence.json to cite the required CI checks on main.
   - *Safety:* `pnpm launch:check` stays READY for controlled-pilot. launch-ready-check.test.mjs passes. No README command points at a missing script (grep each one).

#### Risks

- Renaming a CI job blocks every merge, because branch protection requires the exact names "Typecheck, tests, safety evals", "Playwright E2E (interaction layer)" and "Secret scan". Contain: never rename them; check that the PR shows all 3 checks reporting.
- A test that ran only through eval:pr would be silently dropped. Contain: compare test names per file in the CI logs against the Phase 0 baseline. All 29 files are under apps/*/test or scripts/test, which `node --test` and test:scripts already cover.
- Losing a real invariant (one camera inference stream, the vendored model hash, camera layer order) when the grep scripts go. Contain: port each one to node:test with a negative-control assertion before deleting the script.
- The production web image depends on Dockerfile COPY lines; `apps/api/src` is needed by generate-help-content. Contain: delete only the 2 verify-script COPY lines, and build the image locally or with a staged 0% deploy before merging.
- Removing the e2e build step could expose a hidden dependency. Contain: 2 green runs before merging, and restore that single step if one fails.
- The owner may later want the release quality gate for a real-media programme. Contain: explicit owner confirmation for Phase 3, a git tag at the last commit that has it, and restoring from history is straightforward.
- An agent "fixes" an eval expectation to get green. Contain: no diff allowed under evals/voice-intent, evals/interactions or evals/audio/stt-scenarios in this refactor, and kept steps must match the Phase 0 results exactly.
- Moving docs:check earlier may turn CI red on a branch whose committed helpContent.ts is stale. That is intended; regenerate with `pnpm docs:build`.
- Less failure detail without uploaded artifacts. Contain: the runner prints the full output of a failing step in the CI log, and local runs keep JSON in artifacts/evals/latest.

#### Done when

- Every test file runs exactly once per CI run: `grep -c '"--test"' scripts/run-eval-suite.mjs` is 0, and the CI test counts match the Phase 0 baseline minus the deleted realDeviceMediaEval and quality-gate/report/browser-evidence tests.
- eval:pr has 12 steps, all eval CLIs, and gives the Phase 0 results exactly: grammar N/N, false-accept HARD 0, 60/60 negatives quiet with an empty known list, all seeded faults caught, interaction pass count unchanged.
- CI has no upload step. The e2e job has no build step, and its median duration over 5 runs is at least 40 s below the 384-446 s baseline. The 3 required check names are unchanged and green.
- Editing a Docs/help article without regenerating makes the `Help documentation` step fail.
- The apps/web build script is `generate-help-content && next build`. web.Dockerfile has no verify-* COPY. A production web image builds. The new runtime-invariant tests fail on their negative controls.
- `git grep -E 'eval-quality-(gate|report)|quality-gates/|gesture-browser-evidence|realDeviceMedia|participant-splits'` returns nothing outside Docs/ and the archive.
- No JUnit or HTML writer remains in scripts/. An eval:pr run writes only JSON, to artifacts/evals/latest.
- scripts/ is at most 23,500 tracked lines (from 30,751) and at most 50 files (from 60).
- evals/README.md describes only commands that exist; each documented command runs or prints --help.
- The launch-evidence automated-regression text cites the required CI checks, and `pnpm launch:check` is READY for controlled-pilot.

#### Depends on

Board-file split: Phase 2 must land first. Both grep contracts and gestureFrameCoordinator.test.mjs match exact text in AirboardPrototype.tsx, and the contracts run in CI and in the production web image build, so every split PR would fail.
- The eval CLIs import about 10 board modules directly: commandTurnCoordinator, intentPipeline, gestureFrameCoordinator, voiceCommandRouter, intentCanvasParser, browserSpeech, realtimeSpeech, snapGestureTracker, semanticAutoLayout and inputCapabilities. The split should keep those paths or update the imports in the same PR; CI catches a broken one.
- After the split extracts prepareSemanticActionPlan, semantic-grounding-eval.mjs:181 should call it instead of its copy (follow-up).

Stylesheet layers: Phase 2 must land first. verify-camera-layer-contract and verify-automated-command-contract read app/globals.css for the z-index rules and `.canvas-copilot {`. The new test reads every CSS file under app/, so it survives the split. accessibilityStyles.test.mjs also reads globals.css; the stylesheet item handles that one.

Shape-model merge: no blocking dependency. The kept safety-net evals (interactions, grammar, false accepts, seeded faults, semantic-negatives replay) are its regression harness, so do this trim first to give it a lean, trusted harness. Expect capability-registry edits when the merge changes capabilities.

Renderer and API route splits: no blocking dependency. Some eval code imports API sources by path: eval-provider-events imports apps/api/src/transcription/deepgramFluxProtocol.ts, and semantic-negative-replay imports apps/api/src/config.ts and semanticIntent/openaiResponses.ts. The API split must keep or update those paths.

Token-in-URL removal: independent. The token-in-URL code that remains is the manual live-websocket adapter, which puts `ticket` and the operator `token` in the WebSocket query (scripts/lib/audio-stt-eval/adapters.mjs:344-371, kept by the 12 Nov owner decision), and smoke-commercial-journey.mjs:122, which uses `/sessions/:id/state?ticket=`. The token item must change both. Deleting the live adapter would make that easier, but needs a new owner decision.

Docs: Phase 5 only touches evals/README.md and one line of ops/launch-evidence.json. The docs item owns Docs/* and the four drifting launch lists; coordinate so launch-evidence.json changes once. This plan replaces the out-of-date eval and CI numbers in Docs/Cleanup Review.md (section 4 item 8 and the appendix).

### Cut the docs down

**Analyst verdict:** Do now · about 4.75 engineer-days as first scoped.

This is the cheapest and lowest-risk of the seven items: no product code changes, and help builds and launch:check stay the same.

It also removes a live hazard: the rollback list the incident runbook points to contradicts the rollback floor stated in the same file.

It should go before the code refactors. Each of them adds register rows and change-log entries, so splitting first means they write into a 40 KB register and a monthly change-log file instead of a 183 KB Backlog.

Phases 0–4 take about 3.75 engineer-days. Phase 5, the deploy log written by release.sh, touches release tooling and is do-later.

If the owner wants only the smallest step: Phase 1 alone takes half a day. It cuts the rollback paragraph to the current and previous pair plus the floor, replaces the three duplicate gate lists with links to the ledger, and fixes the stale Official and Runbook statements. That removes the hazard and most of the contradiction.

#### Today

Measured on codex/production-readiness at 27886a2, 12 Nov 2026.

SIZE. Docs/ holds 17 top-level .md files plus archive/ and help/. 16 of them are tracked; Threat Model.md (64.5 KB) is private and excluded from git. The 16 tracked active docs total 605 KB and 82,354 words:
- Cleanup Review: 308 KB, 1,011 lines, 37,280 words. It is a point-in-time review whose sections 1–3 are already done.
- Release Readiness Backlog: 183 KB, 1,340 lines, 27,725 words. Lines 1–144 (31.5 KB) are the RGB register. Lines 145–1,340 (151 KB, 1,196 lines, 96 dated entries) are the change log, and 95 of those entries are from 4–12 Nov.
- Project Status: 18.5 KB, 148 lines, 2,820 words. Five single lines are over 80 words each.
- Smaller docs: Official Launch Readiness 11.3 KB, Commercial Platform Runbook 12.0 KB.
- Reading them whole costs agents roughly 45k tokens for the Backlog and 75k for the Cleanup Review.
- Help (Docs/help) is already healthy: 17 articles, 1,360 lines, generated into helpContent.ts and checked by `pnpm docs:check` in CI.
- Archive: 3,697 lines, 4 commits since October, left out of Cloud Build uploads by .gcloudignore.

ROLLBACK PARAGRAPH (Project Status line 29):
- It is one bullet of 633 words, up from 590 when the Cleanup Review counted it. It names 28 distinct launch-* releases in 18 "Further back" steps.
- It is now actively wrong. Line 25 of the same file says no API revision older than launch-9d5bd39 is safe, because board saves on launch-2f8678c and older return 500 after migration 20261112120000. Line 29's first step is "both services to launch-2f8678c, the API first", and every API target in the paragraph is older than that floor.
- Docs/Incident and Breach Exercise.md line 55 sends the incident responder to exactly this list.
- Line 30 still says the 12 Nov cleanup is "not yet deployed; database tables stay". Lines 25 and 27 record it as deployed, with the tables dropped.

"WHAT IS LEFT" EXISTS FIVE TIMES. The ledger ops/launch-evidence.json (26 gates; `launch:check` counts 21, 36 and 45 checks for pilot, standalone-GA and paid-GA) is the only machine-checked copy. The four hand-written copies disagree with it:
- Project Status "What is left": 43 lines.
- Official Launch Readiness "Work that cannot be truthfully completed": 17 lines. It lists migrations and scheduler setup, both verified in the ledger, plus two items that are in no gate (the Meet two-account test and log-sink redaction).
- Backlog Tier 4: 10 lines. It still names AIRBOARD_CHROME_EXTENSION_ENABLED, which no longer exists in the code, and lists applied migrations as open.
- Commercial Platform Runbook "External launch gates": 13 lines. It lists Google/Microsoft OAuth, CRM routing and container scanning, which are in no other list.
- RGB-037, "Two conflicting readiness sources of truth", was closed on 2026-07-30. It has come back as four.

OTHER DUPLICATES:
- The release procedure is written three times (Project Status "How to release", Official "Release procedure", the release.sh header), and the copies differ.
- The data and retention table is written twice (Official, Runbook).

STALE DECISION DOCS:
- Official Launch Readiness still says "Active source of truth", "Last updated 25 July 2026", although it has November edits. It says email magic-link is the deployed sign-in, but the pilot is Google-only. Line 50 says deleted boards are recoverable while its own line 80 says deletion is permanent. It still mentions "owned installations" (table dropped) and calls /status a placeholder.
- Runbook: its journey still lists magic-link, Google and Microsoft sign-in and "shared views" (the same doc says /app/shared redirects), and it says custom SMTP is needed before outsiders can sign in.
- Accessibility Audit and Browser Matrix were recorded on 6 Nov, on UI that RGB-046/047 later removed.
- Gesture Interaction Audit still says "source of truth, last reviewed 30 July".
- Touchpad Writing notes sit at the top level although the feature was removed in 9d5bd39.
- 5 broken links: 4 relative links in archive/, plus Security Headers.md linking the untracked Threat Model, which 404s on GitHub.

CHURN:
- 133 of the 159 commits since 2026-10-01 touch Docs/, and 58 of them touch nothing else.
- 76 commits have a "docs:" subject, about 50 of them "record the launch-X deploy".
- Backlog: 118 commits, +1,379/−172 lines. Project Status: 53 commits, +345/−197 lines.
- Every deploy hand-edits a roughly 400–600-character line in Project Status and appends a long change-log line to the Backlog.

FINDINGS AND DEFECTS FROM THIS AREA:
- Cleanup Review: 16 of 106 findings are doc drift (12 in its Docs section, 4 elsewhere). 7 are still open: the rollback paragraph, the four lists, Official, the Runbook journey and SMTP, the audit caveats, the Backlog split, and the links.
- Two real defects came from the doc structure:
  - On 11 Nov, change-log entries were spliced into another entry's sub-bullets (Cleanup Review 1.2).
  - On 7 Nov, the web build failed because a help article cited a file the image doesn't copy (bd5de96).
- In the July audit, 4 of the original 37 RGB items (RGB-034..037) were doc drift.

COUPLING THAT PINS PATHS:
- Help frontmatter `sources` cite Commercial Platform Runbook (4 articles), Platform Support Matrix (2), README (2), and Official Launch Readiness, Accessibility Audit, Browser Matrix and Gesture Interaction Audit (1 each). docs:check fails if any of these move.
- ops/launch-evidence.json cites "Docs/Release Readiness Backlog.md (2026-11-05)" three times.
- evals/voice-intent/semantic-negatives.known-false-accepts.v1.json and the comment in applied migration 20261112120000 cite the Backlog and the Cleanup Review.
- Code comments cite Security Headers, Status and Incident Updates, Accessibility Audit and Browser Matrix.

#### Need

The docs are the working memory of a one-owner, AI-agent team, and three things go wrong with them today.

1. They give wrong operational guidance at the worst moment. The incident runbook sends the responder to a 633-word rollback list whose first step, by the same file's own line 25, makes board saves return 500. Nothing in the list marks the rollback floor that a destructive migration created.

2. The launch picture depends on which doc you open. Five lists of what is left before launch disagree. Official Launch Readiness calls itself the source of truth but says magic-link sign-in and recoverable deletes, both of which are false today. Help article 14 is more current than the doc it cites as its source. The owner cannot answer "what is left for standalone GA" from one place without cross-checking `launch:check`.

3. Every change pays a documentation tax that grows. 58 docs-only commits since October. Every deploy rewrites a paragraph line and appends a change-log entry to a 183 KB file that grows about 17 KB a day at the November pace. Agents that read the Backlog or the 308 KB Cleanup Review spend roughly 45k–75k tokens of context. The file's size has already caused one splice error.

The July fix for duplicate sources of truth (RGB-037) regressed within three months because nothing mechanical prevents it.

Cost of not doing it:
- An incident rollback that follows the doc breaks saves.
- Launch decisions taken on stale claims, such as the sign-in method and deletion semantics, which feed public copy and legal drafts.
- The change log reaches about 300 KB within a couple of weeks of launch-pace work.
- Each of the six code refactors now planned will add RGB rows and change-log entries to the same oversized files, so the drift and the context cost compound while those refactors run.

The cost of doing it is low: no product code, mostly verbatim moves, and the existing docs:check CI step to extend.

#### In scope

- Project Status rewrite:
- Cut the rollback bullet from 633 words to at most 80: the current and previous release per service, the rollback floor (API launch-9d5bd39, set by migration 20261112120000) and the image-retention caveat.
- Fix the stale lines 30–31.
- Replace the two 'Shipped' sections (about 52 lines) with the last 5 deploys, one line each, linking the change log.
- Move 'How to release' to the Runbook.
- Keep a hand-written 'Owner housekeeping' list for to-dos that are not gates (the Seoul secret, two-step sign-in, console spend limits, trial rules).
- Release Readiness Backlog split:
- Move the change log verbatim into Docs/changelog/2026-07.md and Docs/changelog/2026-11.md.
- Move the July ground-truth snapshot, 'Corrected findings' and 'Coverage gaps' to archive.
- Replace Tier 4 with one sentence pointing at ops/launch-evidence.json and `pnpm launch:check`.
- Refresh the header, and mark RGB-032 and RGB-033 as removed with the apps.
- Give the still-open Cleanup Review items their own RGB rows: the seven section-4 refactors and the still-open appendix items, including the operator ?token= and the /sessions/:id/state query ticket. Then move Docs/Cleanup Review.md to Docs/archive/ with an index row.
- Remove the three hand-written duplicate gate lists (Official 'Work that cannot be truthfully completed', Runbook 'External launch gates', Backlog Tier 4) and replace each with a link.
- Official Launch Readiness:
- New header naming what it owns, with a correct review date.
- Fix the stale statements: magic-link, recoverable deletes, installations, the /status placeholder, versions and shared views.
- Drop 'Implementation completed in this launch pass' (move it to the change log) and 'Release procedure' (to the Runbook).
- Keep the release ladder, the say/don't-say lists and the single data-inventory table.
- Commercial Platform Runbook becomes the operations runbook:
- Absorbs the release procedure and the rollback procedure, reconciled with release.sh.
- Drops the stale customer journey (help owns user-facing behaviour), its duplicate data table (Official owns it) and its gate list.
- Labels the SMTP how-to 'only if email sign-in is enabled'.
- Keeps its path, because 4 help articles cite it.
- Incident and Breach Exercise line 55 links to the Runbook's rollback section.
- Repoint references to moved text: the 3 evidence strings in ops/launch-evidence.json that cite the Backlog change log, and the citation in the eval JSON description. Add Docs/changelog/ to .gcloudignore.
- Archive Touchpad Writing Mode Implementation Notes.md.
- Add a 'recorded on 6 Nov before RGB-046/047; re-run required' caveat to Accessibility Audit and Browser Matrix.
- Refresh the Gesture Interaction Audit header.
- Fix the 5 broken links: 4 relative links in archive/, and make Security Headers mention the private Threat Model as plain text.
- New Docs/README.md index of about 30 lines: a topic-to-owning-doc table, plus the rule that recording a deploy means one change-log line and the Project Status live/rollback block.
- Drift guards:
- Move the scope-to-gate mapping out of launch-ready-check.mjs into scripts/lib/launch-scopes.mjs.
- New scripts/generate-status.mjs writes the pending gates per scope (id, owner, next step) into Project Status between markers.
- Extend `pnpm docs:check` to fail when that block is out of date, when a relative link in a tracked doc is broken, or when an active doc exceeds its size or line-length budget.
- Tests for all of this in scripts/test.
- Help touch-up: change help 12's sign-in sentence to match the Google-only pilot, and update `sources` frontmatter if any cited doc ever moves (the plan keeps every cited path).
- Optional, do later: release.sh promote appends {date, service, release, previous} to ops/deploys.jsonl, and the generator writes the 'Live now / Roll back to' block from it.

#### Out of scope

- The private, untracked Docs/Threat Model.md content.
- Rewriting Help Center content, or renaming help categories, slugs or the 'Desktop overlay' article (URLs are public). Help stays the canonical source for user-facing behaviour.
- Changing launch gate statuses or evidence verdicts in ops/launch-evidence.json. That is the owner's call. Only citation strings are repointed. The stale automated-regression evidence (2026-08-04, mentions the removed extension package) is flagged to the owner, not rewritten.
- evals/README.md (414 lines) and the eval report plumbing, which belong to the eval/CI item. Package READMEs are also out.
- Rewriting archived docs beyond fixing their 4 broken links.
- Content of the product vision spec, Voice Agent Architecture and Security Headers, beyond keeping them listed in the index.
- Editing applied migrations: the comment in 20261112120000 that cites Docs/Cleanup Review.md stays, and the file keeps its name under archive/.
- Running `launch:check:deployed` in CI (it needs gcloud credentials); the generated block uses only the offline ledger.
- Release tooling behaviour, except the optional Phase 5 append.
- Whether a public repo should keep the archived review's security findings (owner decision).
- The user's Claude memory files outside the repo.

#### Target structure

Docs/
- README.md (new, about 30 lines, about 2 KB): which doc owns which topic, the authoring rules, and how to record a deploy.
- Project Status.md (80 lines or fewer, 8 KB or less, no line over 800 characters). Owns what is live and where to roll back:
  - Live now: revisions, health, limits.
  - Roll back to: current and previous release per service, the rollback floor, image retention. 80 words or fewer.
  - Recent changes: last 5 deploys, one line each, linking the change log.
  - What is left: generated from ops/launch-evidence.json between markers.
  - Owner housekeeping: hand-written to-dos that are not gates, 8 or fewer.
- Release Readiness Backlog.md (150 lines or fewer, 40 KB or less). The RGB register only: Tiers 1–3 plus new RGB rows for the open refactors and doc items. No change log, no audit snapshot, no gate list.
- changelog/2026-07.md and changelog/2026-11.md (about 151 KB, moved verbatim, append-only). New entries are one line of 300 characters or fewer: date, release, services, RGB ids, what changed, rollback target.
- Official Launch Readiness.md (90 lines or fewer, 7 KB or less). Owns the release ladder, what each stage may promise or must not say, and the single data and retention inventory.
- Commercial Platform Runbook.md (130 lines or fewer, 10 KB or less). Operations runbook: production config, operational controls, smoke tests, release procedure, rollback procedure, page inventory, and an optional email/SMTP block. Path kept because help cites it.
- Gate evidence docs, one gate each, unchanged apart from status caveats: Accessibility Audit, Browser Matrix, Backup and Restore, Incident and Breach Exercise (links to the Runbook for rollback), Status and Incident Updates.
- Reference docs: Platform Support Matrix, Augmented Experience Vision and Interaction Spec, Voice Agent Architecture and Observability, Security Headers, Gesture Interaction Audit (header refreshed).
- Threat Model.md: private and untracked, not touched.
- help/: unchanged. The canonical user-facing source, generated to helpContent.ts.
- archive/: gains Cleanup Review.md, the Touchpad Writing notes, the Backlog's July snapshot, corrected findings and coverage gaps, and the 'Implementation completed in this launch pass' section from Official. The index is updated.

ops/
- launch-evidence.json: the only launch gate list (structure unchanged, 3 citations repointed).
- deploys.jsonl: optional Phase 5.

scripts/
- lib/launch-scopes.mjs (about 50 lines): scope-to-gate mapping extracted from launch-ready-check.mjs.
- generate-status.mjs (about 120 lines): writes the gate block in Project Status, with a --check mode.
- The docs check (extend generate-help-content.mjs or add check-docs.mjs, about 80 lines, run by `pnpm docs:check`) covers: freshness of the generated block, links in all tracked docs, and per-doc size and line-length budgets.
- test/docs-check.test.mjs.

Result: the active tracked top-level docs go from 605 KB / 82k words to about 130 KB / under 20k words. The change log (151 KB) and the Cleanup Review (308 KB) leave the active set but are kept.

Who owns each topic:
- What is live and where to roll back: Project Status.
- What is left for each stage: the ledger plus `launch:check`, shown in Project Status.
- Engineering gaps: the RGB register.
- What changed and when: changelog/ plus git log.
- What we may promise, and data retention: Official Launch Readiness.
- How to release, operate and roll back: the Runbook.
- Incidents: Incident and Breach Exercise.
- User-facing behaviour: help/.
- Supported channels and browsers: Platform Support Matrix.

#### Phases

1. **Phase 0: Baseline and safety net** (0.25 days): - Record the baseline: lines, bytes and words per doc; broken links; `launch:check --json` pass/total per scope (locally 8/21, 8/36, 8/45; deployed 21/21).
- Write a scratch script that will prove every change-log line survives the move.
- Read-only gcloud check of which revisions and images still exist (`gcloud run revisions list`, `gcloud artifacts docker images list`), so the new rollback block names only releases that can actually start.
   - *Safety:* No repo changes. The numbers become the acceptance baseline.
2. **Phase 1: Remove the hazard and the duplicate lists** (0.5 days): - Project Status: rollback bullet down to the current and previous pair, the floor and the image-retention caveat (80 words or fewer). Fix lines 30–31. Collapse the two 'Shipped' sections to 5 lines plus a link.
- Replace Official's 'Work that cannot be truthfully completed', the Runbook's 'External launch gates' and Backlog Tier 4 with one-sentence links to the ledger and `pnpm launch:check`.
- Fix Official's header and its stale statements (magic-link, recoverable deletes, installations, /status, versions and shared views), and the Runbook's journey and SMTP framing.
- Add the re-run caveats to Accessibility Audit and Browser Matrix.
- Fix the 5 broken links. Archive the Touchpad Writing notes.
- Point Incident and Breach Exercise line 55 at the shortened rollback block.
   - *Safety:* Docs-only, and no path that help cites changes. Must stay green: `pnpm docs:check` and `pnpm --filter @airboard/web build`, which runs the help generator. `launch:check` output unchanged. The owner reviews the new rollback block against the Phase 0 revision check.
3. **Phase 2: Split the Backlog and retire the Cleanup Review** (1 days): - Move Backlog lines 145–1,340 verbatim into Docs/changelog/2026-07.md and 2026-11.md, and add a pointer.
- Move the July snapshot, 'Corrected findings' and 'Coverage gaps' to archive. Refresh the header and the 'How to use' rules.
- Add RGB rows for the open Cleanup Review items: the seven section-4 refactors, the token-in-URL paths and the remaining doc items.
- Move Cleanup Review.md to Docs/archive/ and add an index row noting its commit (27886a2).
- Repoint the 3 ledger evidence strings and the eval JSON description. Add Docs/changelog/ to .gcloudignore.
   - *Safety:* The line-preservation script reports no difference between the old change-log lines and the new files. The ledger JSON stays valid. Must stay green: `pnpm test:scripts`, `pnpm eval:datasets`, `pnpm docs:check`. `launch:check` counts unchanged. Ship as one docs-only PR in a quiet window to avoid change-log merge conflicts with refactor PRs.
4. **Phase 3: One owner per topic** (1 days): - The Runbook gains 'Release' and 'Rollback' sections: Project Status 'How to release' and Official 'Release procedure' merged and checked against the release.sh header.
- The Runbook drops its customer journey (help owns it), its data table (Official owns it) and the SMTP prerequisite claim.
- Official keeps the ladder, the say/don't-say lists and the data inventory, and drops the July 'Implementation completed' section (move it to the change log).
- Write the Docs/README.md index with the ownership table and the deploy-recording rule.
- Help 12: fix the sign-in sentence, then run `pnpm docs:build`.
   - *Safety:* Cited paths stay put. `pnpm docs:check`, the web build and `pnpm lint` stay green. The owner reviews Official, because it feeds public copy. A grep for the stale phrases ('Active source of truth', 'magic-link is the deployed', 'remain recoverable', 'AIRBOARD_CHROME_EXTENSION_ENABLED', 'installations') across the active docs returns nothing.
5. **Phase 4: Drift guards** (1 days): - Move evidenceByScope and inheritedScopes into scripts/lib/launch-scopes.mjs; launch-ready-check imports them.
- New scripts/generate-status.mjs writes the pending gates per scope (id, description, owner, next) between `<!-- generated:launch-gates -->` markers in Project Status.
- Extend `pnpm docs:check` to fail when the block is out of date, when a relative link in a tracked doc is broken, or when an active doc goes over its budget (Project Status 8 KB / 80 lines, register 40 KB / 150 lines, Official 7 KB, Runbook 10 KB, no line over 800 characters outside changelog and archive).
- Tests for each failure mode in scripts/test/docs-check.test.mjs.
   - *Safety:* `launch:check --json` output is identical before and after for every scope, ignoring checkedAt. The existing launch-ready-check test stays green. No new CI job: the existing docs:check step picks up the new checks. Characterization tests first: a fixture ledger, its expected rendered block, and a broken-link and an over-budget fixture.
6. **Phase 5 (optional, do later): Deploy log written by release.sh** (1 days): - `release.sh promote` appends a JSON line (date, service, release, previous serving revision) to ops/deploys.jsonl.
- generate-status.mjs writes the 'Live now / Roll back to' block from it, plus a hand-set rollbackFloor field updated only with destructive migrations.
- A deploy then needs one change-log line, with no hand edits to Project Status.
   - *Safety:* The gcloud commands are untouched; DRY_RUN=1 prints the append. A renderer test against fixtures. Try it on one web-only deploy first. Can be skipped entirely: Phases 1–4 stand on their own.

#### Risks

- Information loss when moving or cutting. Contain it by moving text verbatim (archive, never delete) and by the scripted check that every old change-log line exists in Docs/changelog/*.md. The rollback history beyond the floor stays readable in the change log, where each deploy entry already names its rollback target.
- Wrong rollback guidance in the new short block. Contain it with the Phase 0 read-only gcloud check of which revisions and images exist, an explicit rollback floor, owner review, and Incident and Breach Exercise updated in the same PR.
- Breaking the help build or the web image. Help `sources` cite 7 Docs files and README, and the web build runs the help generator. Contain it by keeping every cited path. `pnpm docs:check` and the web build must pass in every phase.
- Evidence strings left pointing at moved text. launch:check does not validate them, so nothing would fail loudly. Repoint the 3 ledger strings and the eval JSON citation in Phase 2, and grep for 'Release Readiness Backlog.md (' afterwards.
- Merge conflicts with refactor PRs that append to the change log at the same time. Contain it with one docs-only PR per phase in a quiet window; after the split, every PR appends to changelog/2026-11.md.
- Habit drift. Agents, and the owner's memory notes outside the repo, still 'record the deploy' by editing the old places. Contain it with the Docs/README rules plus the Phase 4 size and generated-block checks, which fail CI when someone appends to the old shape. Updating the memory note is a one-line follow-up outside this repo.
- The generator turning into more plumbing (which the eval/CI item is trying to cut). Contain it by keeping it offline and deterministic (ledger only, no gcloud), under about 150 lines, reusing the launch-check mapping, and running it inside the existing docs:check step.
- Losing the owner decisions that live only in the Cleanup Review. Contain it by turning every open item into an RGB row before archiving, and keeping the archived file under the same name, which also keeps the applied migration's comment resolvable by name.
- Size budgets that block urgent fixes. Set them about 25% above the post-cut sizes, and leave changelog/ and archive/ unbudgeted.

#### Done when

- Active tracked top-level docs (excluding archive/, help/, changelog/ and the private Threat Model) total 150 KB or less and 25,000 words or fewer. Baseline: 605 KB and 82,354 words.
- Project Status is 80 lines or fewer, 8 KB or less, with no line over 800 characters. Its rollback section is 80 words or fewer, names no more than 3 releases plus the rollback floor, and names no API revision older than the floor (launch-9d5bd39).
- Release Readiness Backlog is 150 lines or fewer and 40 KB or less, and has no '## Change log' section.
- The phrases 'Work that cannot be truthfully completed', 'External launch gates' and 'Tier 4' appear in no active doc. 'What is left' exists once, as the generated block.
- None of these appear in active docs: 'Active source of truth', 'magic-link is the deployed', 'remain recoverable', 'AIRBOARD_CHROME_EXTENSION_ENABLED', 'owned installations'.
- Every line of the old change log (Backlog lines 145–1,340 at 27886a2) exists verbatim in Docs/changelog/*.md, shown by a scripted diff with no output.
- `pnpm docs:check` fails when the generated gate block differs from ops/launch-evidence.json, when a relative link in any tracked doc is broken, or when an active doc goes over its budget. Each case has a test in scripts/test.
- Zero broken relative links in tracked docs. Baseline: 5.
- Unchanged and green: `pnpm docs:check`, `pnpm test:scripts`, `pnpm lint`, `pnpm --filter @airboard/web build` and `pnpm eval:datasets`. `launch:check --json` gives the same pass/total per scope as the Phase 0 baseline.
- Every topic in the Docs/README ownership table has exactly one owning doc. Help articles still cite only existing paths.
- Over the next 3 deploys, recording a deploy changes 2 lines or fewer of hand-written docs: one change-log line plus the Project Status live/rollback block. Baseline: about 5–20 lines across 2–3 files per deploy.

#### Depends on

None of the other six items blocks this one. It should go first, or alongside them, because each refactor adds RGB rows and change-log entries. After Phase 2 they write into a 40 KB register and a monthly change-log file instead of the 183 KB Backlog.

- **Board-file split, renderer split and API route splits:** help `sources` cite AirboardPrototype.tsx, controlPlaneRoutes.ts, server.ts and boardShareRoutes.ts, so those refactors must update help frontmatter and run `pnpm docs:build`. docs:check already enforces this. The file:line evidence in RGB rows and in the Cleanup Review will go out of date. Archiving the review with its commit hash (Phase 2) avoids presenting stale line numbers as current.
- **Token-in-URL removal:** Project Status says "No sign-in token is read from a URL (RGB-016)", but the operator `?token=` and the /sessions/:id/state query ticket are still accepted. Phase 2 opens an RGB row for them, so that item closes one row instead of editing four docs. It also changes Security Headers and Threat Model references, which is that item's work.
- **Shape-model merge:** no doc dependency beyond help and spec updates, which that item owns.
- **Stylesheet layers:** none.
- **Eval/CI plumbing:** both edit scripts/ and the CI workflow. The new checks go inside the existing `pnpm docs:check` step, with no new job, and evals/README.md belongs to the eval item. Coordinate so the eval cleanup keeps scripts/launch-ready-check.mjs and the new scripts/lib/launch-scopes.mjs.
- **Phase 5:** touches infra/cloud-run/release.sh. Do it only once no other item is changing release tooling.

### Merge the two shape models

**Analyst verdict:** Do soon · about 12 engineer-days as first scoped.

Worth doing, in order.
- Phases 0-1 (characterize, then make Airo write v2 only) take about 5 days, need no data migration, stop new legacy data from accumulating, and remove the split's bugs for every new diagram. Start them next: after the pending real-microphone-and-camera check of RGB-049, and before the board-file split's hook-extraction step and the renderer split.
- Phase 2 rewrites saved boards and bumps the live-session scene version. It needs explicit owner sign-off on the data migration, a backup of latest_state and a read-only count first, so it is "soon" rather than "now".
- If the owner won't fund all of it, the smaller step is Phases 0-1 alone. Old boards keep their legacy nodes and their bugs, but all new content is one model.

#### Today

Measured on codex/production-readiness at 27886a2 (12 Nov 2026, after the Touchpad Writing removal):

STORAGE. BoardState holds both `strokes` and `elements` (packages/core/src/types.ts:673-684). The reducer copies every committed stroke into `elements` under the same id with `legacyStrokeId` (boardReducer.ts:120, 389, 535-547). That copy is a hidden mirror. The renderer and hit tests skip it while the stroke exists, so a patch to the mirror changes nothing visible. Airo's nodes are therefore stored twice. The adapter boardSceneElementFromLegacyStroke (sceneElements.ts:349) loses data:
- v2 ConnectorElement has no `routeOffset` (types.ts:481-495), so parallel or reciprocal arrows would overlap.
- Legacy groups (`groupMemberStrokeIds`) become plain rectangles.
- Provenance (`source`, `confidence`) is dropped.

PRODUCERS. Only one live path still writes strokes: the diagram command planner, used by both the AI planner and the older typed grammar.
- planCreateNode → createStroke (diagramCommands.ts:688-711), planConnectNodes (713-748), group (1002-1040) and duplicate (1098-1126).
- commitPlacementObject and createCommittedAnnotation (AirboardPrototype.tsx:4218-4300) are dead: no dock id is a `tool:` id (placementToolFromDockTarget, 638).
- Touchpad and air-writing were removed on 12 Nov (9d5bd39), and freehand drawing already commits v2 `drawing` elements.

DUPLICATION.
- applyDiagramCommand switches on 15 legacy verbs plus 10 `scene.*` twins, which form 10 parallel pairs (diagramCommands.ts:355-428). The planner is 1,635 lines and its scene twin, sceneDiagramCommands.ts, is 409.
- There are 84 bridge or filter references (legacyStrokeId, isSceneOnlyElement, isLegacyStrokeSceneCopy, gestureTargetWorld, splitByWorld, sceneOnlyNodes, pointedLegacyStrokeIds) across 14 source files: 21 in AirboardPrototype.tsx, 14 in intentPipeline.ts and 6 in renderer/hitTest. 29 test or e2e assertions check which model a shape is in.
- Per-file references to strokes/annotation/filters: AirboardPrototype 25/81/21, intentPipeline 19/60/14, renderer 10/88/5, diagramCommands 6/200/2.
- The component keeps doubled state:
  - selectedAnnotationId(s) and selectedElementId(s)
  - hoverStrokeId and hoverElementId
  - editingAnnotationId plus labelDraft, versus SceneTextEditor
  - UndoAction legacy `stroke`/`erase` variants plus 6 scene_* variants (356-395)
  - three erasers: eraseAt (4023), eraseSceneDrawingsAt (2686) and eraseSceneElementsUnderHand (5000)
- renderer.ts (2,928 lines) has a second painter of about 850 lines (drawStroke 584, drawAnnotationStroke through the annotation selection outline 1754-2630, plus 2741-2821).
- hitTest.ts spends about 170 of its 365 lines on annotations.
- spatialQuality.ts (822 lines) reads only strokes and is imported only by its own test.
- gestureAnnotationMode.ts (765 lines) survives mainly for the v2 placement ghost and the ObjectDockTool type.
- Two grammars run in sequence: intentCanvasParser.ts (1,451 lines, about 25 legacy command kinds) and sceneIntent.ts (931).

CHURN AND COST (git log --since=2026-10-01): AirboardPrototype 30 commits; diagramCommands, sceneDiagramCommands, sceneIntent, semanticPlan, intentPipeline, renderer and types 3 each. All 3 sceneDiagramCommands commits were bridging work, because the file was created on 7 Nov to bridge the split. Bridging commits in 5 days:
- 376f31e (RGB-039): +1,110 / -118 across 14 files
- a65583b: +430 / -81
- 166f757: hand targets for both models, including +247 in gestureObjectManipulation
- 928def2 (RGB-049): 49 added bridge lines
That is about 1,800 lines added to make one product behave as one.

BUGS TRACED TO THE SPLIT.
- RGB-039 (live, 7 Nov): Airo was blind to typed and toolbar shapes and drew a duplicate "API" box.
- Hands-free audit gap 2 had four failures:
  - hands couldn't grab or erase v2 shapes
  - voice couldn't edit Airo-drawn shapes by name
  - a small wording change decided which model a shape landed in
  - voice couldn't group the two models together
- RGB-049 review: "this/it" resolved to a hidden mirror, so the command applied to nothing. The fix is at AirboardPrototype.tsx:2876-2883 and pointedLegacyStrokeIds at about 11834.
- Caveat: the backlog says the five-area review had 20 confirmed findings but itemizes none of them. The Cleanup Review's claim that "most" came from the gap can't be checked from the repo. Only these fingerprints can.

Still live today:
- A spoken group that mixes Airo shapes with toolbar or typed shapes is refused (intentPipeline.ts:615). Help article 17-limits:32-34 documents this.
- The fast-rule "select all" selects only v2 shapes and clears Airo-node selection (AirboardPrototype.tsx:3149-3157, selectSceneElements 1827-1833).
- Selection stays in one model at a time (comments at 7133-7134 and in the RGB-049 dwell select), so the refusal's advice "Select them and use the toolbar" can't work for mixed shapes. This is plausible from the code; I did not run it.
- SceneContextToolbar is driven by selectedElementId only (1309, 10615), so Airo-drawn shapes likely get the label editor rather than the colour and arrange toolbar. Also plausible, not run.

PERSISTENCE.
- Saved boards: boards.latest_state JSON, saved through PATCH /boards/:id with a compare-and-swap version. The server doesn't validate the shape.
- Live sessions: event-sourced in board_events, kept indefinitely and replayed with the core reducer (supabaseSessionStore.ts:337-349).
- The WebSocket requires an exact sceneVersion match (server.ts:676). The web shows "outdated" on UPGRADE_REQUIRED (boardSync.ts:656).
- The element validator ignores unknown fields (sceneValidation.ts:91-145), so a new optional connector field is forward-compatible.
- snapshotBoardEvents re-emits strokes when a live session starts (boardSync.ts:767-810).

EVALS. semantic-grounding-eval.mjs (28 refs) and interaction-eval-harness.mjs (31) assert on state.strokes.

UNKNOWN. How many production boards hold legacy strokes. This was a read-only code analysis, so it needs a read-only SQL count.

TEST BASELINE. core 87, drawing-engine 39, web 499 unit tests, 120 e2e test() blocks; no screenshot tests exist.

#### Need

The product's core loop is "say it, then fix it by hand or by name". That loop sits on this seam, which has produced a bug or a dead end with every feature that touched shapes in the last week:
- RGB-039
- gap 2 of the hands-free audit
- the RGB-049 hidden-mirror finding
- three issues still live: the mixed-group refusal, voice select-all skipping Airo shapes, and single-model selection
Nothing on screen tells a presenter which kind of shape they are looking at, so these failures feel random.

Cost of not doing it:
- Every new shape capability is written twice (10 verb pairs today) and needs bridge code in grounding, hands, undo, rendering and hit tests. About 1,800 bridge lines went in during 7-11 Nov alone.
- Each bridge adds another filter site; there are 84 today, and each one forgotten is a new "half-works" bug.
- Every diagram Airo draws in the pilot adds more legacy data that a later migration must convert.
- The board-file split and renderer split would move about 2,000 lines (the component's annotation state, undo, erase and label editor, plus the second painter) that should be deleted instead.
- The lossy adapter means any later migration done under time pressure risks losing reciprocal-arrow lanes and group membership.

#### In scope

- A model-agnostic diagram projection in core (nodes, edges, sections; reads both models) used by tests and evals, generalizing semanticBoardNodes
- Retargeting semantic-grounding-eval.mjs, interaction-eval-harness.mjs and the 29 test/e2e assertions about which model a shape is in, so they assert on the projection
- Per-verb parity tests for the 10 legacy/scene verb pairs, and a Playwright screenshot fixture covering every annotation type (the 13 node types, connector, arrow, reciprocal connectors, group, sticky, text_label, highlight)
- Deleting dead legacy entry points: commitPlacementObject, createCommittedAnnotation, placementToolFromDockTarget and the drag MIME path, plus spatialQuality.ts (stroke-only, test-only)
- Planner writes v2 only: node.create, nodes.connect, group and duplicate emit element.* events through planner.sceneSink(); node-type-aware endpoint snapping moves into connectElements
- Adding an optional routeOffset (parallel-lane offset) to ConnectorElement, honoured by sceneConnectorGeometry, the renderer and hit tests
- A lossless legacy converter in core (packages/core/src/legacyStrokeMigration.ts) for saved snapshots and for replaying stored or old-peer stroke.* events (committed, label_updated, annotation_updated, erase, deleted, restored)
- Applying the converter at every read: AuthenticatedAirboard normalizeBoardState, sharedBoard.ts, ViewOnlyBoard, API supabaseSessionStore.getState and snapshotBoardEvents
- BOARD_SCENE_VERSION 2→3 with a two-step API gate (accept {2,3}, then 3 only)
- An optional service-role backfill script for boards.latest_state with --dry-run diff output, run only with owner approval and after a backup
- Deleting the legacy path: legacy verbs and the CommandPlanner's stroke methods, splitByWorld and stroke branches in intentPipeline, the second painter and annotation hit tests, gestureAnnotationMode (kept only as a v2 ghost builder), annotation selection, hover, label editor, ObjectInteraction, eraseAt and stroke/erase undo variants in the component, the `world` field and every legacyStrokeId/isSceneOnlyElement check, and `strokes` in BoardState
- The API validator stops accepting new stroke.* writes once only v3 clients connect
- Updating the help articles and the Cleanup Review entry that describe the group limitation and the split

#### Out of scope

- Merging the two natural-language grammars (intentCanvasParser.ts vs sceneIntent.ts); only the shape model they write changes. Grammar consolidation is its own item
- Removing the preview-and-confirm scaffolding in the intent pipeline (eval/CI item)
- Splitting AirboardPrototype.tsx, renderer.ts or the API route files (separate items; this one only deletes code inside them)
- Removing stroke.* replay for historical board_events: a small adapter stays because event rows are kept indefinitely
- The local-only activeStrokes freehand preview buffer (already v2 on commit); renaming it is cosmetic
- New features beyond what the convergence gives for free (mixed grouping, a full toolbar for Airo shapes); no new UI
- Changing the planner API, the prompt or the semantic plan schema (the API is already model-agnostic)
- The duplicated geometry and label-helper cleanup, except where a helper dies with the legacy path
- Rewriting board_events rows in the database

#### Target structure

One model: BoardState = { boardId, sceneVersion: 3, elements, activeStrokes (local freehand preview only), eraseActions, participants, cursors, lastSequence }; the Stroke and StrokeAnnotation types live only in a LegacyBoardState input type.

packages/core:
- legacyStrokeMigration.ts (new, ~250 lines): migrateLegacyBoardState() and legacyStrokeEventToElements(). This is the only module that reads StrokeAnnotation.
- boardReducer.ts: 574 → ~380; element.* only, with stroke.* routed through the adapter.
- sceneDiagramCommands.ts: 409 → ~550; it gains create-node, connect with routeOffset and node-type-aware snapping, and becomes the single verb set.
- diagramCommands.ts: 1,635 → ~550; dispatcher, planner, align and layout; one verb per operation, with no scene.* twins.
- sceneElements.ts: loses the mirror adapter (~120 lines move to the migration module).
- types.ts: gains ConnectorElement.routeOffset and loses `strokes` and legacyStrokeId.

packages/drawing-engine:
- renderer.ts: 2,928 → ~2,050; one painter, ghost previews drawn as v2 elements, freehand preview kept.
- hitTest.ts: 365 → ~190.
- spatialQuality.ts: deleted (822 lines).

apps/web/src/features/board:
- gestureAnnotationMode.ts (765) → placementGhost.ts (~150, with the ObjectDockTool type).
- intentPipeline.ts: 3,113 → ~2,650.
- semanticBoardObjects.ts: 111 → ~80, with no `world` field.
- gestureObjectManipulation.ts: one target list.
- AirboardPrototype.tsx: about 1,000 lines shorter (one selection, hover and text editor; UndoAction without stroke/erase variants; one eraser).

apps/api:
- boardEventValidation.ts: rejects new stroke.* writes.
- server.ts: the scene-version gate accepts 3.

Net: at least 3,500 lines deleted, and 0 bridge references outside legacyStrokeMigration.ts.

#### Phases

1. **Phase 0: characterize, then delete dead legacy entry points** (2 days): Add boardDiagramGraph(state) to core: nodes with id, label, shape and bounds; edges with from, to, label and style; sections. It reads both models. Retarget semantic-grounding-eval.mjs, interaction-eval-harness.mjs and the 29 model-specific test/e2e assertions to it. Add parity tests: each of the 10 verb pairs runs on a legacy fixture and on its converted twin, and the projections must match. Add a Playwright screenshot fixture, behind the existing test-hook gate, with one board holding every annotation type. Delete commitPlacementObject, createCommittedAnnotation, placementToolFromDockTarget and spatialQuality.ts plus its test.
   - *Safety:* No runtime behaviour changes, only dead code goes. All unit suites, the e2e suite, lint, typecheck and the build-time contract scripts stay green, and eval:pr, the semantic and voice evals keep the same pass rates. The projection must equal today's stroke-based assertions on every eval fixture before the old assertions are removed.
2. **Phase 1: Airo writes v2 only** (3 days): planCreateNode emits element.created (a shape with its catalogue shapeKind, the same bounds and colours) through planner.sceneSink(). planConnectNodes and connection.attach go through connectElements, with node-type-aware endpoint snapping moved there. Add the optional ConnectorElement.routeOffset and draw lanes in sceneConnectorGeometry and the renderer; old clients ignore the field, because the validator tolerates unknown fields. group and duplicate route to scene.group and scene.duplicate when every target is v2. Legacy nodes already on boards are untouched, and mixed old-legacy plus v2 groups stay refused until Phase 2. Update the e2e specs that assert new Airo shapes are legacy.
   - *Safety:* An intended, user-visible fix: new Airo shapes gain hands, the toolbar, grouping and select-all, and diagram content must not change. The projection snapshots for the grounding, voice-intent and interaction corpora stay identical. The semantic, voice and grammar evals keep their pass rates. The owner reviews and approves the screenshot diffs. The RGB-049 real-device check is repeated. No data migration and no version bump; rollback is a web redeploy.
3. **Phase 2: upgrade old boards and live sessions on read (version-gated)** (3 days): Write legacyStrokeMigration.ts. migrateLegacyBoardState converts each legacy type: node to shape (nodeType mapped to shapeKind), connector or arrow to a bound connector with routeOffset, group to a section with members' sectionId, sticky, text, and highlight or marker to drawing. It drops strokes and mirrors and is idempotent. A reducer adapter maps stored or old-peer stroke.* events onto the converted element. Apply both at every read: normalizeBoardState, sharedBoard, ViewOnlyBoard, API getState and snapshotBoardEvents. Bump BOARD_SCENE_VERSION to 3. Deploy the API accepting {2,3}, then the web; after about 24 hours, redeploy the API accepting only 3, so stale tabs show 'outdated' and reload. Saved boards are rewritten on their next save. Optionally, run a service-role backfill after a read-only count, a latest_state backup, a --dry-run projection diff and owner approval.
   - *Safety:* The owner signs off on the data migration before it ships. A property test asserts that migrating the old reducer's output equals the new reducer's output, over the eval corpora and recorded live-session logs. Converting twice is a no-op. The read-only production count is taken before and after. Rollback is the web first, then the API; the previous release already reads and edits v2 elements, and the backup restores rewritten boards.
4. **Phase 3: delete the legacy path** (4 days; implemented 12 Nov 2026, not yet deployed: see step 5's status in the recommended order): Remove the legacy verbs and the CommandPlanner's stroke methods from diagramCommands. Remove splitByWorld, splitMoveByWorld and the stroke branches in intentPipeline. Remove the second painter and the annotation hit tests. Reduce gestureAnnotationMode to placementGhost.ts. In the component, remove annotation selection, hover, the label editor, ObjectInteraction move/resize, eraseAt, and the stroke/erase UndoAction variants. Remove the `world` field and every legacyStrokeId/isSceneOnlyElement/gestureTargetWorld check. Drop `strokes` from BoardState. The API validator rejects new stroke.* writes, while the reducer adapter still replays stored ones. Update the help articles and the Cleanup Review.
   - *Safety:* Pure deletion behind Phase 2's version gate; no behaviour change. tsc --noUnusedLocals is clean. All suites, evals and the screenshot fixture are unchanged. Bridge references must grep to zero. Ship this as several small PRs (core, drawing-engine, web pipeline, component) so each can be reverted alone.

#### Risks

- Diagrams Airo drew will look slightly different once converted. Label placement, connector routing, reciprocal lanes, node types saved before the catalogue existed, and groups that become sections are the most visible changes. Containment: the screenshot fixture covering every annotation type, routeOffset added to v2 connectors before any conversion, and owner approval of before/after images in Phases 1 and 2.
- Data loss when converting saved boards; today's adapter already drops routeOffset, group membership and provenance. Containment: a lossless converter with the round-trip property test, a dry-run backfill reporting projection diffs, a latest_state backup before any write, idempotence, and the read-only count before and after.
- Live sessions with old and new tabs during rollout: an old tab edits its hidden mirror, so its changes are invisible to new tabs and the reverse. Containment: the scene-version gate (API accepts {2,3} only for the deploy window, then 3 only, which forces stale tabs to reload through the existing 'outdated' path), and the reducer adapter that maps old-peer stroke.* events onto elements.
- Evals and e2e that assert the legacy structure go red in Phase 1 and hide real regressions. Containment: Phase 0 retargets them to the projection and proves the projection equal on the current code first.
- Legacy verbs carry behaviour the scene twins may lack: node-type endpoint snapping (connectorEndpoints), expanding a group selection (expandSelectedGroups), duplicating with remapped connectors, re-attaching connectors. Containment: per-verb parity tests in Phase 0, before any producer is switched.
- Rollback order: once the API accepts only 3, rolling the web back below Phase 2 also needs the API rolled back to the {2,3} release. Containment: document it in the deploy record, following the existing 'web first' recipe.
- Merge conflicts with the board-file split, renderer split and eval-plumbing work, which edit the same files. Containment: agree the order (see dependencies) and keep each phase to small PRs.
- RGB-049's hand and voice paths haven't been tried with a real microphone and camera, and Phase 1 changes which model they act on. Containment: run the real-device check before Phase 1 and repeat it after.

#### Done when

- grep -rn 'legacyStrokeId|isSceneOnlyElement|isLegacyStrokeSceneCopy|gestureTargetWorld|splitByWorld|sceneOnlyNodes|pointedLegacyStrokeIds|state.strokes' over apps/*/src and packages/*/src returns 0 outside packages/core/src/legacyStrokeMigration.ts (84 today)
- applyDiagramCommand has one verb per operation: no scene.* twins and no legacy stroke verbs (10 parallel pairs today)
- BoardState has no `strokes` field; BOARD_SCENE_VERSION is 3; the production API accepts only sceneVersion 3
- Read-only production query: 0 boards whose latest_state.strokes holds committed annotation strokes (after backfill, or after every pilot board has been saved once)
- Voice 'Airo, group the user, the API and the box I added' groups shapes from Airo, the toolbar and typed commands (refused today at intentPipeline.ts:615); help 17-limits no longer mentions the limitation
- Voice 'select all' selects every visible shape, Airo-drawn included; mouse shift-click and hand dwell can select Airo and toolbar shapes together
- Selecting an Airo-drawn shape shows the same SceneContextToolbar as a toolbar shape
- Converting a board twice is a no-op, and the round-trip property test passes on every eval corpus and recorded live-session log
- All unit suites (core, drawing-engine, gesture-engine, API, web, scripts), lint, typecheck, the build-time contract scripts and the e2e suite are green; eval:pr, the semantic, voice-intent and grammar evals keep their pre-refactor pass rates; owner-approved screenshot fixture
- Net deletion of at least 3,500 lines across core, drawing-engine and the web board (diagramCommands ≤ ~600, renderer ≤ ~2,100, spatialQuality.ts gone)

#### Depends on

- **Board-file split:** do Phases 0-3 before the split's step 3 (hook extraction). Phase 3 deletes about 1,000 lines of the component (annotation selection, label editor, ObjectInteraction, eraseAt, legacy undo) that the split would otherwise move into useSceneEditing and boardHistory. Split step 1 (moving pure helpers) can run in parallel, and the build-time contract scripts don't reference annotation code.
- **Renderer split:** do it after Phase 3, which removes the roughly 850-line second painter. If the renderer split must go first, its first move should put the legacy painter in its own file so Phase 3 deletes one file.
- **API route splits:** weak coupling. Phase 2 touches server.ts (scene-version gate), boardEventValidation.ts and supabaseSessionStore.getState, so sequence the server.ts split around Phase 2 to avoid conflicts.
- **Token-in-URL removal:** no functional dependency. Both change the eval harness (interaction-eval-harness reads state.strokes and uses ?token=), so land them one after the other.
- **Stylesheet layers:** none beyond Phase 3 deleting the floating label editor's CSS.
- **Eval/CI plumbing:** strongest link. Phase 0 retargets the grounding and interaction evals, which are the gate for Phase 1. Agree which evals survive the trim first, or do the trim first, so dead reports aren't retargeted.
- **Docs:** update help 05-airo-voice, 06-gestures and 17-limits after Phases 1 and 3, record the Phase 2 data-migration approval and rollback order in the backlog and deploy log, and refresh the Cleanup Review appendix, whose numbers are already stale.

### Split the board file

**Analyst verdict:** Do soon · about 14 engineer-days as first scoped.

The cost is real and recurring, and it has caused two confirmed defects. But the risky half (voice, camera, hands) has no real-device CI coverage and was shipped on 11 Nov without a live microphone or camera check. Start phases 0-2 now: about 4 days, near-zero runtime risk, and they shrink the file by about 2,600 lines and add the safety net. Do phases 3-4 next. Hold phases 5-6 until RGB-049 has had its real-device check and the shape-model merge is decided, so the legacy annotation code isn't moved only to be deleted. If the owner wants only a small step, phases 0-2 alone are worth doing.

#### Today

Measured on codex/production-readiness at 27886a2, 12 Nov 2026.

SIZE: 12,521 lines and 486 KB (about 120k tokens). The cleanup review counted 15,422 lines; the 12 Nov removals of Meet, desktop and Touchpad code brought it down. The file has five parts:
- Imports: lines 1-278.
- Module-level types, constants and small functions: 279-692 (414 lines).
- Props: 693-762.
- The single exported component: 763-11,326 (10,564 lines).
- Pure helpers with no React: 11,328-12,521 (1,194 lines).
Inside the component there are 80 useState, 150 useRef, 139 useCallback, 59 useEffect and 8 useMemo calls, with 364 `Ref.current =` writes. Fourteen refs hold callbacks declared further down, so that callbacks can call each other in a cycle. One of them, prepareIntentCommandRef (910, 6469), is written and never read.

LARGEST BLOCKS: handleGesture 560 lines (5039), prepareIntentCommandWithSemantic 515 (6496), executeSceneIntent 511 (2854), startVoiceCommand 323 (7870), processRawLandmarkFrame 294 (8849), prepareSemanticActionPlan 243 (6130), the keyboard effect 215 (9275), undoLastAction 189 (5607), and the test-hook effect 185 (7660).

RESPONSIBILITIES (current line ranges):
- Setup: state, refs, React-free trackers, trace reporters, preferences, panel and notice helpers (763-1502).
- Render, image resolution, persistence and local/remote/resync apply (1503-1826).
- Scene element editing: select, patch, delete, create, mind map, media, links, drawing, move (1827-2853).
- Scene intents and fan-in (2854-3448).
- Viewport (3449-3535).
- Appearance, screen underlay, studio recording, camera underlay and onboarding (3536-3807).
- Live-session bootstrap and sync (3808-4010).
- Legacy annotation strokes and object interaction (4011-4690).
- Dock gesture and hand-gesture handling (4691-5598).
- Undo/redo (5599-5903).
- Typed and semantic intent pipeline (5904-7208).
- Voice routing: gates, decisions, transcripts (7209-7615).
- Test hooks (7616-7844).
- Voice session start (7845-8196).
- Camera lifecycle, recovery, auto-start and tab ownership (8197-8624).
- Share, live-link controls and export (8625-8703).
- Speech and intent config loading (8704-8789).
- Landmark frames, the detection loop and gate expiry (8790-9274).
- Keyboard (9275-9508).
- Pointer, wheel, tool activation and catalog drop (9509-9999).
- Title and delete (10000-10076).
JSX runs 10077-11326:
- Delete dialog: 10079-10119
- Top bar and menus: 10138-10400
- Airo panel: 10410-10578
- Undo, redo, hide and CreationToolbar: 10637-10783
- Notices: 10784-10871
- Canvas, video and inline editors: 10872-10973
- Settings drawer: 10974-11325

COUPLING (script over the source):
- 32 of the 223 state values and refs are touched in 5 or more of these regions: boardRef in 16, canvasRef 12, boardViewportRef 10, undoStackRef 9.
- At region level, which callbacks call which forms a DAG, apart from one setup<->camera edge that already goes through a ref. The base layer is render/persist/apply, then scene editing, then scene intent, viewport and legacy annotations, then undo, then gestures and intents, then voice, camera and input, then test hooks. So extracting in layers is feasible.

CHURN:
- 30 commits since 2026-10-01, all between 4 and 12 Nov. 9 of them are fixes.
- +5,558 / -6,194 lines.
- A commit that touches this file changes 34 files on average.
- git blame: 33% of today's lines were written since 1 Nov. Hottest areas: JSX 78%, camera lifecycle 72%, hand/dock gesture 65%, voice session 60%. Coldest: scene editing 7%, legacy annotations 7%, landmark frames 8%, keyboard 4%, test hooks 5%.

TESTS:
- No unit test imports the component. Only the component is exported, and node --test cannot load TSX.
- 13 of the 23 e2e specs drive it through window.__airboardTestHooks: 22 methods, with each spec declaring its own ad-hoc type.
- Two build-time scripts and one unit test read the file's source as text, so `next build` fails if the markers move:
  - verify-automated-command-contract.mjs also slices the coordinateRawLandmarkFrame call.
  - verify-camera-layer-contract.mjs.
  - gestureFrameCoordinator.test.mjs:263-284.
- The raw camera path has no behavioural CI coverage:
  - The emitRawLandmarkFrame hook is used by no spec.
  - gestureVideoReplay skips because it has no fixture.
  - realDeviceMedia skips without hardware.
  - RGB-049 is still "not yet tried with a real microphone and camera".
- ESLint reports 0 warnings, with 4 exhaustive-deps disables.

FINDINGS TRACED TO THE MONOLITH:
1. Cleanup Review "Production plan grounding and config retry diverge from the tested helpers": groundSemanticPlan, added in RGB-049, had no production caller, so users got untested behaviour. Fixed in a4c7947, but scripts/lib/semantic-grounding-eval.mjs:181 still "intentionally mirrors" prepareSemanticActionPlan.
2. abc3725: Airo plans, compound commands and their undo never scheduled a save. It was found only in the live sign-up journey.
3. About 2,000 lines of Meet, desktop and Touchpad code reachable only from the test harness, plus dead state (lastGestureIntent's setter called 6 times and never read), lived here unnoticed until 12 Nov. Still present today: the write-only ref above, and placementToolFromDockTarget, which always returns null.
The 20 RGB-049 review findings are not itemised by file in the repo. The audit's gap 2 (shapes made one way only half-work) belongs to the shape-model merge, not this split.

#### Need

Every board feature lands in this one file: 30 commits in the last 9 working days, 9 of them fixes. It costs three things.

(1) Logic written here can't be unit tested. So it gets tested only through e2e, or it gets copied into a tested helper or an eval mirror that drifts from production. That has happened twice and been confirmed: the grounding and retry divergence, where tests guarded code users never ran, and the eval's mirror of prepareSemanticActionPlan, which is still there.

(2) Shared concerns live in many places, so one path gets missed. A save that wasn't scheduled after Airo and undo shipped to production (abc3725), because each mutation path schedules persistence itself.

(3) Agents and reviewers can't hold the file. At about 120k tokens, every change is grep-and-slice, which is how dead refs, always-null paths and a whole surface of harness-only Meet code went unnoticed.

The hottest code is also the least covered: hands at 65% rewritten since 1 Nov, voice at 60% and camera at 72%. The shape-model merge, the stylesheet split and the eval clean-up all have to reach into this file, and each gets harder while it stays whole.

Cost of not doing it: each new hands-free or Airo change keeps a roughly 1-in-3 chance of being a follow-up fix (9 of 30). The merge has to find legacy code spread across 9 regions. And new pure logic keeps landing untested inside the component.

It does not block the pilot. Nothing is broken today because of the file's size.

#### In scope

- AirboardPrototype.tsx only: move its code verbatim into new modules under apps/web/src/features/board/ (subfolders engine/, document/, scene/, history/, viewport/, media/, intent/, voice/, input/, ui/, testing/)
- Move the module-level pure helpers (11328-12521) and the internal types and constants (279-692) into .ts modules, with node --test unit tests for the riskiest ones: scene target resolution, connector rebind and move changes, rename patches, undo/redo steps
- Extract the JSX into subcomponents with plain props: top bar, Airo panel, settings drawer, history/dock controls, notices, delete dialog
- Extract custom hooks in dependency order, sharing one typed BoardEngine ref object plus a typed engine.commands slot. This replaces the 14 ad-hoc forward-declared callback refs
- Pull the React-free core out of the biggest callbacks (executeSceneIntent, undo/redo, semantic plan execution, handleGesture) into pure modules or controller classes, following the existing HoldToEditTracker and VoiceCommandRouter pattern
- Retarget the three source-text guards (verify-automated-command-contract.mjs, verify-camera-layer-contract.mjs, gestureFrameCoordinator.test.mjs) to the board directory, or to the file that holds each marker
- One exported AirboardTestHooks type, imported by all 13 e2e specs that use the hooks. The window.__airboardTestHooks name, its 22 methods and their return shapes stay unchanged
- Characterization tests added first: a raw-landmark e2e through emitRawLandmarkFrame, a golden-journey board-state fingerprint, and a DOM snapshot of the board shell
- Set react-hooks/exhaustive-deps to error for apps/web/src/features/board/**
- Point scripts/lib/semantic-grounding-eval.mjs at the extracted production module instead of its mirror
- Delete the two dead leftovers found while measuring (the write-only prepareIntentCommandRef, and the always-null placementToolFromDockTarget branch) in their own commit
- Update the help article sources lists and the Cleanup Review section 4 numbers at the end

#### Out of scope

- Any behaviour, copy, layout, class-name, data-testid or aria change. Bugs found while moving go to the backlog as separate commits
- The shape-model merge itself (deleting legacy strokes, annotation state and legacy UndoAction variants). This split only quarantines that code
- Moving or splitting CSS (the stylesheet-layers item); class names stay as they are
- Splitting the other large board modules: intentPipeline.ts (3,113 lines), realtimeSpeech.ts (1,492), intentCanvasParser.ts (1,451)
- Renaming the component or its file path (help sources and the shell keep the AirboardPrototype.tsx path)
- Adding a state library (Zustand/Redux), React context for the engine, React Testing Library or jsdom
- Performance work or memoization (any re-render reduction is incidental)
- API, database, or live-link URL format changes

#### Target structure

apps/web/src/features/board/, with rough sizes:

- AirboardPrototype.tsx (about 1,500-1,900 lines): props, createBoardEngine, cross-cutting UI state, the hooks called in the original region order, layout JSX that keeps the canvas, video and inline editors that own DOM refs.
- engine/:
  - boardEngine.ts (about 200): the BoardEngine type, grouped refs (doc, selection, viewport, media, voice, input) and the typed commands registry.
  - boardTypes.ts (about 350): types and constants from lines 279-692.
- document/:
  - useBoardDocument.ts (about 350): render, scene image resolution, persistence scheduling and flush, and publish/apply local, remote and resync. This becomes the single mutation entry point.
  - useBoardSession.ts (about 250): live-session bootstrap and live-link controls.
- scene/:
  - sceneGeometry.ts (about 450, pure)
  - sceneTargets.ts (about 250, pure)
  - sceneIntentPatches.ts (about 300, pure)
  - useSceneEditing.ts (about 1,000)
  - sceneIntentExecution.ts (about 400, pure) plus useSceneIntentExecution.ts (about 250)
- history/:
  - boardHistory.ts (about 350, pure): UndoAction, undo and redo steps, restore events.
  - useUndoRedo.ts (about 120)
- viewport/useBoardViewport.ts (about 120).
- media/:
  - useLightboardMedia.ts (about 300): theme, scrim, screen underlay, recording.
  - useCameraLifecycle.ts (about 450): start, stop, recovery, detection loop.
- intent/:
  - semanticPlanExecution.ts (about 400, pure, imported by the eval)
  - useIntentCommands.ts (about 900)
- voice/useAiroVoice.ts (about 950): routing, gates, session start, auto-start, tab ownership, config load. It can split into useVoiceRouting and useVoiceSession if it grows past 1,000.
- input/:
  - handGestureController.ts (about 500, React-free)
  - useHandInput.ts (about 800): landmark frames and handleGesture glue.
  - useDockGesture.ts (about 250)
  - useCanvasPointerInput.ts (about 500)
  - useBoardKeyboard.ts (about 230)
- ui/:
  - BoardTopBar.tsx (about 300)
  - AiroPanel.tsx (about 190)
  - BoardSettingsDrawer.tsx (about 370)
  - CanvasHistoryControls.tsx (about 170)
  - BoardNotices.tsx (about 110)
  - DeleteBoardDialog.tsx (about 60)
  - boardLabels.ts (about 200)
- testing/:
  - airboardTestHooks.ts (about 60): the exported AirboardTestHooks type.
  - useAirboardTestHooks.ts (about 200): takes an explicit deps interface and keeps the NEXT_PUBLIC_AIRBOARD_TEST_HOOKS gate.
- legacy/useLegacyAnnotations.ts (about 700): transitional, and only if the shape-model merge hasn't landed before phase 6. The merge deletes the file.

State sharing:
- No context. All hooks are called from the shell.
- Refs live once in BoardEngine; refs don't re-render.
- Reactive state is owned by the hook that sets it and returned to the shell for the JSX. Other hooks read the existing mirrored refs or take the value as a parameter.
- Cross-hook calls are explicit parameters in DAG order. Back-edges go through engine.commands.
- Subcomponents get plain props.

#### Phases

1. **0. Safety net (no production code moves)** (1.5 days): Retarget the 3 source-text guards to read the board directory, or locate the file holding each marker; keep the arbitration-slice check working when coordinateRawLandmarkFrame moves. Add an exported AirboardTestHooks type and switch the 13 specs to it. Add characterization tests:
- (a) An e2e through emitRawLandmarkFrame (currently unused): open palm held opens the voice gate, pinch grab moves a shape, two hands zoom the viewport.
- (b) A golden journey (typed create, connect, hand move, undo, redo, transcript rename, remote event) whose getCanonicalBoardState fingerprint is stored.
- (c) A save after each mutation class (typed, Airo plan stub, undo, redo).
- (d) A normalised outerHTML snapshot of main.airboard-shell.
Set exhaustive-deps to error for the board directory. Record baselines: line counts, e2e pass count, board route bundle size.
   - *Safety:* Tests and scripts only. Green before and after: web unit (65 files), e2e (23 specs), typecheck, lint, and `pnpm -r build` with the contract scripts. No deploy is needed.
2. **1. Pure helpers and internal types out** (1 days): Move lines 11328-12521 and the types and constants at 279-692 into scene/sceneGeometry.ts, scene/sceneTargets.ts, scene/sceneIntentPatches.ts, history/boardHistory.ts, ui/boardLabels.ts and engine/boardTypes.ts. Move verbatim and only add exports. Add node --test unit tests for target resolution, connector rebind and move changes, and rename patches. Delete the two dead leftovers in a separate commit. The shell goes from 12,521 to about 10,950 lines.
   - *Safety:* No React touched. Verbatim moves can be checked with git diff --color-moved. All tests green, golden fingerprint unchanged. Web-only deploy with the previous web tag as rollback.
3. **2. View subcomponents** (1.5 days): Extract BoardTopBar (10138-10400), AiroPanel (10410-10578), BoardSettingsDrawer (10974-11325), CanvasHistoryControls (10637-10783), BoardNotices (10784-10871) and DeleteBoardDialog (10079-10119), all with explicit props. The canvas, video, inline text editor and floating label editor stay in the shell. The shell goes to about 9,900 lines.
   - *Safety:* The DOM snapshot from phase 0 must match exactly. The accessibility, accessibilityAudit (axe), boardLayout, keyboardAccess, boardExport, sharedBoard and signedInApp specs must pass. Web-only deploy, then the launch check.
4. **3. BoardEngine and leaf hooks** (2 days): Introduce engine/boardEngine.ts with grouped refs and a commands registry. Extract useBoardDocument (1503-1826), useBoardSession (3808-4010 and 8625-8662), useBoardViewport (3449-3535), useLightboardMedia (3536-3807), export, title and delete (8663-8703, 10000-10076), config loading (8704-8789), and useAirboardTestHooks (7616-7844). Call the hooks in the original line order so effects run in the same order. The shell goes to about 8,500 lines.
   - *Safety:* Golden fingerprint, save-after-mutation tests, boardSync, liveLinks, lightboard, canvasViewport and boardExport specs. exhaustive-deps must be clean. Web-only deploy.
5. **4. Scene editing, scene intents, undo/redo** (2.5 days): Extract useSceneEditing (1827-2853). Turn executeSceneIntent (511 lines) into a pure scene/sceneIntentExecution.ts plus a thin hook. Turn undo/redo (5599-5903) into pure steps in history/boardHistory.ts plus useUndoRedo. Replace executeSceneIntentRef, undoRedoRef and frameBoardBoundsRef with engine.commands. The shell goes to about 6,600 lines.
   - *Safety:* New unit tests on the pure scene-intent and undo steps. airoSceneObjects, typedCommand, catalogDock, canvasViewport and diagramVisibility e2e. Golden fingerprint unchanged. Web-only deploy.
6. **5. Intent pipeline and Airo voice (gated on RGB-049 real-device check)** (2.5 days): Extract useIntentCommands (5904-7208), with the plan-execution core in intent/semanticPlanExecution.ts. Point semantic-grounding-eval.mjs at that module and delete its mirror. Extract useAiroVoice (7209-7615, 7845-8196, the auto-start and tab-ownership effects 8476-8624, and the gate-expiry effect 9143). Replace prepareIntentCommandWithSemanticRef, applyPendingIntentRef, startVoiceCommandRef and runVoiceDecisionRef with engine.commands. The shell goes to about 4,300 lines.
   - *Safety:* voiceRouting (9 tests), typedCommand, directInputChannels, the voice-intent and semantic evals in eval:pr, and golden fingerprint unchanged. Before deploy, a manual real-microphone check on a signed-in board: wake word, palm-held gate, follow-up window, undo by voice. Web-only deploy with rollback tag.
7. **6. Camera, hands, pointer, keyboard (after the shape-model merge decision)** (3 days): Extract:
- useCameraLifecycle (8197-8475, the detection loop at 9200-9274, the mount guard at 9490).
- useHandInput, with handleGesture's logic moved into a React-free input/handGestureController.ts, and processRawLandmarkFrame kept in the same file as the coordinateRawLandmarkFrame call for the contract.
- useDockGesture (4691-5038).
- useCanvasPointerInput (9509-9999).
- useBoardKeyboard (9275-9508).
Legacy annotations (4011-4690) are either already deleted by the merge, or moved verbatim into legacy/useLegacyAnnotations.ts. The shell lands at about 1,500-1,900 lines.
   - *Safety:* The raw-landmark e2e from phase 0, catalogDock (15), lightboard, keyboardAccess, mediaOwnership, and the build contract scripts. Before deploy, a manual real-camera check: open-palm voice, pinch grab and move, two-hand pan and zoom, catalog by pinch, hold-to-edit, camera unplug recovery. Web-only deploy.

#### Risks

- Stale closures or missing dependencies when callbacks move into hooks change behaviour with no type error. Contain: pure moves with the dependency arrays kept verbatim, exhaustive-deps raised to error for the board directory (0 warnings today), one region per commit, and diffs reviewed with git diff --color-moved so any non-move line stands out.
- Effect order changes. React runs effects in call order, and several mount-once effects (sync bootstrap, speech engine load, the StrictMode camera mount guard at 3706 and 9490) depend on order. Contain: call hooks in the original line order, leave relative positions of mount-once effects alone, and rely on the golden-journey fingerprint and boardSync e2e.
- Build breaks: two build-time scripts and one unit test grep AirboardPrototype.tsx for markers, and one slices the coordinateRawLandmarkFrame call up to the processRawLandmarkFrame assignment. Contain: phase 0 retargets them before any move, and phase 6 keeps those two markers in one file.
- The real camera and microphone paths have no behavioural CI coverage: emitRawLandmarkFrame is used by no spec, video replay has no fixture, and the real-device spec is skipped. Contain: the phase-0 raw-landmark e2e, a manual real-device smoke before deploying phases 5 and 6, and gating phase 5 on RGB-049's first live microphone and camera check.
- Test-hook contract drift: 13 specs declare ad-hoc types, so a renamed hook fails only at runtime. Contain: one exported AirboardTestHooks type that typecheck enforces across e2e (apps/web tsconfig includes e2e), with names, gate and return shapes unchanged.
- Moving legacy annotation code that the shape-model merge then deletes is wasted work and churn. Contain: phases 0-5 leave legacy code in the shell, and phase 6 runs after the merge decision or quarantines that code in one file.
- Scope creep: an agent fixes or improves code while moving it. Contain: a rule that phases contain only moves and dead-code deletion in separate commits, with any behaviour fix logged to the backlog.
- Pilot exposure: a regression reaches pilot users. Contain: each phase is a separate web-only deploy (no API or DB change), the launch check READY 21/21, and the previous web tag as rollback. Board feature work is frozen during a phase, which lasts at most 3 days.

#### Done when

- AirboardPrototype.tsx is 2,000 lines or fewer, and its component body 1,200 lines or fewer (baseline 12,521 and 10,564)
- The shell has 25 or fewer useState and 30 or fewer useRef (baseline 80 and 150); no new module is over 1,300 lines
- No ad-hoc forward-declared callback refs remain. Back-edges go through the typed engine.commands, and prepareIntentCommandRef is gone
- The same e2e pass count as the phase-0 baseline across all 23 specs, plus the new raw-landmark, golden-journey, save-after-mutation and DOM-snapshot tests, all green
- The golden-journey canonical board-state fingerprint is identical before and after every phase, and the phase-2 DOM snapshot is identical
- Typecheck, lint (0 exhaustive-deps warnings, no new eslint-disable in board/), web unit tests and `pnpm -r build` with the retargeted contract scripts all green
- At least 25 new node --test cases on the extracted pure modules: sceneTargets, sceneGeometry, boardHistory undo/redo, sceneIntentExecution, semanticPlanExecution
- scripts/lib/semantic-grounding-eval.mjs imports production plan execution; the 'intentionally mirrors' comment and its copy are gone
- All 13 hook-using e2e specs import the AirboardTestHooks type; window.__airboardTestHooks keeps its 22 method names
- The board route's JS bundle size is within ±1% of baseline
- Each phase is deployed web-only with launch check READY 21/21; phases 5 and 6 each have a recorded manual real-microphone or real-camera smoke in the backlog change log

#### Depends on

- Eval/CI plumbing (strong, first): the build-time grep scripts that item wants to trim are exactly what blocks this split. Phase 0 retargets the three board-specific guards. If the eval/CI item replaces them with behavioural tests first, phase 0 shrinks by about 0.5 day. Phase 5 later removes the eval's mirror of prepareSemanticActionPlan, which also serves that item.
- Shape-model merge (strong, interleaved): do split phases 0-4 first. They put undo in history/boardHistory.ts and targets in scene/sceneTargets.ts, which gives the merge typed seams and a smaller review. Then run the merge, which deletes legacy annotations (4011-4690), the legacy UndoAction variants, the annotation selection and label-editor state, and the 13 legacyStrokeId sites. Then run phase 6, so the hand and pointer code is extracted once, in v2-only form.
- Stylesheet layers (medium): the phase-2 subcomponents are the natural units for per-component CSS modules (the SceneContextToolbar.module.css pattern already exists). This split keeps class names fixed. verify-automated-command-contract.mjs also checks `.canvas-copilot {` in globals.css, so whichever item moves that CSS updates the check.
- Renderer split (none): drawing-engine's renderer.ts is called from the render callback that moves to useBoardDocument in phase 3. The two can run in parallel.
- API route splits (none): different app.
- Token-in-URL removal (weak): the listed paths are the API's ?token= and the /sessions/:id/state ticket, plus the eval harness, and none are in this file. The board's live-session bootstrap (3820-3971) reads and writes ?joinToken= for live links by design. If that item is widened to live-link tokens, do it after phase 3 inside document/useBoardSession.ts.
- Docs (weak, last): 6 help articles list AirboardPrototype.tsx under sources, and generate-help-content only checks the file exists, so the shell path keeps them valid. Update the sources and the out-of-date Cleanup Review section 4 numbers when done.

### Merge the stylesheet layers

**Analyst verdict:** Do soon · about 6.5 engineer-days as first scoped.

Worth doing, but not urgent. There is no user-facing breakage beyond the off-brand teal buttons, and the page-weight gain is small.

The case for doing it soon is maintenance:
- The file is the second most-edited in the repository.
- The two product layers plus the global resets cause measurable fights: 154 declarations that can never apply, 141 values overridden from Layer 1 to Layer 2, and 44 `!important` that are not utilities.
- The cascade has already produced about 6 recorded defects this month.

The highest-value, lowest-risk part is the safety net and the merge (Phases 0-2, about 4 days). The visual-regression net from Phase 0 is also what the board-file split needs, so it pays twice.

The split by surface (Phase 3) is cheap once the layers are merged, but it carries a real Next.js risk: stylesheets stay loaded after client-side navigation, so files that are not scoped can collide in order-dependent ways. Its payoff is mostly page weight and clearer ownership, so it is the part to drop if time is short.

Converting the board CSS to CSS modules should wait for the board-file split. If only a smaller step is wanted, do Phases 0-1: the snapshot net, formatting the minified lines, and deleting the 154 overridden declarations and the old sidebar columns. That is about 2 days and removes most of the review pain.

#### Today

All numbers measured on branch codex/production-readiness at 27886a2 with a postcss parse (scripts are in the scratchpad, not the repo).

SIZE AND LOADING
- apps/web/app/globals.css is 5,709 lines and 161,172 bytes raw. Minified it is about 133 KB, about 26.8 KB gzip and about 21.8 KB brotli.
- It holds 1,368 rule selectors, 357 classes and 4,575 declarations. Every class has markup: the dead CSS went in the 12 Nov cleanup.
- app/layout.tsx:3 imports it for every route.
- The only other stylesheets are two board CSS modules: SceneContextToolbar.module.css (406 lines) and ScenePlaybackOverlay.module.css (55 lines).

THE TWO LAYERS, PLUS A THIRD TOKEN SET
- Layer 1, "Commercial product shell", is lines 654-824: 171 lines but 29.7 KB, because it is written as minified one-line rules. It has 14 --product-* tokens (teal #087c6f, lime, lavender) and 1,001 declarations. 9 of its lines are over 400 characters; the longest is 2,411.
- Layer 2, "Airboard Spatial Product System", is lines 1925-2456: 532 lines and 30.8 KB. It has 8 --air-* tokens (violet) and 757 declarations. Its header says it is "one visual language" for the same marketing, auth and app pages.
- The board has its own third token set at lines 1-16 (--bg, --panel, --accent teal #0f766e, and others).

THE REST OF THE FILE IS ORDERED BY HISTORY, NOT BY SURFACE
| Lines | Contents |
|---|---|
| 1-653 | New board creation surface |
| 825-856 | Global button, select and body resets |
| 857-1008 | Pilot pages |
| 1009-1913 | Original board editor |
| 2457-4092 | "Immersive standalone canvas editor" |
| 4093-5284 | Help Center |
| 5285-5709 | Mixed: toasts, read-only banner, skip link, library previews, landing demo, view-only board, status incidents |

OVERRIDES
- 94 top-level selectors are defined more than once.
- 72 Layer 1 selectors are redefined word for word in Layer 2, and 141 property values on 59 selectors are overridden from Layer 1 to Layer 2. For example, .auth-card has a different padding, border, radius, background and shadow in each layer.
- 60 more Layer 1 values are overridden through more specific Layer 2 selectors, such as `.marketing-shell .button-primary` over `.button-primary`.
- 154 declarations (144 of them in Layer 1) can never apply, because a later identical selector in the same media query overrides them. 25 rules are dead entirely.
- `.app-shell` sets its grid columns four times (245px at 786, 210px at 800, 264px at 2214, 224px at 2407). `display: block` at 2235 cancels all four; they are leftovers from the old sidebar.

SPECIFICITY FIGHTS
- 60 `!important` in globals.css. Only 16 are legitimate utilities (.sr-only, .form-honeypot, reduced motion). The CSS module adds 3 more (.cellSelect).
- The global `button`, `select` and `body` resets (825-856) are re-overridden by 46 declarations in the canvas editor, 23 in the new board CSS and 15 in Layer 2.
- Layer 2's `.app-shell :is(.button, button)` (min-height 46px, radius 14px, a 2px hover lift) and `.app-shell :is(input, select, textarea)` (width 100%, min-height 52px) also reach into the signed-in board, because AppShell renders `app-shell board-app-shell`. They do not reach the /live board.
  - The same board controls are therefore styled by two different cascades depending on the route.
  - Board rules use `!important` to win: .canvas-title-button has 8 (it is a `<button>` at specificity 0,1,0 against the reset's 0,1,1), .creation-more-shapes has 13, and the module's .cellSelect has 3.

TOKEN DRIFT
- 337 distinct hex colours, 254 distinct rgba values, 74 box-shadows, 42 border-radius values, 58 font sizes and 26 z-index values.
- Reading the cascade statically, there are at least five different primary-button styles. The Layer 1 teal `.button-primary` is the only rule that matches primary buttons outside the four Layer 2 shells, so they render in the old teal brand. That covers app/error.tsx, the error states in LiveBoardJoin.tsx and ViewOnlyBoard.tsx, and "Try Airboard" in SharedBoardView.tsx. The help header (#7151ce), the help support box and the cookie banner (Layer 1 lavender) each style their own. This is not verified in a browser yet.

PAGE WEIGHT
Every route ships the whole 26.8 KB gzip. The share each page actually uses is an upper-bound estimate from matching class names to each surface's components:

| Page | Share used | Size it needs (gzip) |
|---|---|---|
| Landing | ~20% | ~6.8 KB |
| Sign-in | ~12% | ~4.6 KB |
| Signed-in home | ~18% | ~5.9 KB |
| Settings | ~21% | ~6.4 KB |
| Help | ~22% | ~7.2 KB |
| Board | ~50% | ~13.5 KB |

By bytes, about 49% of the rules are board-only or board-mixed. Marketing is about 13%, app about 14%, help about 12% and auth about 4%.

CHURN
- 28 commits since 2026-10-01 (all between 4 and 12 Nov), out of 159 in the repository. That makes it the second most-edited source file after AirboardPrototype.tsx (30).
- Those commits added 1,249 lines and deleted 1,376.
- 5 of the 28 rewrote a minified line over 400 characters.
- By selectors changed: board 19 commits, app 8, marketing 8, rules shared between surfaces 5, auth 3, help 1.

DEFECTS TRACED TO THE STYLESHEET
- Docs/Accessibility Audit.md finding 2: three different translucent focus rings (34%, 26% and 35% opacity) from separate layers.
- Same audit, finding 9: reduced motion was scoped to Layer 2's shells only.
- Backlog, 0f6ab46: "A later 42px rule had overridden the small-screen sizes" of the dock, and "a 64vh rule had left a third of it empty".
- Backlog, 676fa97: a leftover `.sidebar { overflow: visible }` let 1,500px of settings spill out of the panel. Dock offsets written for desktop panel widths clipped the Move tool at 701-900px.
- Backlog, e33fed1: the Airo panel covered the undo toast (z-index).
- So about 6 recorded defects in November: 2 come directly from the two product layers and 4 from the board's stacked rules.
- The RGB-049 hands-free review produced 0 stylesheet findings; its gaps were the shape models. Hands-free Gap Audit cites globals.css only once, as evidence.

PROTECTION TODAY
- No pixel or computed-style snapshot tests.
- About 120 e2e tests, including geometry asserts in boardLayout.spec.ts and catalogDock.spec.ts, and axe checks at 1280 and 320px in accessibilityAudit.spec.ts.
- apps/web/test/accessibilityStyles.test.mjs reads only app/globals.css. scripts/verify-camera-layer-contract.mjs and scripts/verify-automated-command-contract.mjs, which run in the web build, also read only that file.
- No webfont is loaded, so text renders differently on macOS and on CI's Linux. 8eff5db had to fix a 320px overflow that only appeared on CI fonts.

#### Need

The stylesheet is the second most-edited source file (28 of 159 commits since 1 Oct). Every UI change, mostly by AI agents, lands in one 5,700-line file that has:
- three token sets;
- two product layers where the second is a skin over the first;
- global element resets that every surface has to undo.

That shape breeds bugs. The safe-looking move is to append an overriding rule at the end, and that is how the stack formed. It is also how November's defects happened: "a later 42px rule", a stale 64vh rule, a leftover overflow: visible, focus rings defined per layer, and reduced motion scoped to one layer's shells.

Specificity is now fought with `!important` (44 outside utilities), including inside a CSS module. The signed-in board inherits app-shell button and input resets that the /live board does not, so one board renders through two cascades.

Behaviour e2e tests did not catch any of these. Each was found by hand at a specific width, because nothing compares how pages look.

Leaving it costs:
- Every styling change keeps getting slower and riskier to review. Minified 2,400-character lines make diffs unreadable.
- Off-brand Layer 1 teal stays on the error, live-join, view-only and shared-board pages.
- The board-file split will have no CSS seams to co-locate with.
- Marketing and sign-in visitors keep downloading about 4-6 times the CSS they use: roughly 20 KB gzip extra, render-blocking, on the first visit.

The page-weight cost is minor: about 22 KB brotli total, cached after the first visit, and a Chrome-only pilot. It does not justify the work on its own.

None of this blocks the pilot.

#### In scope

- Phase 0 safety net:
- - A Playwright screenshot spec covering about 22 page states.
- - A computed-style snapshot spec that does not depend on fonts.
- - Make accessibilityStyles.test.mjs, verify-camera-layer-contract.mjs and verify-automated-command-contract.mjs read every stylesheet instead of only app/globals.css.
- Format the 9 minified lines over 400 characters (layer 1, lines 776-790, and the media blocks at 793-822) to one declaration per line.
- Delete the 154 declarations that a later identical selector always overrides, and the 25 rules that are dead entirely, using a generated and reviewed list.
- Delete the old sidebar remnants: the four .app-shell grid column definitions and the dark-sidebar `.app-brand` colour.
- Collapse the three token sets into one: 14 --product-*, 8 --air-* and 12 board tokens, keeping the values that render today.
- Fold each Layer 1 rule into its Layer 2 counterpart, so each selector is defined once per media query.
- Replace the four-fold `.marketing-shell, .auth-shell, .auth-callback-shell, .app-shell` selector lists with one grouped root.
- Scope the shell element resets so they stop at `.board-app-shell`, and scope the bare `button`/`select` resets to the board root.
- Then remove the `!important` declarations that existed only to beat those resets, including the 3 in SceneContextToolbar.module.css.
- Split the merged file into surface stylesheets imported by the shell components: marketing, auth, app, help, board and shared board. app/globals.css keeps the base and tokens, so the root import stays.
- A check (script or unit test) that fails if a class is styled in two surface files, or if a shared primitive (.button, .eyebrow, .brand-orbit, .form-message, .sr-only) is styled outside the base file.
- A client-side navigation test: landing, login, app, board, help and back to landing. Computed styles at each step must equal a direct load.
- Measure CSS per route from the production build (.next-production/static/css) before and after.
- Optional Phase 4, an intentional visual change needing owner sign-off: one primary-button style everywhere, replacing the teal Layer 1 buttons on the error, live-join, view-only and shared-board pages, and the greenish --product-bg loading background. Shipped as its own commit with updated screenshots.

#### Out of scope

- Converting board CSS to CSS modules or co-locating it with components. Do it with or after the AirboardPrototype.tsx split.
- Renaming any class in TSX, or other TSX changes beyond adding one CSS import per shell component.
- A redesign, a new design system, Tailwind, or dark mode.
- Consolidating the 24 distinct media-query breakpoints (41 blocks): that changes layout behaviour at specific widths.
- Fixing the board layout logic itself (dock and panel offset rules, z-index scale) beyond moving it.
- Firefox and Safari (excluded by Docs/Browser Matrix.md).
- global-error.tsx inline styles.
- Reformatting long TSX lines (AdminPage, SettingsPage), a separate Cleanup Review item.
- Reducing the 337 distinct hex colours beyond the token merge: colour cleanup inside the board is later work.

#### Target structure

After the split, styles live in seven global stylesheets, each imported by the component that owns its surface:

| File | Approx. lines | Contents | Imported by |
|---|---|---|---|
| apps/web/app/globals.css | ~450 | One :root token set; element resets scoped with :where(); shared primitives (.button family, .eyebrow, .brand-orbit, .form-message/.form-warning/FormStatus, .sr-only, .skip-link, .form-honeypot); focus ring; the global reduced-motion rule; cookie banner; read-only/maintenance banner; .product-loading | app/layout.tsx (as today), so the script paths stay valid |
| apps/web/src/styles/marketing.css | ~900 | Landing and IdeaDemo, PublicShell header/footer, [marketingSlug] pages and pricing, contact-sales, integrations, status incidents, support, pilot pages, not-found. Every selector rooted in .marketing-shell or the .pilot-info-* namespace | PublicShell.tsx and LandingPage.tsx |
| apps/web/src/styles/auth.css | ~280 | Sign-in/signup, auth callback, invite, onboarding | AuthPage.tsx, AuthCallback.tsx, InvitePage.tsx |
| apps/web/src/styles/app.css | ~600 | Signed-in header and profile menu, Airboards home/library and previews, settings, billing, admin, data tables. Rooted in `.app-shell:not(.board-app-shell)` | AppShell.tsx |
| apps/web/src/features/help/help.css | ~1,150 | Help Center | HelpShell.tsx |
| apps/web/src/features/board/board.css | ~2,500 | Creation surface, canvas editor, dock, Airo panel, inspector, toasts and notices, voice pill, lightboard, share dialog. Keeps .lightboard-underlay, .lightboard-scrim and .canvas-copilot for the build scripts, which are updated to read it | AirboardPrototype.tsx |
| apps/web/src/features/share/sharedBoard.css | ~120 | /s view-only board bar and canvas | BoardViewer.tsx and SharedBoardView.tsx |

Unchanged: SceneContextToolbar.module.css and ScenePlaybackOverlay.module.css.

New tests and tooling:
- apps/web/e2e/visual.spec.ts with its committed Linux baselines.
- apps/web/e2e/computedStyles.spec.ts with a JSON baseline: about 60 elements times about 25 properties.
- scripts/check-css-surfaces.mjs.

Totals: about 5,300-5,800 lines across 7 files, against 5,709 today. Formatting Layer 1 adds about 600 lines while the merge removes some, so the gain is structure, not line count. No file goes over about 2,500 lines and no line over 200 characters.

Per-route CSS targets (gzip):

| Page | Today | Target |
|---|---|---|
| Landing | ~27 KB | ≤9 KB |
| Sign-in | ~27 KB | ≤7 KB |
| Help | ~27 KB | ≤9 KB |
| Board | ~27 KB | ≤16 KB |

#### Phases

1. **Phase 0: visual-regression and style-contract safety net** (1.5 days): - Add e2e/visual.spec.ts using toHaveScreenshot, with animations disabled, the caret hidden, masks over timestamps and live canvas content, and fixed viewports. About 22 states:
  - landing at 1280 and 375px; a pricing slug page; contact-sales; status; support; 404;
  - /login, /signup, auth-callback error, expired invite;
  - /app home empty and with boards at 1280 and 375px; settings profile; billing; admin members;
  - Help home, and an article at 1280 and 375px;
  - board editor at 1280px with Airo hidden and shown, 800px with Airo open, 375px, and with the inspector open;
  - /s shared board, expired /live, view-only board, the app/error.tsx state, the cookie banner.
- Generate baselines only on Linux: a workflow_dispatch job in .github/workflows/ci.yml, or the mcr.microsoft.com/playwright:v1.64.1 image. Commit them.
- Add e2e/computedStyles.spec.ts: it records about 25 computed properties for about 60 key elements across those pages to a JSON baseline. This check does not depend on fonts, so agents can run it on macOS.
- Change accessibilityStyles.test.mjs and the two build scripts to read every *.css under app/ and src/.
   - *Safety:* Tests only; no product file changes. Run the new specs twice on CI to prove they are stable before relying on them. The existing unit tests, e2e suite (about 120 tests) and web build stay green.
2. **Phase 1: mechanical tidy** (0.5 days): - Format the minified Layer 1 lines: 9 lines over 400 characters, the longest 2,411.
- Delete the 154 declarations that a later identical selector overrides, and the 25 rules that are dead entirely. The list comes from a postcss script, and `!important` cases are reviewed by hand.
- Delete the four sidebar-era .app-shell grid-template-columns, the dark-sidebar `.app-brand` colour and its orbit border.
   - *Safety:* Pure dead-code and whitespace changes. The computed-style snapshot must be identical, there must be 0 screenshot diffs, and accessibilityStyles.test.mjs, verify-camera-layer-contract.mjs and verify-automated-command-contract.mjs must pass.
3. **Phase 2: merge the two product layers and stop shell resets reaching the board** (2 days): - Replace the three token sets with one, keeping the values that render today.
- Fold every Layer 1 rule into its Layer 2 counterpart, so there is one rule per selector per media query.
- Collapse the four-shell selector lists.
- Scope `.app-shell :is(.button, button)` and `.app-shell :is(input, select, textarea)` with `:not(.board-app-shell)`, and scope the bare button/select resets to the board root.
- Then remove the `!important` declarations that only beat those resets: .canvas-title-button, .creation-more-shapes, the inspector inputs, .library-board-actions, the module's .cellSelect, and others.
- Target: `!important` from 63 down to 16 utilities or fewer.
   - *Safety:* - Expect 0 screenshot and computed-style diffs on the marketing, auth, app and help pages.
- Any board diff must make /app/boards/:id match the /live board. Each such diff is reviewed and approved as a screenshot by the owner, never re-baselined in bulk.
- Add one assertion: a board control has identical computed styles at /app/boards/:id and on /live.
- Land it as small commits, one shell at a time.
4. **Phase 3: split by surface** (2 days): - Move each surface's rules, in blocks that keep their order, into marketing.css, auth.css, app.css, help.css, board.css and sharedBoard.css, imported from the shell components. Base and tokens stay in app/globals.css.
- Root every surface selector in its shell class or a surface-only class prefix.
- Add scripts/check-css-surfaces.mjs, wired into `pnpm test:scripts` or the web unit tests. It fails on classes styled in two surface files, or on shared primitives styled outside the base file.
- Add the client-side navigation test (landing to help and back).
- Record per-route CSS bytes from the production build.
   - *Safety:* - Next.js keeps a route's stylesheet loaded after client-side navigation, and chunk order is not guaranteed. Scoping, the collision check and the navigation test contain that risk.
- Computed-style snapshot and screenshots must be identical.
- The build scripts now read board.css. A unit test fails if any *.css file goes unread by the accessibility check.
- Ship it as one PR per surface; help and marketing first, board last.
5. **Phase 4 (optional, owner decision): intentional visual unification** (0.5 days): - Give the primary buttons on app/error.tsx, LiveBoardJoin, ViewOnlyBoard and SharedBoardView the Layer 2 violet style, replacing the Layer 1 teal.
- Replace the greenish --product-bg loading background.
- Merge the help header, help support box and cookie-banner button variants into the one primary style.
   - *Safety:* A deliberate visual change, in its own commit, with the screenshot diffs attached for owner approval. Contrast is rechecked by the axe runs in accessibilityAudit.spec.ts at 1280 and 320px.

#### Risks

- Styling breaks that behaviour tests cannot see. Contain it with Phase 0 before any CSS edit: about 22 screenshot states plus a computed-style JSON snapshot, both required at every phase. Screenshot diffs are reviewed one by one, never re-baselined in bulk.
- Flaky screenshots across operating systems. No webfont is loaded, and 8eff5db shows CI's Linux fonts differ from macOS. Contain it by generating and comparing baselines only on CI Linux (a pinned Playwright 1.64.1 image), disabling animations, masking dynamic regions and setting a small maxDiffPixelRatio. The computed-style snapshot does not depend on fonts and is the primary gate agents run locally.
- Next.js App Router keeps a stylesheet loaded after client-side navigation, and CSS chunk order can differ from import order. Surface files could then collide depending on load order (for example .button-primary defined in marketing.css and app.css). Contain it by rooting every surface selector in its shell, keeping shared primitives only in globals.css, adding check-css-surfaces.mjs, and adding the navigation test (landing, login, app, board, help).
- Moving rules changes their source order. Rules with equal specificity can flip, because today's behaviour depends on position in one file. Contain it by moving contiguous blocks in order, splitting one surface per PR, and requiring an identical computed-style snapshot.
- Text-based checks silently weakened. accessibilityStyles.test.mjs (focus rings, reduced motion), verify-camera-layer-contract.mjs (lightboard z-index) and verify-automated-command-contract.mjs ('.canvas-copilot {') read only app/globals.css. Contain it by making them read every stylesheet in Phase 0, plus a test that fails if a *.css file is not covered.
- Removing the shell resets that reach into the board changes the signed-in board wherever board CSS never restyled a control. Contain it by treating each diff as aligning /app/boards/:id with /live, adding a computed-style equality assertion between the two routes, and getting owner approval on the screenshots.
- Introducing @layer to make cross-file order explicit would make the unlayered CSS modules always win, changing outcomes. So @layer is not used in this refactor.
- Merge conflicts with board work in flight (RGB-049 follow-ups, the board-file split) that also edits board CSS. Contain it by moving board.css last, as one mechanical commit at a quiet point, with no class renames.
- Scope creep into redesign, such as consolidating breakpoints or cleaning up colours. Contain it with explicit out-of-scope items; visual changes go only in Phase 4 with sign-off.

#### Done when

- Phases 1-3 cause zero unintended screenshot diffs across the about 22 states, and the computed-style JSON snapshot is unchanged. Phase 2 board diffs are approved one by one; Phase 4 diffs are approved as a set.
- All checks stay green: web unit tests (with accessibilityStyles.test.mjs reading every stylesheet), the e2e suite (about 120 tests, including accessibilityAudit, accessibility, boardLayout, catalogDock, lightboard, sharedBoard, statusPage, helpCenter, signedInApp and keyboardAccess), lint, typecheck, and the web build with both contract scripts.
- One token set: zero `var(--product-` and `var(--air-` references, and one :root token block plus the dark-panel focus-ring overrides.
- Zero selectors defined twice in the same media query across all stylesheets (94 today), and zero declarations that can never apply (154 today).
- `!important` in the stylesheets: 16 or fewer, all in .sr-only, .form-honeypot and reduced motion (60 in globals.css plus 3 in the module today).
- No stylesheet over 2,600 lines and no line over 200 characters (9 lines over 400 today, the longest 2,411).
- check-css-surfaces.mjs passes: no class styled in two surface files, and no shared primitive outside globals.css.
- The client-side navigation test passes: computed styles after landing, login, app, board, help and back to landing equal a direct load.
- A board control has identical computed styles at /app/boards/:id and on the /live board.
- Production-build CSS per route (gzip): landing 9 KB or less (about 27 KB today), sign-in 7 KB or less, help 9 KB or less, board 16 KB or less, measured from .next-production/static/css and recorded in the PR.
- Done means all of the above, plus Docs/Cleanup Review.md section 4 item 6 marked done with the final numbers.

#### Depends on

Board-file split (AirboardPrototype.tsx):
- Mostly independent. This work changes no class names and adds only one import line to AirboardPrototype.tsx.
- Phase 0's screenshot and computed-style net is also the safety net the board split needs, so do Phase 0 first; it serves both.
- Move board.css (Phase 3) at a quiet point between board-split PRs, not during one.
- Turning board CSS into co-located CSS modules belongs to the board split, after this item.

Shape-model merge: no dependency. Shapes draw on the canvas; the DOM toolbars are untouched.

Renderer and API route splits: none.

Token-in-URL removal: none.

Eval and CI plumbing trim:
- Coordinate on the build-time scripts. verify-camera-layer-contract.mjs and verify-automated-command-contract.mjs read globals.css. If the CI trim retires them first, Phase 0 has less to update; otherwise Phase 0 changes them to read every stylesheet.
- The new screenshot and computed-style specs add about 1-2 minutes to the existing e2e job. The CI trim should keep them and not count them as duplicates.
- eval:pr re-running unit tests does not affect this item.

Docs cut-down:
- Update Docs/Cleanup Review.md (item 6 still says 6,290 lines) and Docs/Accessibility Audit.md (it names globals.css for the focus-ring and reduced-motion tests) once, at the end.
- No ordering constraint.

### Split the renderer and API route files

**Analyst verdict:** Do soon · about 6 engineer-days as first scoped.

Do the API half soon, in about 4 engineer-days, before the paid-launch billing work starts, and defer the rest:
- **Do soon: shared guards and validation, the controlPlaneRoutes split, the server.ts split, and the transcription helper move.** These are mechanical moves of functions that already sit at top level (or registrars that already take (server, config, auth)). They follow a pattern the repo has used before: boardContentRoutes and boardShareRoutes were split out the same way. The tests go through stable entry points (registerControlPlaneRoutes, registerTranscriptionRoutes, buildServer), and the guard consolidation removes drift that already exists.
- **Defer: extracting the transcription stream state machine.** Wait until voice is quiet, after RGB-049's real-device check.
- **Defer: the renderer split, until after the shape-model merge's delete phase.** The renderer barely changes, has no bugs, and about 35% of it is legacy painting that the merge removes. If the owner declines the shape merge, the renderer split is still do-later.
- **Not do-now:** nothing is broken today.

#### Today

Measured at HEAD 27886a2 (12 Nov 2026). Churn is commits / lines changed since 2026-10-01; the repo had 159 commits in that period.

API (12,169 source lines; these three files are 4,015 of them, 33%):
- **controlPlaneRoutes.ts: 1,948 lines**, down from 2,953 after the 12 Nov extension and SCIM removal. 22 commits and 1,657 lines changed (+472/-1,185), the most-changed API file. It holds about 41 of the API's roughly 72 routes and 9 unrelated jobs:
  - account, /me and the development sign-in (:32-205)
  - trial (:206)
  - board CRUD (:282-489)
  - /integrations/preflight (:500)
  - organization and invitations (:526-767)
  - leads, consents, support and privacy (:768-955)
  - billing and the Stripe webhook (:956-1111, plus Stripe processing :1682-1822)
  - the lifecycle runner with data-request erasure, notifications and retention purges (:1112-1681)
  - about 80 lines of guards and helpers
  boardShareRoutes.ts has to receive writeAudit as a callback because that helper lives here.
- **Test coverage of the control-plane routes is thin.** controlPlaneRoutes.test.mjs (32 tests) exercises boards, share links, the lifecycle run, invitations and /auth/config. About 20 routes have no API-level test: /me/preferences, /me/notifications, /me/organizations, /me/sessions, trial/activate, preflight, organization members/policies/audit/usage, leads, consents, support, privacy HTTP, commercial config, checkout, portal and /webhooks/stripe. Stripe is off in the pilot.
- **server.ts: 1,075 lines.** 15 commits, 605 lines changed. buildServer is one function (:114-1039) holding five jobs: Fastify bootstrap and hooks, /health /ready /metrics, 8 session HTTP routes (:353-660), and the live-board /ws handler (:661-1039, 379 lines). That handler closes over the room map, fan-out join/leave, owner-lock timers and socket caps.
- **transcription/routes.ts: 992 lines.** 12 commits, 1,057 lines changed (+802/-255), including 714 in RGB-049 alone (RGB-042/044/048/049). The registrar and ticket code take about 210 lines. The rest is one 729-line /transcription/ws closure with about 20 inner functions: provider legs, handover, dormancy, metering and tick.
- **Duplicated guards and helpers (Cleanup Review appendix, re-checked today):**
  - requireAuth is defined in controlPlaneRoutes.ts:1337 and boardContentRoutes.ts:346, and inline twice in boardShareRoutes.ts:236/263.
  - requireBoardEditor is defined twice.
  - record, boundedString and JsonRecord are each defined twice. They have drifted: only the control-plane boundedString rejects control characters.
  - There are 6 UUID regexes with 3 version rules: [1-5] at cp:1884; [1-8] in boardShareRoutes, boardContentRoutes and sessionStartValidation; any version in supabaseSessionStore and boardAccess.
  - sha256 is defined twice; the billing-ready expression is in server.ts:279.
- **Bugs and findings located in these API files:**
  - 12 Release Readiness Backlog items: RGB-001, 005, 007, 008, 009, 010, 015, 017, 018, 021, 024, 025. Nine are fixed. Those were hardening gaps, not caused by file size, although RGB-015 (secret compares) and RGB-018 (origin '*') each had to be fixed at three duplicated sites.
  - Three paid-launch items are open (RGB-008/009/010), and all of them are in the billing/Stripe code in controlPlaneRoutes.ts.
  - Cleanup Review findings: 14 touch controlPlaneRoutes.ts, 7 touch server.ts and 2 touch transcription/routes.ts. Most were dead-code findings, now largely deleted.
  - The Hands-free Gap Audit cites transcription/routes.ts in 2 of its 12 gaps and none of the other files.
- **Baseline today:** 195 API tests pass in 5.4 s on Node 22.23.4. transcriptionRoutes has 18 behavioural WebSocket tests, and boardSocketLimits, liveSessionTickets and sessionAccess have about 20 between them. /ready and /metrics have no tests.

Renderer:
- **packages/drawing-engine/src/renderer.ts: 2,928 lines**, 51% of the package's 5,710. 3 commits and 28 lines changed since 1 Oct.
- **Bugs and findings:** 0 backlog items and 0 hands-free audit gaps; 3 Cleanup findings, all about the legacy painter or test-only exports.
- **It mixes about 7 jobs:**
  - frame and lightboard glow
  - ordering, contrast plates and guides
  - 13 scene-element painters (:643-1268)
  - rich text and code (:1269-1466, :1711-1753)
  - shared primitives
  - the legacy annotation path
  - overlays and cursors
- **The legacy annotation path is about 1,010 lines (35%):**
  - drawStroke: 54 lines
  - drawAnnotationStroke and drawNodeShape: 656 lines in total. drawNodeShape includes the 12 hand-written painters (:1981-2236, 256 lines).
  - annotation overlay and ghost: 221 lines
  - annotation trace and convert: 81 lines
  It is live because Airo's node.create still makes flow_node strokes (diagramCommands.ts:697).
- **Shared mutable state:** two module-level variables (inkTransform/fillTransform) are referenced at 75 themedInk/themedFill call sites.
- **Small public surface:** the app imports only renderBoard, sceneElementsForRender, exportCanvasPng and AnnotationRenderObject through the index.ts barrel.
- **Tests:** 39 drawing-engine tests pass, and three test files already have recording-canvas helpers.

#### Need

**API (real but moderate need, low risk).**
- **Context cost.** Every agent edit to an account, board, organization, privacy, billing or lifecycle route loads a 1,948-line file (about 25k tokens) with 9 unrelated jobs in it.
- **Destructive code sits next to everything else.** The lifecycle code that erases accounts, workspaces and expired boards is beside marketing lead capture.
- **Billing has no tests and will be edited next.** The billing and Stripe code has no tests, and the three open paid-launch items (RGB-008/009/010) will edit it next.
- **The copied helpers have already drifted:**
  - Board-content routes store strings with control characters that the control plane rejects.
  - A v6-v8 UUID passes /sessions/start and share routes but fails control-plane boundedUuid. This is theoretical today because board ids are Postgres v4.
  - Security fixes have had to be applied three times (RGB-015, RGB-018).
- **Live-session changes land inside one function.** server.ts keeps the 379-line /ws handler inside buildServer, so every live-session change, like RGB-045, is an edit inside one 925-line function.

**Cost of not doing the API part:** no user-visible failure is expected. The costs are slower and riskier agent edits, more drift between copies, harder review of the paid-launch billing work, and the next security fix again landing in several places.

**transcription/routes.ts:** it has the highest relative churn, but the 729-line closure is one cohesive state machine with good behavioural tests. Splitting it moves complexity rather than removing it. RGB-049 has not yet been tried with a real microphone, so voice fixes may be in flight, and a big move now risks conflicts and timer regressions for limited gain. Only the trivial helper move is worth doing now.

**renderer.ts: no current need.** It changed 28 lines in six weeks with zero bugs, and about a third of it is the legacy painter that the shape-model merge deletes. Splitting it now would mean moving roughly 1,000 lines twice. The cost of not splitting it now is close to zero.

#### In scope

- Characterization tests added before any move:
- a route-inventory snapshot (method+path for all ~72 routes)
- an auth matrix (unauthenticated, viewer and member outcomes per guarded route)
- validation pinning (control characters and UUID versions)
- the Stripe webhook signature and disabled path
- the /ready and /metrics response shapes
- a renderer golden draw-call snapshot
- One apps/api/src/routeGuards.ts (requireAuth, requireRole, requireBoardEditor, requireActiveEntitlement) and one validation.ts (JsonRecord, record, boundedString, isUuid/boundedUuid, boundedInteger, emailValue, maskEmail, sha256, escapeHtml, billingReady(config)), used by controlPlaneRoutes, boardContentRoutes, boardShareRoutes and server.ts. Identical copies only.
- A separate, owner-approved PR that resolves the drift: one boundedString rule (reject control characters everywhere) and one UUID rule. It is flagged as a behaviour change.
- Split controlPlaneRoutes.ts by register* group into routes/ and lifecycle/ modules. controlPlaneRoutes.ts stays as a small composer, so server.ts and the test imports are unchanged.
- Split server.ts into bootstrap, routes/health.ts, routes/sessions.ts and boardSocket.ts. boardSocket.ts holds the per-server room and fan-out registry and the /ws handler.
- transcription/routes.ts, now: move the constants and pure helpers out.
- transcription/routes.ts, later: move the per-socket stream handler into transcription/stream.ts as the same closure body behind a deps object.
- renderer.ts split by element family, after the shape-model merge deletes the legacy painter.
- Update the two non-doc references to controlPlaneRoutes.ts: the evidence string in ops/launch-evidence.json and the comment in apps/web/e2e/support/signedInApi.ts.

#### Out of scope

- Any behaviour change other than the separately flagged drift-fix PR.
- Deleting the 12 legacy painters, the nodeVisuals.ts boundary math, or the legacy hit-test paths. These belong to the shape-model merge.
- Token-in-URL removal (the security.ts query branch, and GET /sessions/:id/state becoming POST). That is its own item.
- Dead code noticed on the way: /integrations/preflight and its product_events writer, ANALYTICS_EVENT_NAMES, and the soft-delete drain in purgeExpiredDeletedBoards. Record these for a separate cleanup PR; this refactor only moves them.
- Making `auth` required in the transcription, semantic-intent and voice-trace registrars (Cleanup finding 'test-only branches'). It is a natural follow-on but changes about 10 test fixtures.
- Paid-launch billing fixes RGB-008/009/010. They should land afterwards, in routes/billing.ts.
- Rewriting the transcription state machine as a class, or changing any timer, handover or metering logic.
- Moving boardContentRoutes.ts or boardShareRoutes.ts into routes/ (rename-only churn), or splitting supabaseSessionStore.ts (611 lines), boardContentRoutes.ts (691) or semanticIntent/*.
- Re-pointing the roughly 170 line-number citations in Cleanup Review (92), the backlog (14) and the Threat Model (65). That belongs to the docs item.
- AirboardPrototype.tsx, globals.css, eval and CI scripts.

#### Target structure

**apps/api/src**

Shared helpers:
- **routeGuards.ts** (~70 lines): requireAuth, requireRole, requireBoardEditor, requireActiveEntitlement.
- **validation.ts** (~100): JsonRecord, record, boundedString, isUuid/boundedUuid, boundedInteger, emailValue, booleanSettings, maskEmail, sha256, escapeHtml, billingReady.
- **audit.ts** (~70): writeAudit, writeProductEvent, defaultWorkspaceId. boardShareRoutes imports writeAudit directly instead of taking it as a callback.

Control plane:
- **controlPlaneRoutes.ts** (~40): the registerControlPlaneRoutes composer; re-exports isLoopbackRequest.
- **routes/account.ts** (~280): /auth/config, /auth/development, /me*, /trial/activate, /integrations/preflight, isLoopbackRequest.
- **routes/boards.ts** (~230): /boards CRUD.
- **routes/organization.ts** (~250): invitations, members, policies, audit, usage.
- **routes/privacy.ts** (~200): leads, consents, support, privacy data requests.
- **routes/billing.ts** (~310): commercial config, checkout, portal, /webhooks/stripe, stripeRequest, stripeSignatureValid, processStripeEvent.
- **lifecycle/routes.ts** (~60): POST /internal/lifecycle/run.
- **lifecycle/dataRequests.ts** (~190): processDataRequests, personalWorkspacesOnlyMember, mustSucceed.
- **lifecycle/notifications.ts** (~150): queueTrialNotifications, deliverNotifications, notificationMessage.
- **lifecycle/retention.ts** (~150): expireDiagnostics, expireOperationalData, purgeExpiredDeletedBoards, lifecycleFailureCount, sanitizeDiagnostics.

Server:
- **server.ts** (~280): buildServer, covering Fastify and the logger, hooks, CORS, the JSON parser with the Stripe raw-body branch, websocket registration, shared limiters, and the register* calls.
- **routes/health.ts** (~90): /health, /ready, /metrics, /.
- **routes/sessions.ts** (~330): start, join, resume, join-link, ticket, events, heartbeat, state, plus ownedSession, liveCredentials, notJoinableReason, sessionLookupStatus.
- **boardSocket.ts** (~430): createBoardRooms(fanOut, log), one per buildServer call. It holds the rooms, fan-out join/leave and probe, owner-lock timers and open-socket caps, plus registerBoardSocket (/ws), broadcast and safeParse.

Transcription:
- **transcription/routes.ts** (~240): the registrar, covering provider, limiter, usage and allowance, breaker, authorizeRequest, /config, /ticket and /ws wiring.
- **transcription/streamLimits.ts** (~90): constants, voiceLimitRefusal, ticketRefusalStatus, isConfigureControlMessage, rawDataToUint8Array, send, sendError.
- **transcription/stream.ts** (~700, later phase): handleTranscriptionSocket(deps, socket, request). This is the moved closure, unchanged.

**packages/drawing-engine/src** (after the shape-model merge; about 1,900 lines remain)
- **renderer.ts** (~300): renderBoard, renderBoardContent, resize, export, background, glow layer.
- **ink.ts** (~40): themedInk, themedFill, setInkTheme. These replace the module-level `let` variables, which other modules could not reassign.
- **renderOrder.ts** (~200): ordering, contrast plates, alignment guides.
- **sceneElements.ts** (~630): the 13 scene painters.
- **richText.ts** (~240): rich text and code highlighting.
- **canvasPrimitives.ts** (~250): smooth paths, connector endpoints, rotation, media placeholders, badges, roundRectPath, wrapped labels.
- **overlays.ts** (~250): scene overlays, handles, the v2 ghost, cursor.
- **index.ts** keeps re-exporting exactly today's 23 public names, through explicit re-exports rather than new `export *` lines.

#### Phases

1. **1. Characterization tests (API and renderer)** (0.75 days): Add the tests that pin current behaviour, with no source changes:
- a route-inventory test: build the server with stubs, collect every route through an onRoute hook, and compare the sorted method+path list to a committed snapshot
- a table-driven auth matrix: no token gives 401 AUTH_REQUIRED, Viewer on board edits gives 403 BOARD_READ_ONLY_ROLE, member on admin routes gives 403 ROLE_REQUIRED
- validation pinning: control characters and v1/v4/v7 UUIDs per route family, recording today's drift as-is
- a /webhooks/stripe test for a bad signature and for Stripe switched off
- /ready and /metrics response shape and token check
- a renderer golden test: render a fixture board with every scene kind and every legacy annotation type, in classic and lightboard themes, with hover, selection and ghost, through the existing recordingContext, and snapshot the draw-call list
   - *Safety:* Tests only. Merges on its own and goes green against today's code.
2. **2. One routeGuards.ts and validation.ts (identical copies only)** (0.5 days): Move requireAuth, requireRole, requireBoardEditor and requireActiveEntitlement, and the helpers that are identical everywhere (record, JsonRecord, sha256, billingReady), into shared modules. Use them from controlPlaneRoutes, boardContentRoutes, boardShareRoutes (rebuilding ownedBoard and organizationAdmin on requireAuth/requireRole) and server.ts. Where copies differ (boundedString, the UUID regexes), keep each route family on its current rule, exported as a named variant.
   - *Safety:* The auth matrix, validation pinning and route inventory must not change. All 195+ API tests, typecheck and lint stay green. API-only deploy.
3. **3. Resolve the drift (owner decision; a deliberate behaviour change)** (0.25 days): Use one boundedString everywhere, rejecting control characters, and one isUuid rule (accept versions 1-8, matching Postgres gen_random_uuid and future v7). Flip the corresponding pinned expectations in one small, separately reviewed PR.
   - *Safety:* This is the only phase that changes behaviour. Exactly the pinned validation rows change, and nothing else in the matrix. Can be skipped without blocking later phases.
4. **4. Split controlPlaneRoutes.ts** (1.25 days): Move each register* group and its private helpers verbatim into routes/account.ts, boards.ts, organization.ts, privacy.ts and billing.ts, and lifecycle/routes.ts, dataRequests.ts, notifications.ts and retention.ts. Add audit.ts. controlPlaneRoutes.ts becomes the composer and re-exports isLoopbackRequest. Update the evidence string in ops/launch-evidence.json and the comment in signedInApi.ts. Review with `git diff --color-moved=dimmed-zebra`, so only import, export and wiring lines show as new.
   - *Safety:* The route-inventory snapshot is identical. controlPlaneRoutes.test.mjs (32 tests), the auth matrix and the Stripe tests pass. The esbuild bundle builds. Run pnpm smoke:deploy against the new API revision.
5. **5. Split server.ts** (1 days): Extract routes/health.ts and routes/sessions.ts. Move the /ws handler and the room and fan-out registry into boardSocket.ts, behind createBoardRooms(), with one instance per buildServer call and no module-level singletons. buildServer only wires things together. Run this phase before or after the token-in-URL item, never in parallel with it.
   - *Safety:* Must pass:
- boardSocketLimits, liveSessionTickets, sessionAccess and boardEventFanOut (which builds two server instances and so catches accidental shared state)
- shutdown and requestLogging
- the /ready and /metrics tests
- the route inventory
- a live-session smoke on the deployed revision (start, join, ws events, reconnect)
6. **6. Transcription: move constants and pure helpers (now)** (0.25 days): Move the constants, voiceLimitRefusal, ticketRefusalStatus, isConfigureControlMessage, rawDataToUint8Array, send and sendError into transcription/streamLimits.ts. The /ws closure is not touched.
   - *Safety:* transcriptionRoutes (18 tests), voiceReconnectContract and transcription.test.mjs pass.
7. **7. Transcription: extract the per-socket stream handler (later, when no voice fix is in flight and after RGB-049's real-device check)** (1 days): Move the 729-line /ws closure body unchanged into transcription/stream.ts as handleTranscriptionSocket(deps, socket, request). deps carries config, provider, breaker, usage, allowance, the slot counters and the logger. There is no class rewrite and no timer changes.
   - *Safety:* transcriptionRoutes and voiceReconnectContract run 20 times in a row with no flakes. Real-microphone voice smoke on the deployed revision, covering a 30-minute handover, dormancy and the minute warnings, before calling it done.
8. **8. Renderer split (after the shape-model merge deletes the legacy painter)** (1 days): Introduce ink.ts with setInkTheme(), so modules no longer share mutable `let` variables. Then split what remains into renderOrder, sceneElements, richText, canvasPrimitives and overlays, with renderer.ts keeping the frame and explicit re-exports. If the shape merge is declined, do this standalone with legacy painting quarantined in legacyAnnotations.ts (about 1.5 days instead of 1).
   - *Safety:* The golden draw-call snapshot is identical in both themes. The 39 drawing-engine tests pass. Object.keys of @airboard/drawing-engine is unchanged. The web typecheck and the browser suite (board rendering and the share viewer) pass.

#### Risks

- **A route dropped or registered twice during a move, or the Stripe raw-body parser branch lost.** Contained by: the route-inventory snapshot and the Stripe signature test, both added in phase 1 before any move. Moves are reviewed with --color-moved, so only wiring lines need reading.
- **Guard consolidation silently changing status or error codes.** For example, boardContentRoutes' requireAuth returns null slightly differently, and ownedBoard returns 404 before checking roles. Contained by: the auth matrix, the identical-copies-only rule in phase 2, and keeping deliberate drift fixes in the separate phase 3.
- **Per-server state turned into a module singleton when boardSocket.ts or transcription/stream.ts is extracted.** The candidates are rooms, owner-lock timers, socket caps, concurrentStreams and streamsByProfile. Contained by: the createBoardRooms() and deps-object pattern; boardEventFanOut.test.mjs, which runs two instances; and test files that build many servers per process.
- **Timer, handover or metering regressions in the voice hot path.** Contained by: deferring phase 7, moving the closure body without edits, 18 behavioural route tests plus the real-API reconnect contract run 20 times, and a real-microphone check before calling it done.
- **Renderer theme leakage, after moving the module-level inkTransform/fillTransform (75 call sites) into ink.ts.** Contained by: keeping the try/finally reset in renderBoard, and the golden draw-call snapshot in both themes.
- **Accidental growth of the public drawing-engine API**, because index.ts uses `export *`. Contained by: explicit re-exports, and comparing the export key set before and after.
- **Merge conflicts with in-flight work.** This includes voice fixes after RGB-049, token-in-URL edits to server.ts, security.ts and transcription authorizeRequest, and paid-launch billing edits. Contained by: one phase per PR merged the same day, sequencing token-in-URL before or after phase 5 and never in parallel, and starting RGB-008/009/010 only after phase 4.
- **Stale line-number citations in docs**: Cleanup Review 92, backlog 14, Threat Model 65. Accepted: the docs item should drop line numbers rather than re-point them. This item only fixes launch-evidence.json and the signedInApi.ts comment.

#### Done when

- **One copy of each helper:** `grep -rE 'function (requireAuth|requireBoardEditor|boundedString|record|sha256)\b' apps/api/src` finds exactly 1 definition each, and `type JsonRecord` 1. UUID regex literals across apps/api/src drop from 6 to 1, or to 2 if phase 3 keeps a deliberate any-version store rule.
- **File sizes after phase 5:**
- controlPlaneRoutes.ts ≤ 60 lines
- server.ts ≤ 300
- no new API route or lifecycle file > 450 lines
- **File sizes for transcription:** transcription/routes.ts ≤ 900 after phase 6, and ≤ 300 after phase 7. stream.ts is the only API file allowed above 450, as one cohesive state machine.
- **Routes unchanged:** the route-inventory snapshot (about 72 method+path pairs) is byte-identical after every phase.
- **Tests green:**
- all 195 existing API tests, plus the new characterization tests; transcription tests 20 times in a row without a flake for phase 7
- the 39 drawing-engine tests
- pnpm typecheck, lint, build, test:scripts
- the browser suite
- **Move-only diffs:** for phases 2 and 4 to 8, the --color-moved diff shows only import, export and wiring lines as new code. No logic line changes outside phase 3.
- **Deployed behaviour:** pnpm smoke:deploy and a live-session plus voice smoke pass on each new API revision, with no new error codes in Cloud Run logs for 24 hours.
- **Renderer (later):** renderer.ts ≤ 350 lines and no drawing-engine file > 650. The golden draw-call snapshot is identical in classic and lightboard themes. The @airboard/drawing-engine export key set is unchanged.

#### Depends on

**Other refactor items:**
- **Shape-model merge:** the renderer split (phase 8) waits for its delete phase, which removes about 1,000 legacy lines: drawStroke and drawAnnotationStroke, drawNodeShape with its 12 painters, and the annotation overlay. If the merge is declined, phase 8 runs standalone with the legacy code quarantined, as described there. The API phases do not depend on it.
- **Token-in-URL removal:** it overlaps with server.ts (/sessions/:id/state), security.ts and transcription authorizeRequest (configuredApiTokenAllowed). Neither item blocks the other, but they must not run in parallel. Doing token-in-URL first is slightly better, because it is small and security-relevant, and phase 5 then moves the new POST /state route.
- **Board-file split:** independent. The board file imports only renderBoard, sceneElementsForRender, exportCanvasPng and AnnotationRenderObject (plus hit tests) through the unchanged barrel.
- **Stylesheet layers:** none.
- **Eval/CI plumbing:** no CI, eval or contract script references these file paths (checked). The eval harness's ?token= dependency belongs to the token-in-URL item.
- **Docs:** this split leaves about 170 line-number citations stale. The docs item should drop them rather than re-point them.

**Outside the seven items:** the paid-launch billing work (RGB-008/009/010) should start after phase 4, so it lands in routes/billing.ts with tests already in place.
