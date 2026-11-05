# Moving Airboard's Supabase to Mumbai — plan

Status: **done 2026-11-05.** Production runs on the Mumbai project. The Seoul project is untouched and waits for the owner to delete it. Written 2026-11-05.

## What happened on 2026-11-05

The owner asked to finish the move the same day, since there was no pilot traffic. The separate rehearsal was skipped; the old project stayed untouched throughout, so rollback stayed one command.

1. **Before:** row counts were taken in both projects. Seoul had 2 sign-in users, 3 profiles, 11 boards, 193 board versions and 5,870 live-session events (24 MB in all), and no uploaded files.
2. **Writes paused:** the lifecycle job was paused, and the API was switched to read-only (revision `00033-9r7`).
3. **Data copied:**
   - Dumped with `supabase db dump --data-only --use-copy -s public,auth`. Its `-x` excludes were ignored, so the auth blocks other than `users`, `identities` and `mfa_factors` were removed from the file by hand.
   - That left out 20 flow states, 2 sessions, 2 MFA claims and 25 refresh tokens; everyone signs in again.
   - Restored into Mumbai in one transaction with `session_replication_role = replica`.
4. **Verified:**
   - All 38 tables have matching row counts.
   - Content fingerprints match for users, profiles, boards (including saved state), board versions, entitlements and trials.
   - Seoul was unchanged during the copy, and there were no storage files to copy.
5. **Keys:**
   - The owner created Secret Manager secret `airboard-supabase-secret-key-mumbai` (Mumbai `service_role` key) and granted it to the API's runtime account, `airboard-pilot-runtime@…`. The agent isn't allowed to write secrets.
   - The web build uses Mumbai's publishable key.
6. **Staged:**
   - API `airboard-pilot-api-mumbai-fff6d97`: the `launch-513185f` image with `SUPABASE_URL` set to Mumbai, the secret pinned to version 1, and read-only off.
   - Web `airboard-pilot-web-mumbai-fff6d97`: a new build pointed at Mumbai.
   - Smoke: readiness queried the Mumbai database successfully; sign-in settings came from Mumbai; forged and bad tokens got 401; the web build references only Mumbai.
7. **Switched:** both revisions promoted to 100%, and the lifecycle job resumed. A manual lifecycle run returned 200. The old browser session now lands on sign-in, as expected.
8. **Tidied:**
   - The repo's CLI is linked to Mumbai, and its version pins now match Mumbai.
   - `.env` has `SUPABASE_DB_PASSWORD` for Mumbai and `SUPABASE_DB_PASSWORD_SEOUL` for the old project.
   - The launch evidence names the Mumbai project, and the local copies of the dump were deleted.

**Rollback** (only sensible before anything new is written in Mumbai): route API traffic to `airboard-pilot-api-launch-513185f` and web traffic to `airboard-pilot-web-launch-513185f`. Both still point at Seoul.

**Still open:**
- Resend SMTP on the owner's domain. Until then, sign-in emails reach only Aura organization members, at most 2 an hour.
- Deleting the Seoul project. The owner does this; the agent isn't allowed to delete data.

**New project:** `ujotgzjpkocuhtfrvbzu` ("Airboard"), in the Aura organization,
region ap-south-1 (Mumbai), Micro compute, Postgres 17.11. Created 2026-11-05
at the user's request. It signs tokens with ES256. Its database password is in
the local `.env` as `SUPABASE_DB_PASSWORD_MUMBAI`. The repo's CLI link still
points at the Seoul project; the new project is worked on from a separate copy
of the `supabase` folder linked to it (see Phase 0, step 3).

## Why move

Most pilot users are in India. The app and API run on Cloud Run in Mumbai
(`asia-south1`), but the Supabase project `ljqxegqdfhqcmkbivldr` ("Airboard") is
in Seoul (`ap-northeast-2`). Every database call crosses that distance, about
180–225 ms each in production logs. After the board-open work (`launch-6cdeed8`),
a warm board open still spends about 1.75 s before its live session is ready,
and most of that is Mumbai–Seoul round trips.

The current project is also in the free organization "The Sigma Project". It
was paused for inactivity once (restored 2026-11-04), which a paid organization
avoids.

Supabase cannot move a project to another region. Moving means a new project
in the right region, a copy of the data, and a cut-over.

## What I found

| Organization | Project | Region | State |
|---|---|---|---|
| The Sigma Project | Airboard (`ljqxegqdfhqcmkbivldr`) | ap-northeast-2 (Seoul) | Active, current production |
| The Sigma Project | Fit-Staging, Aura-Staging | ap-south-1 (Mumbai) | Paused |
| Aura | Aura-US (`eyntrhzvzujrzzigofxw`) | us-east-1 (N. Virginia) | Active |
| [Prod] The Sigma Project | none | — | — |

- **The paid organization is "Aura"** (`fttnpgaxnjgobdpdnfut`), confirmed by
  the user on 2026-11-05. Its only project, Aura-US, is in **us-east-1**.
- The production data volume is still unknown: count-only reads of the
  production database are blocked in this session. It is a pilot (the owner
  has 5 boards), so the copy is expected to take minutes, not hours. This gets
  measured at rehearsal.

What Airboard uses in Supabase (from the repo and the live services):

- **Database:** 15 migrations in `supabase/migrations`. The `public` schema
  holds all Airboard tables, row-level security and 11 security-definer
  functions. The only extension is `pgcrypto`. There is no Vault, pgsodium,
  pg_cron, Realtime publication, webhook or edge function.
- **Auth:**
  - Email sign-in links only; Google and Microsoft are off (production `/auth/config`).
  - A trigger on `auth.users` (`on_auth_user_created_airboard`) creates each new person's workspace and trial.
  - Branded `magic_link` and `confirmation` templates and the site and redirect URLs are in `supabase/config.toml`.
  - Production has no SMTP yet, so Supabase's built-in mailer only reaches project-team addresses.
- **Storage:** one bucket, `board-assets` (uploaded images), created and secured by a migration.
- **API (Cloud Run):** `SUPABASE_URL` as a plain setting; the service-role key in Secret Manager as `airboard-supabase-secret-key`. Since `launch-6cdeed8` it checks sign-in tokens against the project's published ES256 key.
- **Web (Cloud Run):** the Supabase URL and public (anon) key are built into the image (`_SUPABASE_URL`, `_SUPABASE_ANON_KEY` build substitutions). A move needs a new web build.
- **Not touched by a move:** Cloud Run regions, the board-session signing secret, the Chrome installation tokens (stored as hashes in the database and copied with it), and the lifecycle scheduler (it calls the API).

## Decision: where Airboard goes

**Decided 2026-11-05:** Option A, a new Airboard project in the paid **Aura**
organization, region **ap-south-1 (Mumbai)**. Airboard does not go inside
Aura-US.

Supabase bills per organization: the Pro plan is $25 a month per organization,
includes $10 of compute credit, and each project adds its own compute (Micro is
about $10 a month).
([Billing FAQ](https://supabase.com/docs/guides/platform/billing-faq),
[pricing](https://supabase.com/pricing))

### Option A — a new Airboard project in the paid organization, in Mumbai (recommended)

Create a project in the paid organization with region **ap-south-1 (Mumbai)**.

- **Speed:** the database sits in the same city as the API and as most users, so each call drops from about 200 ms to a few milliseconds.
- **Separation:** Airboard keeps its own users, sign-in emails, backups and keys, separate from Aura.
- **Cost:** about $10 a month more, Micro compute for one extra project. The Aura organization's $10 compute credit is already used by Aura-US, so Airboard's compute is charged on top. Check the pricing page before creating it.
- **Pausing:** a paid organization doesn't pause projects for inactivity.

### Option B — put Airboard inside the existing paid project

Ruled out. The paid project is Aura-US, and putting Airboard inside it would mean:

- **Region:** Aura-US is in us-east-1. Mumbai to N. Virginia is farther than Mumbai to Seoul, so pages would get slower. Its region cannot be changed.
- **Shared sign-in:** a project has one set of users, one sender, one email template, one site URL and one signing key.
  - Aura users would become Airboard users and the other way round.
  - Airboard's `auth.users` trigger would create an Airboard workspace for every Aura sign-up.
- **Name clashes:** both apps would share `public`. Airboard's tables (`profiles`, `organizations`, `workspaces`…) would need their own schema, a rewrite of all 15 migrations and a default-schema change in both Supabase clients.
- **Shared blast radius:** one service-role key could read both apps' data, and restoring a backup for one app rolls back the other. Load, migrations and incidents would hit both.

It would be slower than today and would tie the two apps together.

## Before the move

1. **Working sign-in email (blocking).**
   - A new project means new signing keys, and the browser keeps its session under a key named after the project, so **everyone signs in again** after the move.
   - Sign-in is email-only, so the new project needs Resend SMTP on your own domain before cut-over; otherwise pilot users are locked out.
   - This is the pending "sending domain" item.
2. ~~**A read-only switch in the API.**~~ Built and deployed (switched off) 2026-11-05 as `launch-513185f`. With `AIRBOARD_READ_ONLY=true`:
   - every change (any method other than GET, HEAD or OPTIONS) gets `503 MAINTENANCE` with `Retry-After: 300` and CORS headers, so browsers can read it;
   - live-board connections close with `MAINTENANCE`;
   - `/auth/config` reports `readOnly: true`.

   The app then shows a banner: "Airboard is down for a short upgrade. You can still open your boards, but changes are paused for a few minutes." Saves say they're paused, Share says live links are paused, and a guest's live link gets a "Try again" page. The banner hides itself within 30 seconds of the switch going off.
3. **Pilot users told** a day ahead: a short maintenance window and a fresh sign-in afterwards.

## Steps

### Phase 0 — Set up the new project (no user impact)

1. ~~Create the project in the Aura organization, region `ap-south-1`, Micro compute.~~ Done 2026-11-05: `ujotgzjpkocuhtfrvbzu`, password in `.env` as `SUPABASE_DB_PASSWORD_MUMBAI`.
2. ~~Confirm it signs tokens with an asymmetric key.~~ Done: its JWKS lists one ES256 key.
3. ~~Build the schema from the repo's migrations.~~ Done 2026-11-05: all 15 migrations applied. The new project matches a local database built from the same migrations: 35 tables, all with row-level security, 29 policies, 9 functions, the `auth.users` trigger and the `board-assets` bucket, with no rows.
   - How: copy `supabase/` without `.temp` into a scratch folder, run `supabase link --project-ref ujotgzjpkocuhtfrvbzu --workdir <scratch>` with `SUPABASE_DB_PASSWORD` set from `SUPABASE_DB_PASSWORD_MUMBAI`, then `supabase db push --workdir <scratch>` (dry run first). This keeps the repo's own link on Seoul.
   - Before cut-over, re-run `db push` from a fresh copy so any newer migrations land too.
4. ~~Push auth settings from `supabase/config.toml`.~~ Done 2026-11-05 with `supabase config push --workdir <scratch>`: the site URL, the redirect URLs and the branded sign-in and confirmation emails. The API, database, storage and rate-limit settings already matched. **Still to do: Resend SMTP**, which needs the sending domain. Until then, this project's built-in mailer reaches only Aura organization members, capped at 2 emails an hour.
5. Build a web image with the new URL and public key, and stage an API revision whose settings point at the new project. Neither takes traffic.

### Phase 1 — Rehearsal (no user impact)

1. Copy production into the new project with the cut-over commands below, without the read-only switch.
2. Compare row counts per table, and the number of storage files, between the two projects.
3. Open the staged web and API (tag URLs) and check sign-in with an email link, the board library, opening, saving, Share and its live link, a guest joining, Trash and restore, and Billing.
4. Time the board open, and the copy itself, to size the real window.
5. Empty the new project's data again (`truncate` the copied tables) and keep its schema.

### Phase 2 — Cut-over (about 30–45 minutes, in a quiet hour)

1. Pause the Cloud Scheduler lifecycle job.
2. Turn on the read-only switch with two commands: `gcloud run services update airboard-pilot-api --project=project-1217dd57-9cac-491d-b8d --region=asia-south1 --update-env-vars AIRBOARD_READ_ONLY=true`, then `gcloud run services update-traffic airboard-pilot-api --project=project-1217dd57-9cac-491d-b8d --region=asia-south1 --to-latest`. About a minute. Deploys pin traffic to a named revision, so the settings change alone creates a revision that gets no traffic; the second command sends traffic to it. Every later deploy copies the service's saved settings, so turn the switch off the same way before deploying again. Confirm `/auth/config` reports `readOnly: true`. Live connections still open on the old revision only write session events, not saved boards, because board saves go through the API.
3. Copy the data. Following [Supabase's backup and restore guide](https://supabase.com/docs/guides/platform/migrating-within-supabase/backup-restore), but data-only because Phase 0 built the schema:
   ```bash
   supabase db dump --db-url "$OLD" -f data.sql --use-copy --data-only \
     -s public,auth \
     -x auth.sessions -x auth.refresh_tokens -x auth.flow_state \
     -x auth.one_time_tokens -x auth.audit_log_entries
   psql --single-transaction --variable ON_ERROR_STOP=1 \
     --command 'SET session_replication_role = replica' \
     --file data.sql --dbname "$NEW"
   ```
   - `session_replication_role = replica` stops the `auth.users` trigger from creating a second workspace for every copied person.
   - People keep their IDs, so profiles, boards and memberships still line up.
   - Sessions are left behind on purpose, since everyone signs in again.
   - Storage rows are not in this dump; the next step copies them.
4. Copy the `board-assets` files with Supabase's storage migration script (service keys of both projects).
5. Check that the row counts and file counts match the old project.
6. Point production at the new project:
   - add a Secret Manager version of `airboard-supabase-secret-key` with the new service-role key;
   - set the API's `SUPABASE_URL`;
   - deploy the API and the prebuilt web image as tagged, no-traffic revisions.
7. Smoke the tagged revisions: health, `/auth/config`, the owner signing in with an email link, the board library, opening and saving a board, and Share.
8. Promote both, with read-only off on the new API revision (`AIRBOARD_READ_ONLY` removed or `false`).
9. Resume the scheduler, watch the logs for an hour, and tell pilot users it's done.

### Phase 3 — Rollback

- **Before promotion:** turn the read-only switch off on the current API (`gcloud run services update airboard-pilot-api --project=project-1217dd57-9cac-491d-b8d --region=asia-south1 --update-env-vars AIRBOARD_READ_ONLY=false`, then `gcloud run services update-traffic airboard-pilot-api --project=project-1217dd57-9cac-491d-b8d --region=asia-south1 --to-latest`). The old project was never changed.
- **After promotion:** route traffic back to the current revisions, which still point at the old project. Anything written on the new project since cut-over would be lost, so this is only for the first hour. After that, fix forward.
- Keep the old project untouched, then paused, for 14 days before deleting it (your decision).

### Phase 4 — Tidy up

- Re-link the CLI (`supabase link --project-ref <new>`), refresh the version pins in `supabase/.temp`, and update `.env`.
- Update the deploy recipe's web build values, `ops/launch-evidence.json` and the runbooks that name the old project.
- Re-run the launch check.

## Expected result

- Each database call drops from about 200 ms to a few milliseconds.
- On current request counts, a warm board open should reach its live session in roughly 0.3–0.5 s instead of 1.75 s, and other pages speed up the same way.
- Rehearsal measures the real figure.

## Risks

| Risk | Mitigation |
|---|---|
| Pilot users can't sign back in | Resend SMTP on the new project is a precondition; test with a real email at rehearsal |
| Edits during the copy are lost | Read-only switch for the whole copy |
| The trigger duplicates workspaces on load | `session_replication_role = replica` during restore; counts compared afterwards |
| Auth rows don't restore cleanly | Rehearsal first; the dump's `auth` tables are the documented path, and the restore is one transaction |
| Missed setting (email templates, URLs, rate limits) | Settings come from `supabase/config.toml` via `config push`, checked in rehearsal |
| A problem found after promotion | Old project kept; rollback within the first hour; fix forward after |

## Open questions for you

1. ~~Which organization is paid?~~ Aura. The new Mumbai project goes there.
2. Your sending domain for Resend, since email has to work before the move.
3. A preferred quiet hour (IST) for the 30–45 minute window.
4. Who should have access to the new project. Members of the Aura organization
   can see every project in it, including Airboard.
