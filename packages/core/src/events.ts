import type { BoardEvent } from "./types";

export function createEventEnvelope(input: {
  boardSessionId: string;
  actorParticipantId: string;
  createdAt?: string;
  sequence?: number;
}): Pick<BoardEvent, "id" | "boardSessionId" | "actorParticipantId" | "createdAt" | "sequence"> {
  const envelope = {
    id: crypto.randomUUID(),
    boardSessionId: input.boardSessionId,
    actorParticipantId: input.actorParticipantId,
    createdAt: input.createdAt ?? new Date().toISOString(),
  };

  return input.sequence === undefined ? envelope : { ...envelope, sequence: input.sequence };
}
