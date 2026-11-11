---
title: Create your first board
description: Create, connect, rename, and undo a small diagram with or without voice and camera input.
category: getting-started
categoryLabel: Getting started
order: 3
status: shipped
audiences: ["everyone"]
lastVerified: 2026-11-11
sources: ["apps/web/src/features/product/AirboardsHome.tsx", "apps/web/src/features/product/AuthenticatedAirboard.tsx", "apps/web/src/features/board/AirboardPrototype.tsx"]
---

This walkthrough creates a two-object diagram. You can complete it with typed
commands and a pointer; camera and microphone input are optional.

## Create the board

1. Sign in. On **Airboards**, choose **Create Airboard**.
2. The board opens as **Untitled Airboard**. Click the title in the top bar to
   rename it.

Your free one-month pilot starts when your first board opens. No card is needed.

## Add two objects

In the Airo typed composer, enter:

```text
add a user named Customer on the left
```

Then enter:

```text
add a service named API on the right
```

You can instead place them from the bottom tool dock: choose **Shape**, then
**More shapes**, and pick **User**, then **Service** (in Advanced, or search). With supported camera input, choose a tool, move onto
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

Press `Cmd/Ctrl+Z`, choose the **Undo** arrow at the bottom left of the board,
or say “Airo, undo.” Airboard reverts the latest board transaction. Redo the
rename with `Cmd/Ctrl+Shift+Z`, the **Redo** arrow beside it, or “Airo, redo”
when you are ready.

## Confirm the board was saved

Choose **←** (Back to boards) in the top bar to return to **Airboards**, and
reopen the board. The title, latest version, objects,
and connector should remain available. If saving fails, keep the board open and
follow [Troubleshooting](/help/reference/troubleshooting).
