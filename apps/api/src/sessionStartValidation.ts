import type { MeetingProvider } from "@airboard/core";

const SUPPORTED_PROVIDERS: ReadonlySet<string> = new Set<MeetingProvider>([
  "standalone",
  "google_meet",
  "zoom",
  "teams",
  "chrome_overlay",
]);

// Provider meeting IDs are opaque host identifiers (Meet meeting codes,
// "spaces/…" resource names). They are persisted, so bound them before the
// store: no whitespace or control characters, hard length cap.
const PROVIDER_MEETING_ID_PATTERN = /^[A-Za-z0-9._/-]{1,200}$/;
const TITLE_MAX_LENGTH = 200;

export type SessionStartInput = {
  provider: MeetingProvider;
  providerMeetingId?: string;
  title?: string;
  allowParticipantDrawing: boolean;
};

export type SessionStartValidation =
  | { ok: true; value: SessionStartInput }
  | {
      ok: false;
      error:
        | "INVALID_BODY"
        | "UNSUPPORTED_PROVIDER"
        | "INVALID_PROVIDER_MEETING_ID"
        | "PROVIDER_MEETING_ID_REQUIRES_PROVIDER"
        | "INVALID_TITLE"
        | "INVALID_ALLOW_PARTICIPANT_DRAWING";
    };

/** Validates the /sessions/start body; JSON off the wire is untyped. */
export function validateSessionStartBody(body: unknown): SessionStartValidation {
  if (body !== undefined && body !== null && (typeof body !== "object" || Array.isArray(body))) {
    return { ok: false, error: "INVALID_BODY" };
  }
  const record = (body ?? {}) as Record<string, unknown>;

  const provider = record.provider ?? "standalone";
  if (typeof provider !== "string" || !SUPPORTED_PROVIDERS.has(provider)) {
    return { ok: false, error: "UNSUPPORTED_PROVIDER" };
  }

  if (record.providerMeetingId !== undefined) {
    if (
      typeof record.providerMeetingId !== "string" ||
      !PROVIDER_MEETING_ID_PATTERN.test(record.providerMeetingId)
    ) {
      return { ok: false, error: "INVALID_PROVIDER_MEETING_ID" };
    }
    if (provider === "standalone") {
      return { ok: false, error: "PROVIDER_MEETING_ID_REQUIRES_PROVIDER" };
    }
  }

  if (record.title !== undefined) {
    if (
      typeof record.title !== "string" ||
      record.title.trim().length === 0 ||
      record.title.length > TITLE_MAX_LENGTH ||
      /[\u0000-\u001f\u007f]/.test(record.title)
    ) {
      return { ok: false, error: "INVALID_TITLE" };
    }
  }

  if (
    record.allowParticipantDrawing !== undefined &&
    typeof record.allowParticipantDrawing !== "boolean"
  ) {
    return { ok: false, error: "INVALID_ALLOW_PARTICIPANT_DRAWING" };
  }

  return {
    ok: true,
    value: {
      provider: provider as MeetingProvider,
      allowParticipantDrawing:
        record.allowParticipantDrawing === undefined ? true : record.allowParticipantDrawing,
      ...(record.providerMeetingId !== undefined
        ? { providerMeetingId: record.providerMeetingId }
        : {}),
      ...(record.title !== undefined ? { title: record.title } : {}),
    },
  };
}
