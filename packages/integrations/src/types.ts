import type {
  AdapterCapabilities,
  BoardSession,
  MeetingContext,
  MeetingProvider,
  Participant,
} from "@airboard/core";

export type AdapterConfig = {
  apiBaseUrl: string;
  provider: MeetingProvider;
};

export type MeetingUser = {
  providerUserId?: string;
  displayName: string;
  email?: string;
};

export type MeetingParticipant = {
  providerParticipantId?: string;
  displayName: string;
  isHost?: boolean;
};

export type StartBoardSessionInput = {
  title?: string;
  allowParticipantDrawing: boolean;
};

export interface MeetingAdapter {
  provider: MeetingProvider;

  initialize(config: AdapterConfig): Promise<void>;
  getMeetingContext(): Promise<MeetingContext>;
  getCurrentUser(): Promise<MeetingUser>;
  getParticipants(): Promise<MeetingParticipant[]>;
  startBoardSession(input: StartBoardSessionInput): Promise<BoardSession>;
  joinBoardSession(sessionId: string): Promise<BoardSession>;
  inviteParticipants(sessionId: string): Promise<void>;
  onParticipantJoined(callback: (participant: Participant) => void): void;
  onParticipantLeft(callback: (participant: Participant) => void): void;
  onMeetingEnded(callback: () => void): void;
  getCapabilities(): AdapterCapabilities;
  dispose(): Promise<void>;
}
