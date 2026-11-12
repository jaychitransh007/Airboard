# Backup and restore

What Airboard can recover after data loss, and how to prove it. This is evidence
for the standalone-GA gate `backup-restore`: "a production-like backup restore
proves the stated recovery point and recovery time."

**Owner:** Engineering.
**Status (6 November 2026):** backups were confirmed read-only (no data touched). The restore exercise is waiting on the owner's choice of method below.

## What is backed up today

| Data | Where | Backup | Worst-case loss |
| --- | --- | --- | --- |
| Accounts, workspaces, boards (latest content), share links, invitations, audit log | Supabase Postgres `ujotgzjpkocuhtfrvbzu`, Mumbai | Supabase daily physical backups (listed 6 Nov 2026: 06 Nov 02:31 UTC and 05 Nov 05:05 UTC) | Up to about 24 hours of changes |
| Board pictures and uploads | Supabase Storage, same project | **Not backed up.** Supabase database backups hold only the files' metadata, not the files | A deleted or lost file is gone |
| Sign-in identities | Supabase Auth, which keeps its data in the same Postgres | With the daily backups | Up to about 24 hours |
| Live session state | API memory, plus Supabase Realtime | Not backed up; it's rebuilt from saved boards | The unsaved seconds of a live session |
| Code and releases | GitHub and Artifact Registry | Every release image tagged `live` is kept | None |

Point-in-time recovery (restoring to any second) is a paid Supabase add-on, and
it is not enabled. Airboard keeps only each board's latest state: saves stopped
writing copies to `board_versions` on 12 November 2026 (nothing ever read
them), and migration `20261112120000_drop_unused_tables` drops that table, so
there is no per-board history to go back to either.

## The promise to make

Proposed, for the owner to confirm:
- **Recovery point:** up to 24 hours of changes may be lost if the database is lost. Board pictures are not recoverable once deleted.
- **Recovery time:** a database restore within 4 hours of deciding to restore. This needs the exercise below to confirm it.

To shorten the recovery point, enable Supabase point-in-time recovery. To
protect pictures, copy Storage to a second bucket on a schedule.

## The restore exercise (not yet run)

The exercise must never overwrite production: restoring a daily backup in place
replaces the live database. Pick one way to run it:

1. **Supabase "restore to a new project" (recommended):**
   - Restore the latest daily backup into a new, temporary project in the Aura organization.
   - Time it, then check the data: row counts for profiles, boards, share links and invitations against production, and open three boards through a local API pointed at the copy.
   - **Costs** a few hours of a small project.
   - **Afterwards** the founder deletes the temporary project, since it holds a copy of customer data.
2. **Database dump into a local database:**
   - Dump production's data with `supabase db dump` and load it into a Postgres on the founder's Mac, then check it the same way.
   - **Free**, but it copies customer data to a laptop, so the files must be deleted afterwards.
   - It also proves less: it tests a dump we took, not Supabase's own backups.

Record the result:

| Field | Value |
| --- | --- |
| Date | |
| Method | |
| Backup used (time) | |
| Time from decision to usable database | |
| Data checks and results | |
| Problems found | |
| Temporary copy deleted (by whom, when) | |

## Change log

| Date | Change |
| --- | --- |
| 2026-11-06 | Confirmed daily backups exist (read-only listing). Found that Storage files aren't covered and point-in-time recovery is off. Proposed recovery targets and the exercise. |
