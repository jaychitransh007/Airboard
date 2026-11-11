---
title: Account, trial, and billing
description: Understand account setup, invitations, trial activation, expiry, and gated paid checkout.
category: account
categoryLabel: Account and administration
order: 12
status: gated
audiences: ["everyone", "billing", "admins"]
lastVerified: 2026-11-11
sources: ["Docs/Commercial Platform Runbook.md", "apps/web/src/features/product/BillingPage.tsx", "apps/web/src/features/product/planLabels.ts", "apps/web/src/features/product/OneTapRequestButton.tsx", "apps/web/src/features/product/InvitePage.tsx"]
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

The pilot lasts one month (30 days) after a qualifying first-value event.
Signup alone does not consume the trial; it starts when you open your first
board.

**Plan & Billing**, in the profile menu at the top right, shows when your
pilot runs until. Before you open your first board, it says the pilot has not
started yet.

## When the pilot ends

**Plan & Billing** shows the date your pilot ended. Your saved boards still
open and save, and you can still download pictures. New boards, live links and
Airo voice are off until your pilot is extended.

Choose **Ask for more pilot time** on **Plan & Billing**. The request goes to
the Airboard team, who will get back to you. The same button appears when you
try to start a new board, and **Share** links to it.

## Paid checkout

Paid checkout is available only when the billing page explicitly shows it as
enabled. Otherwise displayed prices are proposals, no payment is taken, and the
page directs you to the managed evaluation path.

When checkout is enabled, Stripe handles payment details. Airboard stores the
billing references and entitlement state needed to provide access.

## Workspace roles

Owners and administrators manage the workspace in **Settings**. Billing
access, member access, and viewer capabilities depend on assigned roles and
policy. When you belong to more than one workspace, switch in **Settings →
Workspace**. See [Workspace administration](/help/account/admin-console).
