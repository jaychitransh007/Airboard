import type { BoardSession, MeetingContext, Participant } from "@airboard/core";
import { googleMeetCapabilities } from "./capabilities.ts";
import type {
  AdapterConfig,
  MeetingAdapter,
  MeetingParticipant,
  MeetingUser,
  StartBoardSessionInput,
} from "./types.ts";

type MeetAddonSession = {
  createSidePanelClient?: () => Promise<any>;
  createMainStageClient?: () => Promise<any>;
};

declare global {
  interface Window {
    meet?: {
      addon?: {
        createAddonSession: (input: { cloudProjectNumber: string }) => Promise<MeetAddonSession>;
      };
    };
  }
}

export class GoogleMeetAdapter implements MeetingAdapter {
  provider = "google_meet" as const;
  private config: AdapterConfig | null = null;
  private addonSession: MeetAddonSession | null = null;
  private client: any = null;

  async initialize(config: AdapterConfig & { cloudProjectNumber?: string }): Promise<void> {
    this.config = config;

    if (!window.meet?.addon || !config.cloudProjectNumber) {
      return;
    }

    this.addonSession = await window.meet.addon.createAddonSession({
      cloudProjectNumber: config.cloudProjectNumber,
    });
  }

  async getMeetingContext(): Promise<MeetingContext> {
    return {
      provider: "google_meet",
      capabilities: googleMeetCapabilities,
    };
  }

  async getCurrentUser(): Promise<MeetingUser> {
    return {
      displayName: "Meet Participant",
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
        provider: "google_meet",
        title: input.title,
        allowParticipantDrawing: input.allowParticipantDrawing,
      }),
    });

    if (!response.ok) {
      throw new Error(`Unable to start Meet board session: ${response.status}`);
    }

    const session = (await response.json()).session as BoardSession;
    await this.startMeetActivity(session.id);
    return session;
  }

  async joinBoardSession(sessionId: string): Promise<BoardSession> {
    const response = await fetch(`${this.requireConfig().apiBaseUrl}/sessions/${sessionId}/join`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ displayName: "Meet Guest" }),
    });

    if (!response.ok) {
      throw new Error(`Unable to join Meet board session: ${response.status}`);
    }

    return (await response.json()).session as BoardSession;
  }

  async inviteParticipants(_sessionId: string): Promise<void> {
    return;
  }

  onParticipantJoined(_callback: (participant: Participant) => void): void {
    return;
  }

  onParticipantLeft(_callback: (participant: Participant) => void): void {
    return;
  }

  onMeetingEnded(_callback: () => void): void {
    return;
  }

  getCapabilities() {
    return googleMeetCapabilities;
  }

  async dispose(): Promise<void> {
    this.client = null;
    this.addonSession = null;
  }

  private async startMeetActivity(boardSessionId: string): Promise<void> {
    if (!this.addonSession?.createSidePanelClient) {
      return;
    }

    this.client = this.client ?? (await this.addonSession.createSidePanelClient());
    await this.client.startActivity?.({
      mainStageUrl: `${window.location.origin}/meet/main-stage?boardSessionId=${boardSessionId}`,
      additionalData: JSON.stringify({ boardSessionId }),
    });
  }

  private requireConfig(): AdapterConfig {
    if (!this.config) {
      throw new Error("GoogleMeetAdapter is not initialized");
    }
    return this.config;
  }
}
