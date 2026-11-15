# Airboard docs: who owns what

Each topic has one owning doc. Change a fact in its owner and link to it from
everywhere else; never copy a list into a second doc.

| Topic | Owner |
| --- | --- |
| What is live and where to roll back (the rollback floor) | [Project Status](Project%20Status.md) |
| What is left before each launch stage | [`ops/launch-evidence.json`](../ops/launch-evidence.json), read by `pnpm launch:check`; the one hand-written list is [Project Status](Project%20Status.md#what-is-left) |
| Engineering gaps (RGB register) | [Release Readiness Backlog](Release%20Readiness%20Backlog.md) |
| What changed and when | The change log in the [Release Readiness Backlog](Release%20Readiness%20Backlog.md#change-log), plus `git log` |
| What each stage may promise; data and retention inventory | [Official Launch Readiness](Official%20Launch%20Readiness.md) |
| How to release, operate and roll back; production config | [Commercial Platform Runbook](Commercial%20Platform%20Runbook.md) |
| Incidents and breaches | [Incident and Breach Exercise](Incident%20and%20Breach%20Exercise.md), [Status and Incident Updates](Status%20and%20Incident%20Updates.md) |
| Backups and restores | [Backup and Restore](Backup%20and%20Restore.md) |
| User-facing behaviour | [help/](help/README.md), generated into the Help Center |
| Supported channels and browsers | [Platform Support Matrix](Platform%20Support%20Matrix.md) |
| Gate evidence | [Accessibility Audit](Accessibility%20Audit.md), [Browser Matrix](Browser%20Matrix.md) |
| Product vision and interaction model | [Augmented Experience Vision and Interaction Spec](Augmented%20Experience%20Vision%20and%20Interaction%20Spec.md) |
| Engineering reference | [Voice Agent Architecture and Observability](Voice%20Agent%20Architecture%20and%20Observability.md), [Security Headers](Security%20Headers.md), [Gesture Interaction Audit](Gesture%20Interaction%20Audit.md) |
| Planned refactors | [Refactoring Plan](Refactoring%20Plan.md) |
| Point-in-time reviews and retired plans | [Cleanup Review](Cleanup%20Review.md), [archive/](archive/README.md) |

The threat model is private and kept out of git; name it in plain text, never as a link.

## Rules

- **Cite symbol names, not line numbers.** Write `requireActiveEntitlement` in `controlPlaneRoutes.ts`, not `controlPlaneRoutes.ts:1864`: line numbers go stale with the next edit.
- **Recording a deploy** changes two places: one change-log line, and the live and roll-back blocks in Project Status (current and previous release per service, and the rollback floor when a migration moves it).
- **Help sources:** a help article's `sources` may cite only files that exist and that the web image copies; `node scripts/generate-help-content.mjs --check` enforces it. Moving a cited doc means updating those `sources`.
- **Retiring a doc:** move it to `archive/` with a row in its index; don't delete it.
