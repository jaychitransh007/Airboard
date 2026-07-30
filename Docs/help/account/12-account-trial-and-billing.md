---
title: Account, trial, and billing
description: Understand account setup, invitations, trial activation, expiry, and gated paid checkout.
category: account
categoryLabel: Account and administration
order: 12
status: gated
audiences: ["everyone", "billing", "admins"]
lastVerified: 2026-07-30
sources: ["Docs/Commercial Platform Runbook.md", "apps/web/src/features/product/BillingPage.tsx", "apps/web/src/features/product/InvitePage.tsx"]
---

Airboard supports personal and organization workspaces. Your current workspace,
role, trial, and entitlement determine which product actions are available.

## Create or join an account

Sign in with an enabled identity provider or email magic link. Airboard creates
a personal workspace for a new profile. An invitation can add the same identity
to another organization without creating a duplicate account.

Use the exact email address that received an invitation. Expired, revoked,
already-used, or email-mismatched invitations cannot be accepted.

## Trial activation

The controlled-pilot trial lasts 72 hours after a qualifying first-value event.
Signup alone does not consume the trial. Successful standalone or Meet
preflight can activate it when the product confirms the required value event.

The portal shows the current trial or entitlement state. At expiry, continued
access depends on an active entitlement or managed evaluation.

## Paid checkout

Paid checkout is available only when the billing page explicitly shows it as
enabled. Otherwise displayed prices are proposals, no payment is taken, and the
page directs you to the managed evaluation path.

When checkout is enabled, Stripe handles payment details. Airboard stores the
billing references and entitlement state needed to provide access.

## Workspace roles

Owners and administrators manage organization settings. Billing access,
member access, and viewer capabilities depend on assigned roles and policy.
Switch organizations from the portal workspace switcher when you belong to
more than one.
