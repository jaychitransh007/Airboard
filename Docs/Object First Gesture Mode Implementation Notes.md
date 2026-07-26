# Object-First Gesture Mode Implementation Notes

> **Current interaction reference:** See
> [Gesture Interaction Audit](./Gesture%20Interaction%20Audit.md) for exact
> poses, arbitration rules, missing gestures, and audience-specific gaps.

## Summary

Gesture Mode now behaves as an object-first annotation surface instead of a drawing classifier. Users choose a clean object from the left dock, drag the ghost into place, and then select, move, resize, relabel, reconnect, or erase it.

Camera gestures are now used as pointer/select/move/erase input. Mid-air shape inference is no longer the primary workflow.

## Implemented Behavior

- Left object dock on the board:
  - Select, Flow, Service, Database, Queue, User, API, Decision, Note, Circle, Box, Arrow, Connector, Highlight, Eraser.
- Placement:
  - Choosing an object creates a translucent ghost.
  - Pointer movement or camera cursor movement updates the ghost.
  - Pointer press/hold/release or camera close-hand/move/open commits the object. Camera placement works before the ghost exists as a committed board target.
  - Connector and arrow placement uses drag start/end points.
- Editing:
  - Click an object to select it.
  - Drag selected object body to move.
  - Drag corner handles to resize bounds-based objects.
  - Drag connector/arrow endpoint handles to reconnect or resize.
  - Connector endpoints snap to nearby node bounds when auto-snap is enabled.
  - Delete/Backspace removes the selected object.
  - Labels open as a floating editor near selected nodes/connectors.
- Camera object control:
  - Object grab is intentionally separate from the old freehand writing classifier.
  - Multi-finger fist strength above the object-control threshold starts `grab`; opening the hand ends it.
  - A committed object must be highlighted before a normal grab starts; the focused target then stays latched during movement.
  - The sidebar `Object control` row shows `hover`, `placing`, `grab`, `no target`, or `erase`, and only reports a grab when a real object or placement interaction is active.
- Rendering:
  - Selected objects show outlines and handles.
  - Hovered objects show a lightweight outline.
  - Placement ghosts are rendered without persisting.
- Data model:
  - Persisted objects still use `Stroke.annotation`.
  - Object edits use `stroke.annotation_updated` with replacement annotation metadata and geometry points.

## How to Test

1. Open `http://localhost:3000`.
2. Confirm `Input Mode` is `Intent Canvas`.
3. Use the left dock:
   - Click `Flow`, move over the board, press and drag, then release to place.
   - Type a label in the floating editor and save.
   - Click `Circle` or `Box`, place it, then drag the corner handles to resize.
   - Click `Arrow`, drag from start to end, and release.
   - Create two nodes, click `Connector`, drag from one node to another, and release.
   - Select a connector endpoint and drag it to another node to re-snap.
   - Click `Eraser` or hold Shift while dragging over an object to erase.
4. Camera path:
   - Click `Enable hands`.
   - Choose `Flow`, close the hand, move it, and open it. Watch `Object control` change to `placing`, then confirm `Visible strokes` increases only after opening.
   - Switch to `Select`, use an open hand to highlight the committed object, close all four fingers, move, and reopen. Watch `Object control` change from `hover` to `grab` only after a target is acquired.
   - Close over empty board space and confirm the state says `no target` rather than `grab`.

## Validation

- `CI=true pnpm typecheck`
- `CI=true pnpm --filter @airboard/core build`
- `CI=true pnpm --filter @airboard/drawing-engine build`
- `CI=true pnpm --filter @airboard/core test`
- `CI=true pnpm --filter @airboard/drawing-engine test`
- `CI=true pnpm --filter @airboard/web build`
