---
title: Privacy and your data
description: Learn what Airboard processes, stores, retains, exports, and deletes.
category: account
categoryLabel: Account and administration
order: 14
status: reference
audiences: ["everyone", "admins", "security"]
lastVerified: 2026-07-30
sources: ["Docs/Official Launch Readiness.md", "Docs/Commercial Platform Runbook.md", "apps/web/src/features/product/SettingsPage.tsx", "apps/web/app/[marketingSlug]/page.tsx"]
---

This article summarizes the implemented controlled-pilot behavior. It is not a
replacement for the current privacy notice or a contractual commitment.

## Account and board data

Airboard stores identity, organization membership, preferences, consent,
boards and versions, visibility and sharing records, integration state, audit
events, and billing references required to operate and secure the service.

Active boards remain until deletion. Deleted boards are purged after the
organization recovery window.

## Camera, microphone, and providers

Raw camera and microphone media is processed live and is not stored by
Airboard. Deepgram receives live audio while configured Airo transcription is
active. OpenAI can receive bounded command text and board context only when
deterministic parsing cannot safely finish an explicitly activated command.

Sanitized voice diagnostic events can persist for up to 14 days. They exclude
raw audio and are designed to exclude board labels, transcripts, meeting URLs,
credentials, and secrets.

## Analytics and diagnostics

Product analytics uses allowlisted, content-free event properties and is
deleted after 90 days. A user-created support diagnostic includes versions,
capabilities, permission state, timings, error codes, and trace IDs for seven
days.

## Export or delete your data

Open **Settings → Privacy & data** to:

- create a support diagnostic;
- request a portable JSON export;
- schedule account deletion;
- cancel an eligible queued request.

Account deletion has a seven-day cancellation window. Completed export payloads
expire after seven days.
