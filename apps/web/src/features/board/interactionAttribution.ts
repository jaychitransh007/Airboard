export const INTERACTION_ATTRIBUTION_WINDOW_MS = 10_000;

export type InteractionOutcome = "applied" | "rejected";
export type InteractionFollowUpKind = "undo" | "retry" | "correction";

export type InteractionAttributionRecord = {
  interactionId: string;
  outcome: InteractionOutcome;
  occurredAtMs: number;
  intentKey?: string;
};

export type InteractionAttribution = {
  kind: InteractionFollowUpKind;
  originatingInteractionId: string;
  followUpInteractionId?: string;
  delayMs: number;
};

type AttributeFollowUpInput = {
  kind: InteractionFollowUpKind;
  occurredAtMs: number;
  followUpInteractionId?: string;
  originatingInteractionId?: string;
  intentKey?: string;
};

type StoredInteraction = InteractionAttributionRecord & {
  attributedKinds: Set<InteractionFollowUpKind>;
};

/**
 * Bounded, content-free correlation for immediate user follow-ups.
 *
 * Undo supplies the interaction ID attached to the exact undo-stack entry.
 * Retry requires the same normalized intent fingerprint as a rejected turn.
 * Correction is called only after the production correction parser recognizes
 * correction language, and selects the most recent applied interaction.
 */
export class InteractionAttributionTracker {
  private readonly records: StoredInteraction[] = [];
  private readonly windowMs: number;
  private readonly maxRecords: number;

  constructor(
    windowMs = INTERACTION_ATTRIBUTION_WINDOW_MS,
    maxRecords = 64,
  ) {
    if (!Number.isFinite(windowMs) || windowMs < 0) {
      throw new Error("Attribution window must be a non-negative duration.");
    }
    if (!Number.isInteger(maxRecords) || maxRecords < 1) {
      throw new Error("Attribution record limit must be a positive integer.");
    }
    this.windowMs = windowMs;
    this.maxRecords = maxRecords;
  }

  record(input: InteractionAttributionRecord): void {
    validateInteractionId(input.interactionId);
    validateOccurredAt(input.occurredAtMs);
    if (input.outcome === "rejected" && !input.intentKey) {
      throw new Error("Rejected interactions require an intent fingerprint.");
    }

    const existingIndex = this.records.findIndex(
      (record) => record.interactionId === input.interactionId,
    );
    if (existingIndex >= 0) {
      this.records.splice(existingIndex, 1);
    }
    this.records.push({
      ...input,
      attributedKinds: new Set<InteractionFollowUpKind>(),
    });
    if (this.records.length > this.maxRecords) {
      this.records.splice(0, this.records.length - this.maxRecords);
    }
  }

  attribute(input: AttributeFollowUpInput): InteractionAttribution | null {
    validateOccurredAt(input.occurredAtMs);
    if (input.followUpInteractionId) {
      validateInteractionId(input.followUpInteractionId);
    }

    const record = this.findCandidate(input);
    if (!record || record.attributedKinds.has(input.kind)) {
      return null;
    }
    const delayMs = input.occurredAtMs - record.occurredAtMs;
    if (delayMs < 0 || delayMs > this.windowMs) {
      return null;
    }
    if (record.interactionId === input.followUpInteractionId) {
      return null;
    }

    record.attributedKinds.add(input.kind);
    return {
      kind: input.kind,
      originatingInteractionId: record.interactionId,
      ...(input.followUpInteractionId
        ? { followUpInteractionId: input.followUpInteractionId }
        : {}),
      delayMs,
    };
  }

  clear(): void {
    this.records.length = 0;
  }

  private findCandidate(input: AttributeFollowUpInput): StoredInteraction | undefined {
    if (input.kind === "undo") {
      if (!input.originatingInteractionId) {
        return undefined;
      }
      return this.records.find(
        (record) =>
          record.interactionId === input.originatingInteractionId &&
          record.outcome === "applied",
      );
    }

    for (let index = this.records.length - 1; index >= 0; index -= 1) {
      const record = this.records[index]!;
      if (input.occurredAtMs - record.occurredAtMs > this.windowMs) {
        break;
      }
      if (input.kind === "correction" && record.outcome === "applied") {
        return record;
      }
      if (
        input.kind === "retry" &&
        record.outcome === "rejected" &&
        input.intentKey &&
        record.intentKey === input.intentKey
      ) {
        return record;
      }
    }
    return undefined;
  }
}

/**
 * Creates a compact in-memory comparison key. The command text is never
 * returned by the tracker or included in telemetry.
 */
export function createInteractionIntentKey(text: string): string {
  const normalized = text
    .normalize("NFKC")
    .toLocaleLowerCase("en-US")
    .replace(/[.,!?;:'"“”‘’…]+/gu, "")
    .replace(/\s+/gu, " ")
    .trim();
  let hash = 0x811c9dc5;
  for (let index = 0; index < normalized.length; index += 1) {
    hash = Math.imul(hash ^ normalized.charCodeAt(index), 0x01000193);
  }
  return `v1:${normalized.length}:${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

/**
 * Narrow signal for an explicit correction, used only together with the
 * temporal window. Ordinary follow-on commands are intentionally excluded.
 */
export function isExplicitInteractionCorrection(text: string): boolean {
  const normalized = text.normalize("NFKC").trim().toLocaleLowerCase("en-US");
  return /^(?:no\b|actually\b|sorry\b|i meant\b|rather\b|instead\b|correction\b|make that\b|change that\b)/u.test(
    normalized,
  );
}

function validateInteractionId(interactionId: string): void {
  if (
    interactionId.length < 8 ||
    interactionId.length > 128 ||
    !/^[\x21-\x7E]+$/u.test(interactionId)
  ) {
    throw new Error("Interaction ID must be a bounded non-empty identifier.");
  }
}

function validateOccurredAt(occurredAtMs: number): void {
  if (!Number.isFinite(occurredAtMs)) {
    throw new Error("Attribution time must be finite.");
  }
}
