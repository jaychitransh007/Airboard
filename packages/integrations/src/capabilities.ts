import type { AdapterCapabilities } from "@airboard/core";

export const standaloneCapabilities: AdapterCapabilities = {
  supportsMainStage: false,
  supportsSidePanel: false,
  supportsParticipantInvite: true,
  supportsSharedActivity: false,
  supportsScreenOverlay: false,
  supportsRawMediaAccess: false,
  supportsMeetingRecordingHooks: false,
  supportsParticipantIdentity: false,
};

export const googleMeetCapabilities: AdapterCapabilities = {
  supportsMainStage: true,
  supportsSidePanel: true,
  supportsParticipantInvite: true,
  supportsSharedActivity: true,
  supportsScreenOverlay: false,
  supportsRawMediaAccess: false,
  supportsMeetingRecordingHooks: false,
  supportsParticipantIdentity: true,
};
