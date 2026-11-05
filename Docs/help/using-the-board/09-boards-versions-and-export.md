---
title: Boards, versions, and export
description: Save, rename, recover, share, and export Airboard content.
category: using-the-board
categoryLabel: Using the board
order: 9
status: shipped
audiences: ["everyone"]
lastVerified: 2026-11-05
sources: ["apps/web/src/features/product/BoardsPage.tsx", "apps/web/src/features/board/boardLifecycle.ts", "apps/web/src/features/board/ShareDialog.tsx", "apps/web/src/features/product/LiveBoardJoin.tsx", "apps/api/src/controlPlaneRoutes.ts"]
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

## Share a board

Choose **Share** in the board header.

- **Edit together now.** **Copy live link** and send it to anyone, for example
  in the meeting chat. People who open it join your board straight away, with
  no account, and can edit with you. Their changes save to your board while you
  have it open. A live link stops working after 6 hours; copy a fresh one from
  **Share** when you need it.
- **Who can open this board later.** In a team workspace, the board's owner
  chooses **Only you** or **Everyone in** the workspace. Shared boards appear
  under **Shared** for every member, and **Copy board link** gives members a
  link to the saved board. Only the person who made the board can change this.
  Boards in a personal workspace stay private.
- **Send a picture.** **Download PNG** saves the board as an image.

Anyone with a live link can edit while it works, so share it only with the
people you are working with.

## Trash and restore

Moving a board to Trash saves its latest state and soft-deletes the board. Open
**Boards → Trash** to restore it before the organization recovery window
expires. Administrators can configure that window within allowed limits.

## Export

Use **Export PNG** from the board menu. Review the exported image for customer
or confidential content before sending it outside your organization.
