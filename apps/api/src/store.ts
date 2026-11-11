import type { BoardEvent, BoardSession, BoardState, Participant } from "@airboard/core";
import type { StartSessionInput } from "./types";

export type JoinSessionInput = {
  sessionId: string;
  displayName: string;
};

export type SessionStore = {
  startSession(input: StartSessionInput):
    | {
        session: BoardSession;
        ownerParticipant: Participant;
      }
    | Promise<{
        session: BoardSession;
        ownerParticipant: Participant;
      }>;

  joinSession(input: JoinSessionInput):
    | {
        session: BoardSession;
        participant: Participant;
        state: BoardState;
      }
    | Promise<{
        session: BoardSession;
        participant: Participant;
        state: BoardState;
      }>;

  getParticipant(
    sessionId: string,
    participantId: string,
  ): (Participant | null) | Promise<Participant | null>;
  heartbeat(sessionId: string, participantId: string): BoardSession | Promise<BoardSession>;
  markOwnerDisconnected(sessionId: string): BoardSession | Promise<BoardSession>;
  lockSession(sessionId: string): BoardSession | Promise<BoardSession>;
  /** Whether guests may edit; read live by every socket's permission check. */
  setParticipantDrawing(sessionId: string, allow: boolean): BoardSession | Promise<BoardSession>;
  /** Stops every live link issued so far from admitting new people. */
  resetJoinLinks(sessionId: string): BoardSession | Promise<BoardSession>;
  /**
   * Append a group of events as one unit, assigning a contiguous sequence block.
   * Compound diagram commands (e.g. create-node + connect) must not be split or
   * interleaved with another actor's events, or peers replaying by sequence can
   * apply a connector before the node it references exists.
   */
  appendEvents(sessionId: string, events: BoardEvent[]): BoardEvent[] | Promise<BoardEvent[]>;
  getState(sessionId: string): BoardState | Promise<BoardState>;
  getSession(sessionId: string): BoardSession | Promise<BoardSession>;
  /** Stored events with sequence from..to inclusive, in order. */
  getEventsInRange(sessionId: string, from: number, to: number): BoardEvent[] | Promise<BoardEvent[]>;
  /** The highest stored sequence, or 0 before the first event. */
  getLatestSequence(sessionId: string): number | Promise<number>;
};
