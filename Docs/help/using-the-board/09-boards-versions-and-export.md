---
title: Boards, versions, and export
description: Save, rename, recover, share, and export Airboard content.
category: using-the-board
categoryLabel: Using the board
order: 9
status: shipped
audiences: ["everyone"]
lastVerified: 2026-07-30
sources: ["apps/web/src/features/product/BoardsPage.tsx", "apps/web/src/features/board/boardLifecycle.ts", "apps/api/src/controlPlaneRoutes.ts"]
---

Airboard stores persistent boards and versioned board state in your workspace.
Camera and microphone media are not saved with a board.

## Save and rename

Board changes save through the authenticated workspace. The board header shows
the current title and save state. Rename from the header or the board library.

If a save warning appears, keep the page open, confirm your connection, and
retry before navigating away.

## Versions

Saved board records include a latest version. Treat version history as a board
recovery aid, not as a substitute for checking the current visible state before
a presentation.

## Visibility and sharing

Board availability depends on its visibility setting, workspace membership,
and organization policy. Confirm that the intended recipient has access; do not
assume a copied URL grants permission.

## Trash and restore

Moving a board to Trash saves its latest state and soft-deletes the board. Open
**Boards → Trash** to restore it before the organization recovery window
expires. Administrators can configure that window within allowed limits.

## Export

Use **Export PNG** from the board menu. Review the exported image for customer
or confidential content before sending it outside your organization.
