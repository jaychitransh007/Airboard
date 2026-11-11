---
title: Use Airboard in Google Meet
description: Present your Airboard tab in a Google Meet call, with nothing to install, and keep drawing with your voice, hands, keyboard and mouse.
category: integrations
categoryLabel: Integrations
order: 10
status: shipped
audiences: ["everyone"]
lastVerified: 2026-11-11
sources: ["apps/web/src/features/board/AirboardPrototype.tsx", "apps/web/src/features/board/ShareDialog.tsx", "apps/web/src/features/board/screenUnderlay.ts", "apps/web/src/features/board/lightboardComposition.ts"]
---

To use Airboard in Google Meet, you present your Airboard tab, the same way you
would present slides. Everyone in the call sees you and your diagram, and you
keep drawing with your voice, hands, keyboard and mouse. There is nothing to
install.

## Before you start

- Use Google Chrome on Windows or macOS, or Microsoft Edge on Windows. See
  [System requirements](/help/getting-started/system-requirements).
- Sign in to Airboard and join the Meet call in the same browser, so your
  Airboard tab appears when you present.
- Camera and microphone are optional. Without them you can still type commands
  and use the mouse while you present.

## Present your board

1. Open the board in its own tab: on **Airboards**, open a board or choose
   **Create Airboard**.
2. The first time, choose **Allow** when the browser asks for the camera and
   microphone. Airo then starts on its own on every board: your camera shows
   behind the board, and Airo listens for voice and hand commands.
3. Go to the Meet tab and choose **Present now** (newer versions of Meet call
   it **Share screen**).
4. Choose **A tab** (Chrome may call it **Chrome Tab**), select your Airboard
   tab, and choose **Share**.
5. Go back to the Airboard tab and start drawing. Everyone in the call sees it.

To draw over slides or another app instead of your camera, choose **Show a
screen behind the board** in **•••** before you present. See
[Desktop overlay](/help/integrations/desktop-overlay).

## What the audience sees

- Your Airboard tab, presented in the call: the diagram, with your camera or
  chosen screen behind it.
- The board's top bar, tool dock and Airo panel, exactly as they look on your
  screen.

The diagram appears as a presented tab, not inside your normal Meet camera
tile. Because the tab already shows you behind the board, you can turn off
your Meet camera while you present so you don't appear twice.

To hide the diagram for a moment and keep your camera showing, choose **Hide
diagram** in **•••**, press `Shift+H`, or snap your thumb and middle finger.

## Use voice, hands, typing and the mouse

Everything keeps working in the Airboard tab while you present:

- **Voice:** say `Airo` with your command, or hold one open palm still for
  about 0.4 seconds, then speak. Ordinary conversation in the call doesn't
  change the board. See [Airo voice](/help/using-the-board/airo-voice).
- **Hands:** aim, choose, move and place objects with
  [camera gestures](/help/using-the-board/gestures).
- **Typing and mouse:** type in the Airo panel, or use the tool dock and the
  pointer.
- **Undo:** press `Cmd/Ctrl+Z`, choose **•••** then **Undo**, or say “Airo,
  undo.”

You control the board from the Airboard tab. If you switch to the Meet tab to
read the chat or see people, switch back to the Airboard tab to keep drawing.

## Let others edit (optional)

Presenting is enough for everyone to see the board. To let people draw with
you:

1. Choose **Share** in the board's top bar.
2. Under **Work together now**, choose **Can edit**.
3. Choose **Copy live link** and paste it into the Meet chat.

People who open the link join your board straight away, without an account.
See [Boards, versions, and export](/help/using-the-board/boards-versions-and-export)
for how live links work.

## Stop presenting

1. In Meet, choose **Stop presenting**, or choose **Stop sharing** in the bar
   the browser shows above the shared tab.
2. Airboard stops using your camera and microphone when you leave the board.
   To keep either one off on every board, turn it off in **Settings →
   Preferences**.

Your board saves as you go.

## Troubleshooting

- **My Airboard tab isn't in the list.** Open Airboard in the same browser as
  Meet, then choose **Present now** again.
- **My camera is busy, or black in one of the tabs.** Turn off your Meet camera
  while you present; the audience sees you behind the board instead. If the
  browser asks, allow the camera for Airboard.
- **Airo doesn't respond.** Switch to the Airboard tab and check the Airo
  panel. If it says the camera and microphone are blocked, allow them for
  this site in your browser's settings, then reload the board. If voice
  paused, hold an open palm to wake it. You can always type the command
  instead.
- **Someone can't join with the live link.** New people can join for 2 hours.
  If you chose **New link**, send the new one. If your workspace admin turned
  off external guests, only signed-in members of your workspace can join.

For anything else, see [Troubleshooting](/help/reference/troubleshooting).
