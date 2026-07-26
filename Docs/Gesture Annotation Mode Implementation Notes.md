# Gesture Annotation Mode Implementation Notes

> **Historical implementation note.** Mid-air path-to-shape inference and the
> left-hand duster described below are not the current Intent Canvas workflow.
> See [Gesture Interaction Audit](./Gesture%20Interaction%20Audit.md) for the
> supported production gesture vocabulary.

## Summary

Gesture Annotation Mode pivots Airboard away from full mid-air handwriting. The gesture path is now treated as intent input, and the board commits clean annotation objects:

- Circles become cleaned ellipses.
- Rectangular closed gestures become flow nodes.
- Straight gestures become arrows.
- Lines between existing nodes become snapped connectors.
- Short sweep gestures become highlights.
- Left-hand duster or Shift/Alt drag erases whole objects.
- Flow nodes and connectors open a keyboard label prompt.

## Implemented Files

- `apps/web/src/features/board/gestureAnnotationMode.ts`
  - Heuristic path classifier for circle, flow node, arrow, connector, and highlight.
  - Node palette object creation.
  - Connector snapping to existing node bounds.
- `apps/web/src/features/board/AirboardPrototype.tsx`
  - Default input mode is now `Gesture Annotation`.
  - Camera gesture paths commit clean annotation objects instead of raw strokes.
  - Mouse/trackpad drag in Gesture Mode uses the same classifier for reliable local testing.
  - Added node template palette and keyboard label editor.
  - Added Gesture Mode status, last intent, object confidence, and connector snap setting.
- `packages/core/src/types.ts`
  - Added structured stroke annotation metadata.
  - Added `stroke.label_updated` event.
- `packages/core/src/boardReducer.ts`
  - Handles annotation label updates.
- `packages/drawing-engine/src/renderer.ts`
  - Renders ellipse, flow node, database, decision, highlight, arrow, connector, and labels.
- `packages/drawing-engine/src/hitTest.ts`
  - Eraser hit testing now includes annotation object bounds.

## How to Test

1. Open `http://localhost:3000`.
2. Confirm `Input Mode` is `Gesture Annotation`.
3. Test without camera first:
   - Drag a circle: it should become a clean ellipse.
   - Drag a rectangle/box: it should become a clean flow node and open the label input.
   - Type a label and press Enter or Save.
   - Drag a line: it should become an arrow.
   - Create two flow nodes from the palette, then drag from one node to the other: it should create a snapped connector and open the label input.
   - Hold Shift while dragging over an object: it should erase the object.
4. Test with camera:
   - Click `Camera`.
   - Use the right hand marker gesture to draw a circle, box, arrow, connector, or highlight path.
   - Use the left-hand duster gesture to erase.
   - Watch `Intent` and `Object confidence` in the sidebar.

## Validation

The implementation passed:

- `CI=true pnpm typecheck`
- `CI=true pnpm --filter @airboard/core build`
- `CI=true pnpm --filter @airboard/drawing-engine build`
- `CI=true pnpm --filter @airboard/web build`

## Current Limits

- Voice labels are not implemented yet; keyboard labels are the reliable V1 path.
- Gesture classification is heuristic and local. It should be good enough for testing the product model, but it is not a trained intent classifier.
- Camera input still depends on MediaPipe hand detection quality. Mouse/trackpad drag is the deterministic fallback for validating the annotation layer.
