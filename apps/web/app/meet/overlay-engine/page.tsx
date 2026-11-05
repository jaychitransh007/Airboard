import { AirboardPrototype } from "../../../src/features/board/AirboardPrototype";

/**
 * Private renderer loaded by the Chrome extension, never by Meet's activity
 * UI. The extension keeps this frame offscreen and forwards its transparent
 * board frames into the outgoing camera compositor.
 */
export default function MeetOverlayEnginePage() {
  return <AirboardPrototype surface="meet-main-stage" headlessMeetOverlay />;
}
