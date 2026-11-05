import type { MeetingProvider } from "@airboard/core";

export type StartSessionInput = {
  ownerUserId: string;
  organizationId?: string;
  workspaceId?: string;
  boardId?: string;
  provider: MeetingProvider;
  providerMeetingId?: string;
  title?: string;
  allowParticipantDrawing: boolean;
};
