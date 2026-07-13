# Physical Marker Prop Mode Implementation Notes

## Scope

V1 Marker Mode lets a user hold a normal pen, pencil, marker, or stylus in the right hand and use it as the Airboard drawing input. It does not require special hardware. The implementation uses MediaPipe hand landmarks, estimates a virtual marker tip, and feeds that point into the Virtual Surface Friction Engine.

## Runtime Flow

```text
Camera frame
-> MediaPipe Hand Landmarker
-> PhysicalMarkerTracker
-> marker grip detector
-> marker tip estimator
-> GesturePipeline candidate selection
-> VirtualSurfaceFrictionEngine
-> board stroke/cursor events
-> canvas renderer
```

Left-hand duster remains higher priority than marker drawing.

## Implemented V1 Behavior

- Public input mode: `Marker Mode`.
- Fallback input mode: `Hand Gesture`.
- Right-hand physical marker detection from hand landmarks.
- Generic marker grip confidence using thumb/index proximity, finger curl, grip stability, shaft direction, and handedness.
- Heuristic virtual marker tip from grip center plus shaft vector.
- Marker-mode friction preset:
  - static friction radius: `5px`
  - slow gain: `0.07`
  - normal gain: `0.14`
  - fast gain: `0.24`
  - max writing speed: `800px/s`
  - max acceleration: `2200px/s^2`
  - reposition speed: `1100px/s`
- State feedback for not detected, hand detected, grip detected, ready, writing, repositioning, low confidence, and marker lost.
- Stroke points store physical-marker metadata:
  - `rawTipX`, `rawTipY`
  - `gripConfidence`
  - `tipConfidence`
  - `inputSource`
  - `trackingSource`
  - `contactScore`
  - `handSpeedPxPerSec`
- Debug overlay can show raw cursor, virtual cursor, raw tip, and grip center.

## Key Modules

- `packages/gesture-engine/src/physicalMarker.ts`
  - owns V1 generic marker grip detection and heuristic tip estimation.
- `packages/gesture-engine/src/pipeline.ts`
  - chooses physical marker candidate first in Marker Mode, then falls back to hand-only marker when needed.
- `packages/gesture-engine/src/virtualSurfaceFrictionEngine.ts`
  - applies marker-mode contact scoring and friction behavior.
- `packages/core/src/types.ts`
  - stores physical-marker source and tracking metadata on strokes and stroke points.
- `apps/web/src/features/board/AirboardPrototype.tsx`
  - exposes Marker Mode, status, tuning, and debug controls.

## Deferred Work

- Full multi-step calibration screen:
  - hold marker
  - confirm grip
  - calibrate tip with three dots
  - calibrate drawing area
  - test stroke
  - test reposition
  - save profile
- Persisted `MarkerUserProfile` storage.
- Optional colored-tip tracking and fusion.
- Optional fiducial sticker/tag tracking.
- Custom marker prop support.
- Segment-level erasing.
