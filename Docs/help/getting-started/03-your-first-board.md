---
title: Create your first board
description: Create, connect, rename, and undo a small diagram with or without voice and camera input.
category: getting-started
categoryLabel: Getting started
order: 3
status: shipped
audiences: ["everyone"]
lastVerified: 2026-07-30
sources: ["apps/web/src/features/product/BoardsPage.tsx", "apps/web/src/features/product/AuthenticatedAirboard.tsx", "apps/web/src/features/board/AirboardPrototype.tsx"]
---

This walkthrough creates a two-object diagram. You can complete it with typed
commands and a pointer; camera and microphone input are optional.

## Create the board

1. Sign in and choose **New Airboard**.
2. Complete any displayed standalone preflight.
3. Give the board a name when prompted or rename it from the board header.

Your trial begins at the first qualifying value event shown by the product, not
simply when you open the signup page.

## Add two objects

In the Airo typed composer, enter:

```text
add a user named Customer on the left
```

Then enter:

```text
add a service named API on the right
```

You can instead choose the User and Service tools from the object dock and
place them with a pointer. With supported camera input, choose a tool, move onto
the canvas, close one hand, wait for the holding state, position the preview,
and reopen.

## Connect and rename

Enter:

```text
connect Customer to API as request
```

Select the API object and press `Enter` or `F2` to edit its label. Change it to
`Payments API`, then confirm the edit.

## Undo safely

Press `Cmd/Ctrl+Z` or choose **Undo**. Airboard reverts the latest board
transaction. Redo the rename when you are ready.

## Confirm the board was saved

Return to **Boards** and reopen the board. The title, latest version, objects,
and connector should remain available. If saving fails, keep the board open and
follow [Troubleshooting](/help/reference/troubleshooting).
