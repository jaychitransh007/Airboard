import {
  canJoinBoard,
  applyBoardEvent,
  canStartBoard,
  createInitialBoardState,
  type BoardEvent,
  type BoardSession,
  type BoardState,
  type Entitlement,
  type Participant,
} from "@airboard/core";
import type { JoinSessionInput, SessionStore } from "./store";
import type { StartSessionInput } from "./types";

type SessionRecord = {
  session: BoardSession;
  participants: Map<string, Participant>;
  state: BoardState;
  nextSequence: number;
};

export class InMemorySessionStore implements SessionStore {
  private readonly sessions = new Map<string, SessionRecord>();

  constructor(private readonly options: { ownerGraceSeconds: number; localEntitlements: boolean }) {}

  startSession(input: StartSessionInput): {
    session: BoardSession;
    ownerParticipant: Participant;
  } {
    const entitlement = this.getEntitlement(input.ownerUserId);
    if (!canStartBoard(entitlement)) {
      throw new Error("OWNER_ENTITLEMENT_REQUIRED");
    }

    const now = new Date();
    const session: BoardSession = {
      id: crypto.randomUUID(),
      ownerUserId: input.ownerUserId,
      provider: input.provider,
      title: input.title ?? "Airboard",
      status: "active",
      allowParticipantDrawing: input.allowParticipantDrawing,
      ownerLastSeenAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + 6 * 60 * 60 * 1000).toISOString(),
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
      ...(input.providerMeetingId ? { providerMeetingId: input.providerMeetingId } : {}),
    };
    const ownerParticipant: Participant = {
      id: crypto.randomUUID(),
      boardSessionId: session.id,
      userId: input.ownerUserId,
      displayName: "Owner",
      role: "owner",
      inputEnabled: true,
      connectedAt: now.toISOString(),
      lastSeenAt: now.toISOString(),
    };
    const participants = new Map<string, Participant>([[ownerParticipant.id, ownerParticipant]]);
    const state = createInitialBoardState(session.id);

    this.sessions.set(session.id, {
      session,
      participants,
      state,
      nextSequence: 1,
    });

    return { session, ownerParticipant };
  }

  joinSession(input: JoinSessionInput): {
    session: BoardSession;
    participant: Participant;
    state: BoardState;
  } {
    const record = this.requireSession(input.sessionId);
    if (!canJoinBoard(record.session)) {
      throw new Error("SESSION_NOT_JOINABLE");
    }

    const now = new Date().toISOString();
    const participant: Participant = {
      id: crypto.randomUUID(),
      boardSessionId: record.session.id,
      guestId: crypto.randomUUID(),
      displayName: input.displayName || "Guest",
      role: record.session.allowParticipantDrawing ? "editor" : "viewer",
      inputEnabled: true,
      connectedAt: now,
      lastSeenAt: now,
    };

    record.participants.set(participant.id, participant);
    return {
      session: record.session,
      participant,
      state: record.state,
    };
  }

  getParticipant(sessionId: string, participantId: string): Participant | null {
    const record = this.sessions.get(sessionId);
    return record?.participants.get(participantId) ?? null;
  }

  heartbeat(sessionId: string, participantId: string): BoardSession {
    const record = this.requireSession(sessionId);
    const participant = record.participants.get(participantId);
    const now = new Date().toISOString();

    if (participant) {
      record.participants.set(participantId, {
        ...participant,
        lastSeenAt: now,
      });
    }

    if (participant?.role === "owner") {
      record.session = {
        ...record.session,
        status: "active",
        ownerLastSeenAt: now,
        updatedAt: now,
      };
    }

    return record.session;
  }

  markOwnerDisconnected(sessionId: string): BoardSession {
    const record = this.requireSession(sessionId);
    const now = new Date().toISOString();
    record.session = {
      ...record.session,
      status: "owner_disconnected",
      updatedAt: now,
    };
    return record.session;
  }

  lockSession(sessionId: string): BoardSession {
    const record = this.requireSession(sessionId);
    const now = new Date().toISOString();
    record.session = {
      ...record.session,
      status: "locked",
      updatedAt: now,
    };
    return record.session;
  }

  endSession(sessionId: string): BoardSession {
    const record = this.requireSession(sessionId);
    const now = new Date().toISOString();
    record.session = {
      ...record.session,
      status: "ended",
      updatedAt: now,
    };
    return record.session;
  }

  appendEvent(sessionId: string, event: BoardEvent): BoardEvent {
    return this.appendEvents(sessionId, [event])[0]!;
  }

  appendEvents(sessionId: string, events: BoardEvent[]): BoardEvent[] {
    const record = this.requireSession(sessionId);
    // Compute the whole batch on locals and commit only after every event has
    // applied cleanly, so a mid-batch throw leaves the record untouched. This
    // upholds the all-or-nothing contract the Supabase store also honors.
    let state = record.state;
    let sequence = record.nextSequence;
    const sequenced = events.map((event) => {
      const sequencedEvent = {
        ...event,
        sequence,
      } as BoardEvent;
      state = applyBoardEvent(state, sequencedEvent);
      sequence += 1;
      return sequencedEvent;
    });
    record.state = state;
    record.nextSequence = sequence;
    return sequenced;
  }

  getState(sessionId: string): BoardState {
    return this.requireSession(sessionId).state;
  }

  getSession(sessionId: string): BoardSession {
    return this.requireSession(sessionId).session;
  }

  private getEntitlement(userId: string): Entitlement | null {
    if (!this.options.localEntitlements) {
      return null;
    }

    return {
      id: "local-entitlement",
      userId,
      plan: "dev_pro",
      status: "active",
      source: "local_seed",
      validUntil: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString(),
      createdAt: new Date().toISOString(),
    };
  }

  private requireSession(sessionId: string): SessionRecord {
    const record = this.sessions.get(sessionId);
    if (!record) {
      throw new Error("SESSION_NOT_FOUND");
    }
    return record;
  }
}
