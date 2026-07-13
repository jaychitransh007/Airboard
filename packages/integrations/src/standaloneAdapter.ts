import type { BoardSession, MeetingContext, Participant } from "@airboard/core";
import { standaloneCapabilities } from "./capabilities.ts";
import type {
  AdapterConfig,
  MeetingAdapter,
  MeetingParticipant,
  MeetingUser,
  StartBoardSessionInput,
} from "./types.ts";

export class StandaloneWebAdapter implements MeetingAdapter {
  provider = "standalone" as const;
  private config: AdapterConfig | null = null;
  private participantJoinedCallbacks = new Set<(participant: Participant) => void>();
  private participantLeftCallbacks = new Set<(participant: Participant) => void>();
  private meetingEndedCallbacks = new Set<() => void>();

  async initialize(config: AdapterConfig): Promise<void> {
    this.config = config;
  }

  async getMeetingContext(): Promise<MeetingContext> {
    return {
      provider: "standalone",
      title: "Standalone Airboard",
      capabilities: standaloneCapabilities,
    };
  }

  async getCurrentUser(): Promise<MeetingUser> {
    return {
      displayName: "Local Owner",
    };
  }

  async getParticipants(): Promise<MeetingParticipant[]> {
    return [];
  }

  async startBoardSession(input: StartBoardSessionInput): Promise<BoardSession> {
    const response = await fetch(`${this.requireConfig().apiBaseUrl}/sessions/start`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-airboard-user-id": "local-owner",
      },
      body: JSON.stringify({
        provider: "standalone",
        title: input.title,
        allowParticipantDrawing: input.allowParticipantDrawing,
      }),
    });

    if (!response.ok) {
      throw new Error(`Unable to start board session: ${response.status}`);
    }

    return (await response.json()).session as BoardSession;
  }

  async joinBoardSession(sessionId: string): Promise<BoardSession> {
    const response = await fetch(`${this.requireConfig().apiBaseUrl}/sessions/${sessionId}/join`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ displayName: "Guest" }),
    });

    if (!response.ok) {
      throw new Error(`Unable to join board session: ${response.status}`);
    }

    return (await response.json()).session as BoardSession;
  }

  async inviteParticipants(_sessionId: string): Promise<void> {
    return;
  }

  onParticipantJoined(callback: (participant: Participant) => void): void {
    this.participantJoinedCallbacks.add(callback);
  }

  onParticipantLeft(callback: (participant: Participant) => void): void {
    this.participantLeftCallbacks.add(callback);
  }

  onMeetingEnded(callback: () => void): void {
    this.meetingEndedCallbacks.add(callback);
  }

  getCapabilities() {
    return standaloneCapabilities;
  }

  async dispose(): Promise<void> {
    this.participantJoinedCallbacks.clear();
    this.participantLeftCallbacks.clear();
    this.meetingEndedCallbacks.clear();
  }

  private requireConfig(): AdapterConfig {
    if (!this.config) {
      throw new Error("StandaloneWebAdapter is not initialized");
    }
    return this.config;
  }
}
