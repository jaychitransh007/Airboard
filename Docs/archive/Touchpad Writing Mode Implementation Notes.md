# Touchpad Writing Mode Implementation Notes

## Pivot

Touchpad Writing Mode is Airboard's camera-free precision path for freehand writing. It uses browser Pointer Events, because web browsers do not expose raw laptop trackpad contact geometry consistently. The board opens in Intent Canvas (`gesture`) mode; Touchpad Writing is the other choice in the input selector.

## Implemented V1 Behavior

- Chosen from the input selector; the default input mode is `Intent Canvas` (`AirboardInputMode` is `"touchpad" | "gesture"`).
- Camera is optional and hidden unless enabled.
- Press/click and drag on the canvas starts a marker stroke.
- Release commits the stroke.
- Moving without pressing shows a hover cursor and does not draw.
- Hold `E` and drag to erase.
- Eraser tool can also be selected from the UI.
- Hold `Shift` while drawing to commit a straight line.
- `Cmd/Ctrl+Z` undoes the last local stroke or restores the last local erase.
- Pointer capture is used on pointer down.
- Pointer leave / lost capture / browser blur safely ends active touchpad input.
- Trackpad wheel/scroll over the board is prevented inside the canvas, while `ctrlKey` wheel events are ignored as zoom intent.
- Tiny accidental strokes are discarded if they are too short or have too few points.
- Touchpad strokes use normalized board events and reducer state, not direct canvas mutation.

## UI

The input selector exposes:

- `Touchpad Writing`
- `Intent Canvas` (the default)

Touchpad controls expose:

- marker / eraser
- Simple / Presenter / Precision variants
- marker color
- stroke thickness
- eraser radius

The status panel shows whether Touchpad Mode is ready, drawing, erasing, panning, paused, or waiting for board focus.

## Data Model Additions

- `StrokeInputSource` includes `touchpad`, `mouse`, `stylus`, `air_gesture`, `physical_marker`, `hand_gesture`, and `pointer`.
- `StrokePoint` includes optional `pointerType`.
- `EraseAction` includes optional `inputSource`.
- `CursorState` includes optional `inputSource`.
- `stroke.restored` event restores erased strokes for undo.

## Deferred Work

- Realtime broadcast throttling for pointer points and cursor moves.
- Dedicated Precision Pad capture area.
- Shape cleanup for rectangles, circles, arrows, and labels.
- Segment-level erasing.
- Meet-specific side panel focus hints.
- Native companion exploration for richer trackpad capture.
