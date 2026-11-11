---
title: Desktop overlay
description: Draw over slides, a prototype or any app on your screen, right from the Airboard web app.
category: integrations
categoryLabel: Integrations
order: 11
status: shipped
audiences: ["everyone", "creators"]
lastVerified: 2026-11-12
sources: ["apps/web/src/features/board/AirboardPrototype.tsx", "apps/web/src/features/board/screenUnderlay.ts", "apps/web/src/features/board/lightboardComposition.ts", "apps/web/src/features/board/lightboardRecorder.ts"]
---

The desktop overlay lets you draw over anything on your screen, such as slides,
a prototype, a dashboard or any other app, from the Airboard web app. Airboard
shows the screen or window you choose behind your board, and your diagram sits
on top. There's nothing to download: this happens in your browser tab, and
there is no separate desktop app.

## Draw over an app or slides

1. Open the app or slides you want to draw over.
2. Open an Airboard in Chrome, or in Edge on Windows.
3. Open the board menu (**•••**) and choose **Show a screen behind the board**.
4. In the browser's picker, choose the window or screen with your content (not
   the Airboard tab itself), then choose **Share**.
5. Draw, type or speak as usual. Your diagram appears on top of the screen you
   chose.

Airboard switches to the Lightboard theme and adds a light dim with local
contrast behind your diagram, so it stays readable over busy content.

## Adjust how it looks

Open **•••**, choose **Board settings**, and under **Appearance**:

- Drag **Dark overlay** to dim the screen behind the board more or less.
- Turn **Local contrast behind diagram clusters** off or on.

## Show it to others

- **In Google Meet:** present your Airboard tab. Everyone sees your screen with
  the diagram on top. See [Use Airboard in Google Meet](/help/integrations/google-meet).
- **As a video:** in **Board settings**, under **Studio**, choose **Start
  recording** to save what a viewer sees as a video file on your computer.
- **As a picture:** **Share** → **Export PNG** saves the diagram itself as an
  image.

## Hide the diagram

Choose the eye icon (**Hide diagram**) at the bottom left of the board, press `Shift+H`, or snap your thumb and
middle finger. The screen stays behind the board until you bring the diagram
back.

## Stop

Open **•••** and choose **Stop the screen behind the board**, or choose **Stop
sharing** in the browser's sharing bar.

## Good to know

- The overlay lives in your Airboard tab and shows a live picture of the app
  you chose. To click or type in that app, switch to it, then come back to
  Airboard to keep drawing.
- Airboard uses the screen you choose only to show it behind your board, in
  your browser.
- The browser asks you to choose a screen each time you start.
