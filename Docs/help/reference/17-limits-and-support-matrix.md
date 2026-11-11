---
title: Limits and support matrix
description: Check which Airboard surfaces are shipped or gated, and the limits that apply.
category: reference
categoryLabel: Troubleshooting and reference
order: 17
status: reference
audiences: ["everyone", "admins", "security"]
lastVerified: 2026-11-12
sources: ["Docs/Platform Support Matrix.md", "apps/api/src/config.ts", "apps/api/src/boardAssetLifecycle.ts", "Docs/Commercial Platform Runbook.md"]
---

This matrix describes the controlled-pilot implementation. It is not an uptime,
SLA, certification, or accessibility-conformance claim.

## Product surfaces

| Surface | Current status | Notes |
| --- | --- | --- |
| Standalone web workspace | Shipped pilot surface | Persistent boards, typed/pointer/keyboard input, supported voice and gestures, composition, and export |
| Google Meet | Shipped | Present your Airboard tab from Chrome, or Edge on Windows; nothing to install. The diagram appears as a presented tab, not in your Meet camera tile |
| Desktop overlay | Shipped | In the web app: show a screen or window behind the board and draw on top. There is no separate desktop app |
| Paid checkout | Gated | Available only when the billing page explicitly enables it |

## Provider-dependent capabilities

Airo realtime transcription requires its configured provider and key. Semantic
command recovery requires a separately configured intent provider. If those
providers are unavailable, pointer, keyboard, and typed canonical commands
remain available.

Airo changes shapes added from the toolbar or with typed commands as it changes
its own. It can't yet group them together with its own diagram shapes; use the
toolbar for that.

## Default service limits

Operators can configure bounded request rates, transcription duration and
throughput, semantic request concurrency, model allowlists, transcript length,
and provider timeouts. A displayed rate or capacity error is a safety boundary,
not a request to retry rapidly.

The API defaults include 30 semantic intent requests, 10 session starts, and
240 voice-trace events per minute per enforced rate-limit scope. These limits
hold across the whole service, however many servers are running. Deployment
configuration can be more restrictive.

## Images and videos on boards

- Images up to 32 MB and 40 megapixels; videos up to 100 MB.
- Each workspace can hold 2 GB of board images and videos. Deleting a board
  frees its space straight away.
- Each person can start 30 uploads a minute.
- Uploads that never finish are cleared after a day.

## Retention limits

- Product analytics: 90 days.
- Sanitized voice diagnostics: no more than 14 days.
- User-created support diagnostics: seven days.
- Export payloads: seven days.
- Deleted boards: erased straight away.
- Audit metadata: 365 days in the controlled-pilot runbook.

Check the current portal and privacy notice before making a customer or
contractual commitment.
