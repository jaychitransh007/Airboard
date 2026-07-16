/**
 * Cross-platform media-capture policy for embedded meeting surfaces.
 *
 * No meeting platform hands an embedded app its live meeting stream in GA, so
 * gesture/voice capture is always a separate acquisition of the same device.
 * Where that acquisition may run is a per-platform browser policy question:
 *
 * - "embedded": the host client delegates camera and microphone permission to
 *   the add-on frame (Permissions Policy `allow="camera; microphone"`), so an
 *   explicit, user-initiated capture can start inside the meeting surface —
 *   usually with no extra prompt because the top-level grant applies.
 * - "companion-only": the frame cannot capture no matter what the user wants;
 *   gesture/voice run in a companion window bound to the same board session.
 *
 * Hidden or auto-started capture is rejected everywhere: capture begins only
 * from a visible user action and shows an on-screen indicator.
 */
export type MediaCaptureCapability = "embedded" | "companion-only";

export type PermissionsPolicyLike = {
  allowsFeature(feature: string): boolean;
};

export function resolveMediaCaptureCapability(input: {
  /** True when Airboard is the top-level page (standalone surface). */
  isTopLevel: boolean;
  /** document.permissionsPolicy ?? document.featurePolicy, when present. */
  policy: PermissionsPolicyLike | null | undefined;
}): MediaCaptureCapability {
  if (input.isTopLevel) {
    return "embedded";
  }
  if (!input.policy || typeof input.policy.allowsFeature !== "function") {
    return "companion-only";
  }
  try {
    // Camera (gesture) and microphone (voice) are gated together: partial
    // delegation is treated as none so the surface never advertises an input
    // mode that cannot start. The companion window covers the remainder.
    return input.policy.allowsFeature("camera") && input.policy.allowsFeature("microphone")
      ? "embedded"
      : "companion-only";
  } catch {
    return "companion-only";
  }
}

/**
 * DOM probe for the current frame. Safe during server rendering (reports
 * "companion-only"; embedded surfaces re-evaluate after mount).
 */
export function probeMediaCaptureCapability(): MediaCaptureCapability {
  if (typeof window === "undefined" || typeof document === "undefined") {
    return "companion-only";
  }
  const doc = document as Document & {
    permissionsPolicy?: PermissionsPolicyLike;
    featurePolicy?: PermissionsPolicyLike;
  };
  let isTopLevel = false;
  try {
    isTopLevel = window.self === window.top;
  } catch {
    isTopLevel = false;
  }
  return resolveMediaCaptureCapability({
    isTopLevel,
    policy: doc.permissionsPolicy ?? doc.featurePolicy,
  });
}
