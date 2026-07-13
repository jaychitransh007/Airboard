import type { VoiceTraceAppend, VoiceTraceEvent, VoiceTraceSnapshot } from "./types";

type StoredTrace = {
  nextSequence: number;
  droppedEvents: number;
  events: VoiceTraceEvent[];
};

export class VoiceTraceBuffer {
  private readonly traces = new Map<string, StoredTrace>();
  private readonly maxTurns: number;
  private readonly maxEventsPerTurn: number;

  constructor(maxTurns = 128, maxEventsPerTurn = 64) {
    this.maxTurns = maxTurns;
    this.maxEventsPerTurn = maxEventsPerTurn;
  }

  append(input: VoiceTraceAppend, now = new Date()): VoiceTraceEvent {
    let stored = this.traces.get(input.voiceTurnId);
    if (!stored) {
      this.evictOldestTurnIfNeeded();
      stored = { nextSequence: 1, droppedEvents: 0, events: [] };
      this.traces.set(input.voiceTurnId, stored);
    } else {
      // Map insertion order doubles as a least-recently-appended eviction order.
      this.traces.delete(input.voiceTurnId);
      this.traces.set(input.voiceTurnId, stored);
    }

    const event: VoiceTraceEvent = {
      ...input,
      sequence: stored.nextSequence,
      receivedAt: now.toISOString(),
    };
    stored.nextSequence += 1;
    stored.events.push(event);
    if (stored.events.length > this.maxEventsPerTurn) {
      stored.events.shift();
      stored.droppedEvents += 1;
    }
    return event;
  }

  /** Every buffered turn, for aggregation. Insertion (≈recency) order. */
  snapshotTurns(): VoiceTraceSnapshot[] {
    return [...this.traces.entries()].map(([voiceTurnId, stored]) => ({
      voiceTurnId,
      events: stored.events.map((event) => structuredClone(event)),
      droppedEvents: stored.droppedEvents,
    }));
  }

  get(voiceTurnId: string): VoiceTraceSnapshot | null {
    const stored = this.traces.get(voiceTurnId);
    if (!stored) {
      return null;
    }
    return {
      voiceTurnId,
      events: stored.events.map((event) => structuredClone(event)),
      droppedEvents: stored.droppedEvents,
    };
  }

  private evictOldestTurnIfNeeded(): void {
    if (this.traces.size < this.maxTurns) {
      return;
    }
    const oldest = this.traces.keys().next().value as string | undefined;
    if (oldest) {
      this.traces.delete(oldest);
    }
  }
}
