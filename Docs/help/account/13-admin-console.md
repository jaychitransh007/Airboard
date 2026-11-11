---
title: Admin console
description: Manage members, policy, identity setup, installation health, and audit events.
category: account
categoryLabel: Account and administration
order: 13
status: shipped
audiences: ["admins", "owners"]
lastVerified: 2026-11-06
sources: ["apps/web/src/features/product/AdminPage.tsx", "apps/api/src/controlPlaneRoutes.ts", "apps/api/src/boardShareRoutes.ts", "apps/api/src/organizationPolicy.ts", "Docs/Commercial Platform Runbook.md"]
---

Organization owners and administrators see the Administration section in the
Airboard portal when a team workspace is selected; personal workspaces have no
administration. Changes apply to the currently selected organization.

## Members and invitations

Invite members with the intended organization role. Revoke unused invitations,
change a member's role, and suspend access when a person no longer needs the
workspace. Ask invitees to
sign in with the address that received the invitation.

- **Owner** and **Admin** manage the workspace and edit boards.
- **Member** creates, edits and shares boards.
- **Viewer** and **Billing** open the workspace's shared boards view-only. They
  can't create, edit, share or delete boards, or start live
  sessions. Billing also manages the plan.

## Organization policy

Policy applies to everyone in the workspace, in Airboard and the Meet
extension. Review it before troubleshooting an apparently missing feature.

- **External guests.** When off, only signed-in members can join live boards,
  new view-only links can't be made, and every existing view-only link stops
  working until it's turned back on.
- **Voice commands.** When off, Airboard refuses voice for everyone in the
  workspace. Typed commands still work.
- **Camera and gesture input** and **Gesture control.** When off, the camera
  doesn't start for hand gestures.
- **Exports.** When off, **Export PNG**, **Export PDF** and **Copy image** stop
  working. People can still take screenshots.

Changes reach people the next time they open a board. People already in a live
session keep their access until it ends.

**View-only links** lists every working link anyone in the workspace has made,
with its board and who made it. **Turn off** stops a link at once and records
it in the audit log.

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
