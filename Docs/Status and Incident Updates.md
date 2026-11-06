# Status and incident updates

How Airboard tells customers something is wrong, and evidence for the
standalone-GA gate `public-status-process`.

**Owner:** the founder, who is the release and support owner.
**Status (6 November 2026):** the page is live (`launch-09f196e`). The owner has not yet accepted the process.

## Where customers look

- **The status page** at `/status` on the Airboard site does two things:
  - It checks the website, the API ("Boards and Airo") and the database ("Saved boards") from the visitor's browser.
  - It lists ongoing incidents, plus those resolved in the last 90 days.
- **GitHub:** the incident list comes from GitHub issues labelled `incident` on the public repository: https://github.com/jaychitransh007/Airboard/issues?q=label%3Aincident

  Those issues stay readable when Airboard itself is down, so the status page and the support replies point there as the fallback.

The page makes no uptime claims and shows no uptime percentages. Add those only
after a monitoring provider measures them.

## When to post

Post an incident when customers can't do something they rely on, such as:
- signing in, or opening or saving boards;
- live boards not syncing between people;
- Airo voice or typed commands failing for most people;
- share or invite links not working;
- anything that may have exposed customer data. In that case, also follow the breach steps in [Incident and Breach Exercise](Incident%20and%20Breach%20Exercise.md).

Proposed targets, which the owner should confirm or change:
- Post within **30 minutes** of knowing.
- Update at least **every hour** while it is ongoing.
- Post a closing note within **1 working day** of the fix.

## How to post (works from the GitHub phone app)

1. **Open:** open a new issue on `jaychitransh007/Airboard`.
2. **Title:** say what's affected, in plain words, for example "Saving boards is failing" or "Airo voice is unavailable".
3. **Body:** say who is affected, what still works, and when the next update will come. Write plain sentences; the page shows text as written, not formatted Markdown.
4. **Label:** add the label `incident`. Only maintainers can add labels, and the page ignores issues opened by anyone else.
5. **Updates:** post each update as a comment. The status page shows the newest one.
6. **Resolve:** when it's fixed, add a final comment saying what happened and what changed, then close the issue. Closed incidents stay on the page for 90 days.

Never include customer names, emails, board content, secrets, or internal
addresses. The repository and its issues are public.

### Templates

> **Title:** Saving boards is failing
> **Body:** Since about 14:10 IST, boards can't be saved. Your changes stay in the
> open tab, so please keep it open. Live sessions and typed commands still work.
> Next update by 15:00 IST.

> **Update:** We found the cause, a failed release, and are rolling it back. Next update by 15:30 IST.

> **Closing note:** Fixed at 14:52 IST by rolling back the 14:05 release. Boards
> saved before 14:05 and after 14:52 are safe; edits made in between were kept
> in open tabs and saved once the fix landed. We've added a check so this
> release problem is caught before going live.

## What else to do during an incident

- **Support email:** reply to customers with the GitHub incident link.
- **Rollback, read-only and other tools:** the commands for rolling back, pausing changes (read-only), rotating secrets and turning off links are in [Incident and Breach Exercise](Incident%20and%20Breach%20Exercise.md).

## Limits

- **Status page goes down with the site:** it is served by the Airboard website, so if the website is down, so is the page. The GitHub link is the fallback, which is why every support reply should include it.
- **GitHub rate limit:** GitHub allows each visitor's network 60 unauthenticated reads an hour. If a visitor hits that, the page says updates couldn't be loaded and links to GitHub.
- **No automatic detection:** nothing posts incidents for us yet. Someone has to notice the problem. Alerting is a separate gate, `monitoring-alerts`.

## Change log

| Date | Change |
| --- | --- |
| 2026-11-06 | Replaced the placeholder status page with live checks plus incidents from GitHub issues labelled `incident`, and created the label. |
