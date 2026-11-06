---
title: Boards, versions, and export
description: Save, rename, recover, share, and export Airboard content.
category: using-the-board
categoryLabel: Using the board
order: 9
status: shipped
audiences: ["everyone"]
lastVerified: 2026-11-06
sources: ["apps/web/src/features/product/BoardsPage.tsx", "apps/web/src/features/board/boardExport.ts", "packages/core/src/boardPreview.ts", "apps/web/src/features/board/boardLifecycle.ts", "apps/web/src/features/board/ShareDialog.tsx", "apps/web/src/features/board/ViewLinksSection.tsx", "apps/web/src/features/share/SharedBoardView.tsx", "apps/web/src/features/product/LiveBoardJoin.tsx", "apps/web/src/features/product/ViewOnlyBoard.tsx", "apps/api/src/controlPlaneRoutes.ts", "apps/api/src/boardShareRoutes.ts", "apps/api/src/server.ts"]
---

Airboard stores persistent boards and versioned board state in your workspace.
Camera and microphone media are not saved with a board.

## Find a board

**Boards** shows a small preview of each board's shapes and arrows, when it was
last updated, and whether only you or your workspace can open it. Search
matches board titles and the words on boards, so you can find a diagram by
anything written on it.

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

- **Work together now.** **Copy live link** and send it to anyone, for example
  in the meeting chat. People who open it join your board straight away, with
  no account.
  - **Can view** (the default): they watch the board change as you work.
  - **Can edit**: they draw and change it with you, and their changes save to
    your board while you have it open. You can switch at any time, and people
    already in follow the change.
  - **New link** makes a fresh link. The old one stops letting anyone new in;
    people already in stay. To remove everyone, end the session in
    **Settings → Sessions**.

  New people can join for 2 hours. The link is never put in your address bar,
  so copying the board's address doesn't share it, and reloading the page keeps
  you in the same session with the same link.
- **Who can open this board later.** In a team workspace, the board's owner
  chooses **Only you** or **Everyone in** the workspace. Shared boards appear
  under **Shared** for every member, and **Copy board link** gives members a
  link to the saved board. Only the person who made the board can change this.
  Boards in a personal workspace stay private.
- **Anyone with the link can view.** The board's owner chooses how long a link
  lasts (7 days, 30 days, or until it is turned off) and chooses **Create
  view-only link**. People who open it see the saved board without an account;
  they can move around and zoom, but not edit, and they never see who joined
  your live sessions. Copy the link straight away: Airboard shows each link only
  once. **Turn off** stops a link immediately. A board in Trash cannot be
  opened through its links. A link also stops working when the person who made
  it leaves the workspace, is suspended or becomes a Viewer, and while an admin
  has turned off **External guests**. Admins can see and turn off every link in
  **Administration → Policy**.
- **Send a picture.** **Download PNG** saves the board as an image.

Members whose role is **Viewer** or **Billing** open boards view-only: they can
move around and zoom, but not edit, share, move to Trash or restore.

When you choose **Can edit**, anyone with the live link can change the board
while it works, so share it only with the people you are working with.

## Trash and restore

Moving a board to Trash saves its latest state and soft-deletes the board. Open
**Boards → Trash** to restore it before the organization recovery window
expires. Administrators can configure that window within allowed limits.

## Export

From the board menu (**•••**):

- **Export PNG** saves the board as an image.
- **Export PDF** saves it as a one-page PDF, ready to email or print.
- **Copy image** puts the board on your clipboard to paste into chat, a doc or
  slides. **Share → Copy image** does the same. If your browser blocks
  copying images, use **Export PNG** instead.

Review an export for customer or confidential content before sending it outside
your organization. If an admin turns off **Exports**, these buttons stop
working for everyone in the workspace.
