# Airboard's Supabase move to Mumbai

Status: **done 2026-11-05.** Production runs on the Mumbai project. The owner deleted the Seoul project the same day. This file keeps the record of the move and the read-only switch it introduced; the move's plan is in git history.

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

**Rollback to Seoul is no longer possible:** the owner deleted `ljqxegqdfhqcmkbivldr` on 2026-11-05. Every revision older than `mumbai-fff6d97` points at that deleted project, so none of them is a valid rollback target. Roll back only to Mumbai revisions.

**Still open:**
- Resend SMTP on the owner's domain. Until then, sign-in emails reach only Aura organization members, at most 2 an hour.
- ~~Deleting the Seoul project.~~ Done by the owner on 2026-11-05 (`supabase projects delete`).
- The old Secret Manager secret `airboard-supabase-secret-key` (Seoul `service_role` key) is no longer used and can be deleted by the owner.

**New project:** `ujotgzjpkocuhtfrvbzu` ("Airboard"), in the Aura organization,
region ap-south-1 (Mumbai), Micro compute, Postgres 17.11. Created 2026-11-05
at the user's request. It signs tokens with ES256. The repo's CLI is linked to
it, and its database password is in the local `.env` as `SUPABASE_DB_PASSWORD`.

## The read-only switch

The API refuses changes while `AIRBOARD_READ_ONLY=true`, for maintenance such as a database move:

- **Changes:** every request other than GET, HEAD or OPTIONS gets `503 MAINTENANCE` with `Retry-After: 300` and CORS headers, so browsers can read it.
- **Live boards:** their connections close with `MAINTENANCE`.
- **Config:** `/auth/config` reports `readOnly: true`.
- **In the app:**
  - A banner says changes are paused, and saves say they're paused.
  - Share says live links are paused, and a guest's live link gets a "Try again" page.
  - The banner hides itself within 30 seconds of the switch going off.

### Turn it on

```bash
gcloud run services update airboard-pilot-api --project=project-1217dd57-9cac-491d-b8d --region=asia-south1 --update-env-vars AIRBOARD_READ_ONLY=true
```

```bash
gcloud run services update-traffic airboard-pilot-api --project=project-1217dd57-9cac-491d-b8d --region=asia-south1 --to-latest
```

- **Why two commands:** traffic is pinned to a named revision, so the settings change alone creates a revision that gets no traffic. The second command sends traffic to it.
- **Check:** confirm `/auth/config` reports `readOnly: true`.

### Turn it off

Run the same two commands with `AIRBOARD_READ_ONLY=false`. Every later deploy copies the service's saved settings, so turn the switch off before deploying again.
