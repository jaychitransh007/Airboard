import {
  canJoinBoard,
  applyBoardEvent,
  canStartBoard,
  createInitialBoardState,
  reduceBoardEvents,
  type BoardEvent,
  type BoardSession,
  type BoardState,
  type Entitlement,
  type Participant,
} from "@airboard/core";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { JoinSessionInput, SessionStore } from "./store";
import type { StartSessionInput } from "./types";

type ProfileRow = {
  id: string;
  local_user_key: string | null;
  email: string | null;
  display_name: string;
  created_at: string;
};

type EntitlementRow = {
  id: string;
  user_id: string;
  plan: string;
  status: Entitlement["status"];
  source: Entitlement["source"];
  valid_until: string;
  created_at: string;
};

type BoardSessionRow = {
  id: string;
  owner_user_id: string;
  provider: BoardSession["provider"];
  provider_meeting_id: string | null;
  title: string | null;
  status: BoardSession["status"];
  allow_participant_drawing: boolean;
  owner_last_seen_at: string;
  expires_at: string;
  created_at: string;
  updated_at: string;
};

type ParticipantRow = {
  id: string;
  board_session_id: string;
  user_id: string | null;
  guest_id: string | null;
  display_name: string;
  role: Participant["role"];
  input_enabled: boolean;
  connected_at: string;
  last_seen_at: string;
};

type BoardEventRow = {
  id: string;
  board_session_id: string;
  sequence: number;
  actor_participant_id: string | null;
  event_type: string;
  payload: BoardEvent;
  created_at: string;
};

// Page size for board_events replay. Must be <= PostgREST [api] max_rows (1000)
// so each page is returned in full and truncation is detected by a short page.
const BOARD_EVENT_PAGE_SIZE = 1000;

export class SupabaseSessionStore implements SessionStore {
  constructor(private readonly client: SupabaseClient) {}

  static create(input: { supabaseUrl: string; serviceRoleKey: string }): SupabaseSessionStore {
    return new SupabaseSessionStore(
      createClient(input.supabaseUrl, input.serviceRoleKey, {
        auth: {
          persistSession: false,
          autoRefreshToken: false,
        },
      }),
    );
  }

  async startSession(input: StartSessionInput): Promise<{
    session: BoardSession;
    ownerParticipant: Participant;
  }> {
    const profile = await this.getProfileByLocalKey(input.ownerUserId);
    const entitlement = await this.getActiveEntitlement(profile.id);

    if (!canStartBoard(entitlement)) {
      throw new Error("OWNER_ENTITLEMENT_REQUIRED");
    }

    const now = new Date();
    const sessionInsert = {
      owner_user_id: profile.id,
      provider: input.provider,
      status: "active",
      allow_participant_drawing: input.allowParticipantDrawing,
      owner_last_seen_at: now.toISOString(),
      expires_at: new Date(now.getTime() + 6 * 60 * 60 * 1000).toISOString(),
      ...(input.providerMeetingId ? { provider_meeting_id: input.providerMeetingId } : {}),
      ...(input.title ? { title: input.title } : { title: "Airboard" }),
    };
    const sessionRow = await this.insertSingle<BoardSessionRow>("board_sessions", sessionInsert);
    const ownerParticipantRow = await this.insertSingle<ParticipantRow>("participants", {
      board_session_id: sessionRow.id,
      user_id: profile.id,
      display_name: profile.display_name || "Owner",
      role: "owner",
      input_enabled: true,
    });

    return {
      session: mapSession(sessionRow),
      ownerParticipant: mapParticipant(ownerParticipantRow),
    };
  }

  async joinSession(input: JoinSessionInput): Promise<{
    session: BoardSession;
    participant: Participant;
    state: BoardState;
  }> {
    const session = await this.getSession(input.sessionId);
    if (!canJoinBoard(session)) {
      throw new Error("SESSION_NOT_JOINABLE");
    }

    const participantRow = await this.insertSingle<ParticipantRow>("participants", {
      board_session_id: input.sessionId,
      guest_id: crypto.randomUUID(),
      display_name: input.displayName || "Guest",
      role: session.allowParticipantDrawing ? "editor" : "viewer",
      input_enabled: true,
    });

    return {
      session,
      participant: mapParticipant(participantRow),
      state: await this.getState(input.sessionId),
    };
  }

  async getParticipant(sessionId: string, participantId: string): Promise<Participant | null> {
    const { data, error } = await this.client
      .from("participants")
      .select("*")
      .eq("id", participantId)
      .eq("board_session_id", sessionId)
      .maybeSingle();

    if (error) {
      throw new Error("PARTICIPANT_LOOKUP_FAILED");
    }

    return data ? mapParticipant(data as ParticipantRow) : null;
  }

  async heartbeat(sessionId: string, participantId: string): Promise<BoardSession> {
    const now = new Date().toISOString();
    const participantRow = await this.updateSingle<ParticipantRow>(
      "participants",
      { last_seen_at: now },
      { column: "id", value: participantId },
    );

    if (participantRow.role === "owner") {
      const sessionRow = await this.updateSingle<BoardSessionRow>(
        "board_sessions",
        {
          status: "active",
          owner_last_seen_at: now,
          updated_at: now,
        },
        { column: "id", value: sessionId },
      );
      return mapSession(sessionRow);
    }

    return this.getSession(sessionId);
  }

  async markOwnerDisconnected(sessionId: string): Promise<BoardSession> {
    const now = new Date().toISOString();
    const row = await this.updateSingle<BoardSessionRow>(
      "board_sessions",
      {
        status: "owner_disconnected",
        updated_at: now,
      },
      { column: "id", value: sessionId },
    );
    return mapSession(row);
  }

  async lockSession(sessionId: string): Promise<BoardSession> {
    const now = new Date().toISOString();
    const row = await this.updateSingle<BoardSessionRow>(
      "board_sessions",
      {
        status: "locked",
        updated_at: now,
      },
      { column: "id", value: sessionId },
    );
    return mapSession(row);
  }

  async endSession(sessionId: string): Promise<BoardSession> {
    const now = new Date().toISOString();
    const row = await this.updateSingle<BoardSessionRow>(
      "board_sessions",
      {
        status: "ended",
        updated_at: now,
      },
      { column: "id", value: sessionId },
    );
    return mapSession(row);
  }

  async appendEvent(sessionId: string, event: BoardEvent): Promise<BoardEvent> {
    return (await this.appendEvents(sessionId, [event]))[0]!;
  }

  async appendEvents(sessionId: string, events: BoardEvent[]): Promise<BoardEvent[]> {
    if (events.length === 0) {
      return [];
    }
    // The (board_session_id, sequence) unique constraint is the concurrency
    // guard: read-then-write can race, so on a unique-violation we recompute the
    // next base sequence and retry the whole batch. A batch is inserted in one
    // statement (all-or-nothing), so a compound command gets a contiguous block
    // and is never split or interleaved with another actor's events.
    const maxAttempts = 8;
    let lastError: unknown;
    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      const baseSequence = await this.getNextSequence(sessionId);
      const sequenced = events.map((event, index) => ({
        ...event,
        sequence: baseSequence + index,
      })) as BoardEvent[];

      const { error } = await this.client.from("board_events").insert(
        sequenced.map((event) => ({
          id: event.id,
          board_session_id: sessionId,
          sequence: event.sequence,
          actor_participant_id: event.actorParticipantId,
          event_type: event.type,
          payload: event,
          created_at: event.createdAt,
        })),
      );

      if (!error) {
        return sequenced;
      }

      // 23505 = unique_violation. Retry against a freshly-read sequence; any
      // other error is fatal.
      if (error.code !== "23505") {
        throw new Error(error.message ?? "INSERT_FAILED:board_events");
      }
      lastError = error;
    }

    throw new Error(
      lastError instanceof Error
        ? `BOARD_SEQUENCE_CONTENTION:${lastError.message}`
        : "BOARD_SEQUENCE_CONTENTION",
    );
  }

  async getState(sessionId: string): Promise<BoardState> {
    const state = createInitialBoardState(sessionId);
    const participants = await this.listParticipants(sessionId);
    state.participants = Object.fromEntries(
      participants.map((participant) => [participant.id, participant]),
    );

    const eventRows = await this.listEventRows(sessionId);
    const events = eventRows.map((row) => ({
      ...row.payload,
      sequence: row.sequence,
    })) as BoardEvent[];

    return reduceBoardEvents(state, events);
  }

  async getSession(sessionId: string): Promise<BoardSession> {
    const { data, error } = await this.client
      .from("board_sessions")
      .select("*")
      .eq("id", sessionId)
      .single();

    if (error || !data) {
      throw new Error("SESSION_NOT_FOUND");
    }

    return mapSession(data as BoardSessionRow);
  }

  private async getProfileByLocalKey(localUserKey: string): Promise<ProfileRow> {
    const { data, error } = await this.client
      .from("profiles")
      .select("*")
      .eq("local_user_key", localUserKey)
      .single();

    if (error || !data) {
      throw new Error("OWNER_PROFILE_NOT_FOUND");
    }

    return data as ProfileRow;
  }

  private async getActiveEntitlement(userId: string): Promise<Entitlement | null> {
    const { data, error } = await this.client
      .from("entitlements")
      .select("*")
      .eq("user_id", userId)
      .in("status", ["active", "trialing"])
      .order("valid_until", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) {
      throw new Error("ENTITLEMENT_LOOKUP_FAILED");
    }

    return data ? mapEntitlement(data as EntitlementRow) : null;
  }

  private async listParticipants(sessionId: string): Promise<Participant[]> {
    const { data, error } = await this.client
      .from("participants")
      .select("*")
      .eq("board_session_id", sessionId);

    if (error) {
      throw new Error("PARTICIPANT_LOOKUP_FAILED");
    }

    return ((data ?? []) as ParticipantRow[]).map(mapParticipant);
  }

  private async listEventRows(sessionId: string): Promise<BoardEventRow[]> {
    // PostgREST caps a single response at [api] max_rows (1000 by default), so
    // an unpaginated select silently truncates a long session's history and
    // getState reconstructs a partial/corrupt board. Page through explicitly.
    const pageSize = BOARD_EVENT_PAGE_SIZE;
    const rows: BoardEventRow[] = [];
    for (let offset = 0; ; offset += pageSize) {
      const { data, error } = await this.client
        .from("board_events")
        .select("*")
        .eq("board_session_id", sessionId)
        .order("sequence", { ascending: true })
        .range(offset, offset + pageSize - 1);

      if (error) {
        throw new Error("BOARD_EVENT_LOOKUP_FAILED");
      }

      const page = (data ?? []) as BoardEventRow[];
      rows.push(...page);
      if (page.length < pageSize) {
        break;
      }
    }

    return rows;
  }

  private async getNextSequence(sessionId: string): Promise<number> {
    const { data, error } = await this.client
      .from("board_events")
      .select("sequence")
      .eq("board_session_id", sessionId)
      .order("sequence", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) {
      throw new Error("BOARD_SEQUENCE_LOOKUP_FAILED");
    }

    return Number(data?.sequence ?? 0) + 1;
  }

  private async insertSingle<TRow>(table: string, values: Record<string, unknown>): Promise<TRow> {
    const { data, error } = await this.client.from(table).insert(values).select("*").single();

    if (error || !data) {
      throw new Error(error?.message ?? `INSERT_FAILED:${table}`);
    }

    return data as TRow;
  }

  private async updateSingle<TRow>(
    table: string,
    values: Record<string, unknown>,
    where: { column: string; value: string },
  ): Promise<TRow> {
    const { data, error } = await this.client
      .from(table)
      .update(values)
      .eq(where.column, where.value)
      .select("*")
      .single();

    if (error || !data) {
      throw new Error(error?.message ?? `UPDATE_FAILED:${table}`);
    }

    return data as TRow;
  }
}

function mapSession(row: BoardSessionRow): BoardSession {
  const session = {
    id: row.id,
    ownerUserId: row.owner_user_id,
    provider: row.provider,
    status: row.status,
    allowParticipantDrawing: row.allow_participant_drawing,
    ownerLastSeenAt: row.owner_last_seen_at,
    expiresAt: row.expires_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };

  return {
    ...session,
    ...(row.title ? { title: row.title } : {}),
    ...(row.provider_meeting_id ? { providerMeetingId: row.provider_meeting_id } : {}),
  };
}

function mapParticipant(row: ParticipantRow): Participant {
  const participant = {
    id: row.id,
    boardSessionId: row.board_session_id,
    displayName: row.display_name,
    role: row.role,
    inputEnabled: row.input_enabled,
    connectedAt: row.connected_at,
    lastSeenAt: row.last_seen_at,
  };

  return {
    ...participant,
    ...(row.user_id ? { userId: row.user_id } : {}),
    ...(row.guest_id ? { guestId: row.guest_id } : {}),
  };
}

function mapEntitlement(row: EntitlementRow): Entitlement {
  return {
    id: row.id,
    userId: row.user_id,
    plan: row.plan,
    status: row.status,
    source: row.source,
    validUntil: row.valid_until,
    createdAt: row.created_at,
  };
}
