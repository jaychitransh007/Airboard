---
title: Error codes
description: Translate common customer-visible Airboard codes into safe next actions.
category: reference
categoryLabel: Troubleshooting and reference
order: 16
status: reference
audiences: ["everyone", "admins", "support"]
lastVerified: 2026-07-30
sources: ["apps/web/src/platform/api.ts", "apps/web/src/features/product/IntegrationsPage.tsx", "apps/api/src/auth.ts", "apps/api/src/transcription/routes.ts", "apps/api/src/semanticIntent/providerError.ts"]
---

Error codes identify the failed capability without requiring conversation or
board content. Record the code, approximate time, platform version, and request
ID before retrying.

## Account and network

| Code | Meaning | What to do |
| --- | --- | --- |
| `NETWORK_UNAVAILABLE` | The browser could not reach the Airboard service. | Check the connection and retry without discarding unsaved work. |
| `AUTH_REQUIRED` | The request does not have a valid authenticated session. | Sign in again, then return to the same workspace. |
| `AUTH_NOT_CONFIGURED` | Authentication is unavailable in this environment. | Contact the Airboard operator; this is not fixed by changing board content. |
| `ACCOUNT_LOOKUP_FAILED` | Airboard could not load the account record. | Retry once, then contact support with the request ID. |
| `BOARD_ACCESS_DENIED` | The signed-in identity cannot access the board. | Check the selected organization and ask the board owner or administrator. |

## Extension and integration

| Code | Meaning | What to do |
| --- | --- | --- |
| `CHROME_EXTENSION_NOT_REACHABLE` | Chrome could not reach the expected extension. | Reload the extension and reopen setup from its popup. |
| `EXTENSION_LINK_FAILED` | The installation did not complete account linking. | Start Connect Airboard again and complete the one-time exchange. |
| `STANDALONE_PREFLIGHT_FAILED` | The standalone readiness check did not pass. | Review the failed capability before activating a real session. |

## Voice and intent

| Code | Meaning | What to do |
| --- | --- | --- |
| `TRANSCRIPTION_UNAVAILABLE` | Realtime transcription is not configured. | Use typed commands and notify the operator if voice is expected. |
| `TRANSCRIPTION_SESSION_LIMIT` | This account or environment has reached its active stream limit. | Close unused Airo sessions, wait briefly, and retry. |
| `TRANSCRIPTION_PROVIDER_UNAVAILABLE` | The transcription provider could not be reached. | Use typed commands and retry later. |
| `SEMANTIC_INTENT_UNAVAILABLE` | Natural-language recovery is unavailable. | Use a canonical command; deterministic commands still work. |
| `SEMANTIC_INTENT_RATE_LIMITED` | The semantic provider is temporarily rate limited. | Wait and retry, or use a shorter canonical command. |
| `SEMANTIC_INTENT_TIMEOUT` | The provider did not answer within the bounded time. | Repeat against the current board state or use a canonical command. |
| `SEMANTIC_INTENT_MODEL_UNAVAILABLE` | The selected model is not currently available. | Choose an allowed model or use deterministic commands. |

## What to send support

Send the code, request ID, approximate time, platform and version, first failed
readiness check, and diagnostic bundle ID. Do not send a transcript, meeting
URL, board labels, credentials, or raw media.
