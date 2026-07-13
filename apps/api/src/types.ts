import type { MeetingProvider } from "@airboard/core";

export type StartSessionInput = {
  ownerUserId: string;
  provider: MeetingProvider;
  providerMeetingId?: string;
  title?: string;
  allowParticipantDrawing: boolean;
};
