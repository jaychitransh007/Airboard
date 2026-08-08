export type ChromeMeetDiagnostics = {
  meetingDetected?: boolean;
  engineMounted?: boolean;
  armed?: boolean;
  engaged?: boolean;
  senderAttached?: boolean;
  framesEncoded?: number;
  bytesSent?: number;
  meetingSessionId?: string | null;
};

export type ChromeMeetExtensionState = {
  linked: boolean;
  consented: boolean;
  entitled: boolean;
  preflightComplete: boolean;
  statusFresh?: boolean;
  verifiedMeetingSessionId?: string | null;
  verificationExpiresAt?: string | null;
  installationId?: string | null;
  installationInstanceId?: string | null;
  settings?: Record<string, boolean>;
  diagnostics?: ChromeMeetDiagnostics;
  lastError?: string | null;
  lastVerifiedAt?: string | null;
};

export type ChromeMeetReadinessStep = {
  id: "installed" | "linked" | "consented" | "meeting" | "overlay" | "sender";
  label: string;
  detail: string;
  complete: boolean;
};

export function chromeMeetReadiness(
  extension: ChromeMeetExtensionState | null,
  options: {
    detected: boolean;
    serverLinked: boolean;
    serverConsented: boolean;
    serverVerified: boolean;
    nowMs?: number;
  },
): ChromeMeetReadinessStep[] {
  const linked = extension?.linked === true || options.serverLinked;
  const consented = extension?.consented === true || options.serverConsented;
  const diagnostics = extension?.diagnostics;
  const nowMs = options.nowMs ?? Date.now();
  const liveSessionVerified = Boolean(
    extension?.entitled === true &&
    extension?.statusFresh === true &&
    diagnostics?.meetingDetected === true &&
    diagnostics.engineMounted === true &&
    diagnostics.engaged === true &&
    diagnostics.meetingSessionId &&
    diagnostics.meetingSessionId === extension.verifiedMeetingSessionId &&
    typeof extension.verificationExpiresAt === "string" &&
    new Date(extension.verificationExpiresAt).getTime() > nowMs &&
    diagnostics.senderAttached === true &&
    (diagnostics.framesEncoded ?? 0) > 0 &&
    (diagnostics.bytesSent ?? 0) > 0,
  );
  return [
    {
      id: "installed",
      label: "Extension detected",
      detail: options.detected ? "This Chrome profile can reach Airboard." : "Install Airboard in this Chrome profile.",
      complete: options.detected,
    },
    {
      id: "linked",
      label: "Account connected",
      detail: linked ? "This installation is scoped to your Airboard account." : "Connect the extension after signing in.",
      complete: linked,
    },
    {
      id: "consented",
      label: "Media confirmed",
      detail: consented ? "Camera, microphone and voice processing were confirmed." : "Review the one-time disclosure in the extension popup.",
      complete: consented,
    },
    {
      id: "meeting",
      label: "Meet detected",
      detail: diagnostics?.meetingDetected ? "A meeting-code tab is active." : "Open or refresh a Google Meet meeting.",
      complete: diagnostics?.meetingDetected === true,
    },
    {
      id: "overlay",
      label: "Overlay engaged",
      detail: diagnostics?.engaged ? "Meet is using Airboard's composited camera track." : "Airboard will engage the camera automatically when Meet requests it.",
      complete: diagnostics?.engaged === true,
    },
    {
      id: "sender",
      label: "Outgoing video verified",
      detail: liveSessionVerified
        ? "Meet is currently encoding and sending the Airboard composite."
        : options.serverVerified
          ? "A previous meeting was verified; open Meet to verify the current session."
          : "Waiting for encoded frames and outbound bytes from the current meeting.",
      complete: liveSessionVerified,
    },
  ];
}
