---
title: Admin console
description: Manage members, policy, identity setup, installation health, and audit events.
category: account
categoryLabel: Account and administration
order: 13
status: shipped
audiences: ["admins", "owners"]
lastVerified: 2026-11-05
sources: ["apps/web/src/features/product/AdminPage.tsx", "apps/api/src/controlPlaneRoutes.ts", "Docs/Commercial Platform Runbook.md"]
---

Organization owners and administrators see the Administration section in the
Airboard portal when a team workspace is selected; personal workspaces have no
administration. Changes apply to the currently selected organization.

## Members and invitations

Invite members with the intended organization role. Revoke unused invitations,
change a member's role, and suspend access when a person no longer needs the
workspace. Ask invitees to
sign in with the address that received the invitation.

## Organization policy

Policy controls what organization members can use: external guests, voice
commands, camera and gesture input, gesture control, exports, and the deleted
board recovery window in days. Review policy before troubleshooting an apparently
missing feature.

## SSO and SCIM

Enter your SAML metadata URL and verified email domains, and manage SCIM tokens,
from **SSO & SCIM**. Production
identity-provider enforcement remains off until an Airboard operator verifies
and activates the matching configuration. Record a newly created SCIM token
when it is displayed; revoke tokens that are no longer in use.

## Installation health

Review each installation's connection, version, policy, consent and
last-success state.
Revoke installations that are outdated, lost, or no longer authorized. A
connected status does not replace a fresh preflight before a real meeting.

## Audit log

Use audit events to review accountable organization actions. The page lists the
latest events, and audit events are kept for 365 days. Audit metadata is
bounded and does not include raw media, meeting transcripts, or board labels.
