export type ChromeStatusDependencyFailure =
  | "INSTALLATION_POLICY_UNAVAILABLE"
  | "INSTALLATION_ENTITLEMENT_UNAVAILABLE";

export function chromeStatusDependencyFailure(input: {
  policyError: unknown;
  policy: unknown;
  entitlementError: unknown;
  entitlement: unknown;
}): ChromeStatusDependencyFailure | null {
  if (input.policyError || !input.policy) return "INSTALLATION_POLICY_UNAVAILABLE";
  if (input.entitlementError || !input.entitlement) {
    return "INSTALLATION_ENTITLEMENT_UNAVAILABLE";
  }
  return null;
}

export type ChromePreflightEvidence = {
  framesComposited: number;
  framesEncoded: number;
  bytesSent: number;
  lastCompositeAt: number;
  lastVerifiedAt: number;
  meetingSessionId: string;
  extensionVersion: string;
};

export type ChromePreflightEvidenceResult =
  | { ok: true; value: ChromePreflightEvidence }
  | { ok: false; error: "VERIFIED_OUTBOUND_COMPOSITE_REQUIRED" };

const EVIDENCE_MAX_AGE_MS = 15_000;
const EVIDENCE_FUTURE_TOLERANCE_MS = 5_000;

/** Validates only fresh, positive, post-attachment compositor evidence. */
export function parseChromePreflightEvidence(
  input: Record<string, unknown>,
  nowMs = Date.now(),
): ChromePreflightEvidenceResult {
  const framesComposited = positiveInteger(input.framesComposited, 1_000_000_000);
  const framesEncoded = positiveInteger(input.framesEncoded, 1_000_000_000);
  const bytesSent = positiveInteger(input.bytesSent, Number.MAX_SAFE_INTEGER);
  const lastCompositeAt = recentEpochMs(input.lastCompositeAt, nowMs);
  const lastVerifiedAt = recentEpochMs(input.lastVerifiedAt, nowMs);
  const meetingSessionId = boundedText(input.meetingSessionId, 8, 160);
  const extensionVersion = boundedText(input.extensionVersion, 1, 40);
  if (
    input.senderAttached !== true ||
    framesComposited === null ||
    framesEncoded === null ||
    bytesSent === null ||
    lastCompositeAt === null ||
    lastVerifiedAt === null ||
    lastVerifiedAt < lastCompositeAt ||
    !meetingSessionId ||
    !extensionVersion
  ) {
    return { ok: false, error: "VERIFIED_OUTBOUND_COMPOSITE_REQUIRED" };
  }
  return {
    ok: true,
    value: {
      framesComposited,
      framesEncoded,
      bytesSent,
      lastCompositeAt,
      lastVerifiedAt,
      meetingSessionId,
      extensionVersion,
    },
  };
}

/** Uses the deployment overlap window instead of assuming only the latest build is valid. */
export function chromePreflightVersionSupported(
  extensionVersion: string,
  compatibleExtensionVersions: readonly string[],
): boolean {
  return compatibleExtensionVersions.includes(extensionVersion);
}

function positiveInteger(value: unknown, max: number): number | null {
  return typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= max
    ? value
    : null;
}

function recentEpochMs(value: unknown, nowMs: number): number | null {
  return typeof value === "number" &&
      Number.isInteger(value) &&
      value >= nowMs - EVIDENCE_MAX_AGE_MS &&
      value <= nowMs + EVIDENCE_FUTURE_TOLERANCE_MS
    ? value
    : null;
}

function boundedText(value: unknown, min: number, max: number): string | null {
  if (typeof value !== "string") return null;
  const text = value.trim();
  return text.length >= min && text.length <= max && !/[\u0000-\u001f\u007f]/.test(text)
    ? text
    : null;
}
