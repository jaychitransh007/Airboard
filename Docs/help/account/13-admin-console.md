---
title: Admin console
description: Manage members, policy, identity setup, installation health, and audit events.
category: account
categoryLabel: Account and administration
order: 13
status: shipped
audiences: ["admins", "owners"]
lastVerified: 2026-07-30
sources: ["apps/web/src/features/product/AdminPage.tsx", "apps/api/src/controlPlaneRoutes.ts", "Docs/Commercial Platform Runbook.md"]
---

Organization owners and administrators see the Administration section in the
Airboard portal. Changes apply to the currently selected organization.

## Members and invitations

Invite members with the intended organization role. Revoke unused invitations
and remove access when a person no longer needs the workspace. Ask invitees to
sign in with the address that received the invitation.

## Organization policy

Policy controls which platforms and capabilities organization members can use,
including media features, export behavior, external guests, and the deleted
board recovery window. Review policy before troubleshooting an apparently
missing feature.

## SSO and SCIM

Configure SAML or OIDC metadata and SCIM tokens from **SSO & SCIM**. Production
identity-provider enforcement remains off until an Airboard operator verifies
and activates the matching configuration. Record a newly created SCIM token
when it is displayed; revoke tokens that are no longer in use.

## Installation health

Review platform, version, status, consent, last-seen, and last-success state.
Revoke installations that are outdated, lost, or no longer authorized. A
connected status does not replace a fresh preflight before a real meeting.

## Audit log

Use audit events to review accountable organization actions. Audit metadata is
bounded and does not include raw media, meeting transcripts, or board labels.
Export only when your organization policy permits it.
