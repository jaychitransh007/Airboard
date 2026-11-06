# Incident and breach exercise

A runbook for outages and data breaches, and a practice ("tabletop") exercise
to run it. This is evidence for the standalone-GA gate `incident-exercise`, which
needs the exercise run and recorded.

**Owner:** the founder, who is the release, support and incident owner.
**Status (6 November 2026):** this draft hasn't been exercised yet. The record at the end is empty until the walk-through.

## Roles

The founder holds every role today. Name a backup person before a public
launch: if the founder is unreachable, nobody can roll back, pause changes or
post an update.

| Role | Who | Does |
| --- | --- | --- |
| Incident lead | Founder | Decides severity, rollback, read-only, and when it's over |
| Communications | Founder | Posts on the status page, replies to customers, sends breach notices |
| Technical responder | Founder, with Claude Code | Reads logs, rolls back, rotates secrets |
| Legal adviser | Counsel, not yet engaged | Decides notification duties for a breach |

Providers to check during an incident:
- Google Cloud status: https://status.cloud.google.com
- Supabase status: https://status.supabase.com
- OpenAI status: https://status.openai.com
- Deepgram status: https://status.deepgram.com

## Severity

| Level | Meaning | Examples | Target |
| --- | --- | --- | --- |
| S1 | Data may be exposed, or nobody can use Airboard | A leaked key; sign-in, opening or saving down for everyone | Act at once; first status post within 30 minutes |
| S2 | A main feature is down for most people | Airo voice down; live sync broken; share links failing | First post within 30 minutes |
| S3 | Degraded or affects a few people | Slow responses; one browser misbehaving | Fix in the normal flow; post if customers ask |

## First 15 minutes

1. **Confirm it:** open `/status`, then the API's readiness check:
   ```
   curl -s https://airboard-pilot-api-634900453473.asia-south1.run.app/ready
   ```
2. **Did we just release?** If something changed in the last hour, roll it back (below) before investigating.
3. **Read the errors:**
   ```
   gcloud logging read 'resource.type="cloud_run_revision" AND resource.labels.service_name="airboard-pilot-api" AND severity>=ERROR' --project=project-1217dd57-9cac-491d-b8d --freshness=1h --limit=50
   ```
   Use `airboard-pilot-web` for the website.
4. **Check the providers' status pages** listed above.
5. **Post the incident** following [Status and Incident Updates](Status%20and%20Incident%20Updates.md).
6. **If data may be exposed,** switch to the breach steps below.

## Tools

**Roll back a release.** The previous releases are listed in [Project Status](Project%20Status.md) under "Rollback".
```
AIRBOARD_RELEASE=launch-<hash> infra/cloud-run/release.sh promote api
AIRBOARD_RELEASE=launch-<hash> infra/cloud-run/release.sh promote web
```
Database migrations aren't rolled back. Each one is written to keep working with the API it replaced.

**Pause all changes (read-only).** Every change then answers "maintenance", and the app shows a banner:
```
gcloud run services update airboard-pilot-api --project=project-1217dd57-9cac-491d-b8d --region=asia-south1 --update-env-vars AIRBOARD_READ_ONLY=true
gcloud run services update-traffic airboard-pilot-api --project=project-1217dd57-9cac-491d-b8d --region=asia-south1 --to-latest
```
Turn it off the same way with `false`. Turn it off before the next deploy, because deploys copy the saved setting.

**Rotate a secret.** The API reads these from Secret Manager:
- `airboard-session-signing`: signs live-session and join tickets. Rotating it ends every live session.
- `airboard-api-token`
- `airboard-cron-secret`: also update the Cloud Scheduler job `airboard-lifecycle-hourly`, which sends it.
- `airboard-deepgram-api-key`
- `airboard-intent-api-key`: the OpenAI key.
- `airboard-supabase-secret-key-mumbai`: the Supabase service key. It is pinned to version 1, so point the service at the new version.

Steps:
1. Create the new key at the provider.
2. Add it as a new secret version.
3. Deploy, or create a new revision, so instances read it.
4. Revoke the old key at the provider.

Secret Manager writes are done by the founder.

**Turn off a share link or invite.** The board's owner can use "Turn off" in Share, and an admin can use "Revoke" in Admin › Members. To turn off every link at once, set `revoked_at` on the rows in `board_shares` in Supabase.

**Stop the hourly lifecycle job:**
```
gcloud scheduler jobs pause airboard-lifecycle-hourly --project=project-1217dd57-9cac-491d-b8d --location=asia-south1
```

## Data breach steps

A breach is any personal data seen, changed, lost or sent where it shouldn't
be. Examples: a leaked service key, one workspace seeing another's boards, or a
share link reaching the wrong people.

1. **Contain:**
   - Rotate the exposed secret, turn off the links, or switch to read-only.
   - Keep the logs: don't delete revisions, and export the relevant log entries.
2. **Assess:** what data was involved (accounts, board content, meeting speech), whose, how many people, and for how long. Write down what you know and when you learned it.
3. **Notify.** Confirm these duties with counsel; this list is not legal advice.
   - **India, Digital Personal Data Protection Act and Rules:** tell the Data Protection Board and the affected people. The Rules expect a detailed report to the Board within 72 hours.
   - **India, CERT-In directions:** report certain cyber incidents to CERT-In within 6 hours.
   - **People in the EU or UK (GDPR):** tell the supervisory authority within 72 hours where required, and the affected people when the risk is high.
   - **Team workspaces:** tell the workspace owners. Our published privacy notice doesn't yet say what we promise after a breach; counsel should add it (the `legal-approval` gate).
4. **Tell customers:** use the template below, and post on the status page without personal details.
5. **Review:** within a week, write down what happened, why, and what changes, and add the follow-ups to the [Release Readiness Backlog](Release%20Readiness%20Backlog.md).

> **Breach notice template:** On [date] we learned that [what happened]. It
> affected [what data] for [who]. We [what we did to stop it] at [time]. You
> [what they should do, or "don't need to do anything"]. Questions:
> hellosigmascience@gmail.com.

## Tabletop exercise

Run through each scenario out loud, about 15 minutes each. For each one, answer:
- What do you see first?
- What do you do in the first 15 minutes, and which command or screen do you use?
- What do you post, and when?
- When is it over?

Write the answers and any gaps in the record below.

1. **A bad release breaks saving.**
   - **Inject:** 10 minutes after a web release, two customers email saying "Couldn't save".
   - **Expected:** roll back the web to the previous release, and post an S2 incident.
   - **Questions:** were edits lost, or kept in the open tab?
2. **The database is down.**
   - **Inject:** `/ready` reports the database as unavailable, and Supabase's status page shows an outage in ap-south-1.
   - **Expected:** nothing to roll back. Post an S1 incident, consider read-only, and watch Supabase.
   - **Question:** what do customers see in the meantime?
3. **OpenAI is down, or the bill spikes.**
   - **Inject:** Airo commands fail for everyone, or OpenAI usage jumps tenfold in an hour.
   - **Expected:** built-in commands still work. Post an S2 incident.
   - **Question:** for a cost spike, is it abuse? Check the rate limits (RGB-019: they count per instance).
4. **A key leaks.**
   - **Inject:** GitHub's secret scanning, or a stranger, reports that the Supabase service key appears in a public place.
   - **Expected:** S1. Rotate the key at once, check the database logs for use of the key, and run the breach steps.
   - **Question:** who else must be told, and by when?
5. **A share link reaches the wrong people.**
   - **Inject:** a customer says a view-only link to a confidential board was posted in a public channel.
   - **Expected:** they turn it off in Share, or we revoke it in the database. Check whether the board was opened, and decide whether it counts as a breach.

## Exercise record

Fill in during the walk-through.

| Field | Value |
| --- | --- |
| Date | |
| Participants | |
| Scenarios run | |
| Decisions made | |
| Gaps found | |
| Follow-ups, with owners and dates | |

## Known gaps before running it

- **One person holds every role,** with no backup.
- **No alerts:** an outage is noticed only when someone reports it. See the `monitoring-alerts` gate.
- **No counsel engaged** to confirm notification duties.
- **Logging limits:** confirm what the API and Supabase logs record about who opened a share link or a board, and for how long. Scenario 5 depends on it.
