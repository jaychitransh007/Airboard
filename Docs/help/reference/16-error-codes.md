---
title: Error codes
description: Translate common customer-visible Airboard codes into safe next actions.
category: reference
categoryLabel: Troubleshooting and reference
order: 16
status: reference
audiences: ["everyone", "admins", "support"]
lastVerified: 2026-11-06
sources: ["apps/web/src/platform/api.ts", "apps/web/src/features/product/IntegrationsPage.tsx", "apps/api/src/auth.ts", "apps/api/src/transcription/routes.ts", "apps/api/src/semanticIntent/providerError.ts", "apps/api/src/semanticIntent/routes.ts", "apps/api/src/dailyUsage.ts", "apps/api/src/organizationPolicy.ts", "apps/api/src/boardAccess.ts", "apps/api/src/boardContentRoutes.ts"]
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
| `MAINTENANCE` | Airboard is read-only for a short upgrade. Boards still open, but changes, live boards and new sessions are paused. | Wait a few minutes and try again; the banner disappears when it's over. |
| `BOARD_READ_ONLY_ROLE` | Your role in this workspace is Viewer or Billing, which can open boards but not change, share or start live sessions on them. | Ask a workspace admin to change your role if you need to edit. |
| `JOIN_LINK_REPLACED` | The host made a new live link, so this one no longer lets anyone new in. | Ask the host for the new link. |
| `EXTERNAL_GUESTS_DISABLED` | The board's workspace has turned off guests, so only its signed-in members can join live boards, and view-only links don't work. | Sign in with the account the workspace invited, or ask its admin. |
| `VOICE_DISABLED_BY_ADMIN` | A workspace admin turned off voice commands. | Use typed commands, or ask your admin. |
| `ASSET_QUOTA_EXCEEDED` | The workspace has used its 2 GB of board images and videos. | Delete boards you no longer need, or contact support. |
| `POLICY_UNAVAILABLE` | Airboard couldn't check your workspace's policy just now, so it refused rather than guess. | Try again in a moment. |
| `ACTIVE_ENTITLEMENT_REQUIRED`, `OWNER_ENTITLEMENT_REQUIRED` | The workspace's pilot or plan has ended, so new boards, live sessions and Airo voice are off. Saved boards still open and save. | Choose **Ask for more pilot time** on **Plan & billing**. |

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
| `TRANSCRIPTION_SESSION_LIMIT` | A voice stream reached its maximum length (30 minutes). | Nothing: Airo opens a new stream on its own. If nobody spoke for 20 minutes, voice pauses instead; hold an open palm or press ⏻ (Resume voice) to wake it. |
| `TRANSCRIPTION_CAPACITY_REACHED` | Airboard's voice service is at capacity. | Airo retries on its own for up to about a minute. If it still can't connect, use typed commands and try again in a minute. |
| `TRANSCRIPTION_PROFILE_LIMIT` | Your account already has Airo voice on in other tabs. | Turn Airo off in the other tab, then turn it on here. |
| `TRANSCRIPTION_RECONNECT_FAILED` | Airo's voice connection dropped and couldn't come back. | Check your network, then press ⏻ (Resume voice) on the Airo panel. Typed commands still work. |
| `DAILY_VOICE_LIMIT` | You've used today's Airo voice minutes. Each person has a daily allowance. | Use typed commands; voice comes back at midnight UTC. |
| `DAILY_AIRO_LIMIT` | You've reached today's limit for Airo commands that need its language model. | Built-in commands still work; the limit resets at midnight UTC. |
| `SERVICE_VOICE_LIMIT` | Airo voice has reached its daily limit for everyone in the pilot. | Use typed commands; voice comes back at midnight UTC. |
| `SERVICE_AIRO_LIMIT` | Airo has reached its daily limit, for everyone in the pilot, of commands that need its language model. | Built-in commands still work; Airo is back at midnight UTC. |
| `TRANSCRIPTION_PROVIDER_UNAVAILABLE` | The transcription provider could not be reached. | Airo retries on its own for up to about a minute; meanwhile use typed commands. |
| `SEMANTIC_INTENT_UNAVAILABLE` | Natural-language recovery is unavailable. | Use a canonical command; deterministic commands still work. |
| `SEMANTIC_INTENT_RATE_LIMITED` | The semantic provider is temporarily rate limited. | Wait and retry, or use a shorter canonical command. |
| `SEMANTIC_INTENT_TIMEOUT` | The provider did not answer within the bounded time. | Repeat against the current board state or use a canonical command. |
| `SEMANTIC_INTENT_MODEL_UNAVAILABLE` | The selected model is not currently available. | Choose an allowed model or use deterministic commands. |

## What to send support

Send the code, request ID, approximate time, platform and version, first failed
readiness check, and diagnostic bundle ID. Do not send a transcript, meeting
URL, board labels, credentials, or raw media.
