/**
 * What the presenter's hand is pointing at, for voice deixis ("add a database
 * here", "connect this to that") and hand multi-select. Pure over injected
 * timestamps; the board feeds one observation per manipulation frame.
 */

export type HandPointingSnapshot = {
  /**
   * When a tracked hand was last seen (ms, same clock as the observations).
   * Frames without a tracked hand don't refresh it, so the snapshot goes
   * stale once the hand leaves the camera.
   */
  at: number;
  /** Board-space point under the hand, or null when no hand is tracked. */
  boardPoint: { x: number; y: number } | null;
  /**
   * Distinct shape ids (legacy stroke ids or v2 scene element ids) the hand
   * pointed at during the last `HAND_POINTING_WINDOW_MS`, oldest first, most
   * recent last.
   */
  targetIds: string[];
};

export const HAND_POINTING_WINDOW_MS = 6_000;

export const EMPTY_HAND_POINTING_SNAPSHOT: HandPointingSnapshot = Object.freeze({
  at: 0,
  boardPoint: null,
  targetIds: [],
}) as HandPointingSnapshot;

/**
 * Keeps the rolling pointing history. `observe` returns a fresh immutable
 * snapshot whenever something changed, so a voice turn can keep the object it
 * read when speech started and later frames never rewrite it.
 */
export class HandPointingRecorder {
  private readonly windowMs: number;
  private visits: { id: string; at: number }[] = [];
  private current: HandPointingSnapshot = EMPTY_HAND_POINTING_SNAPSHOT;

  constructor(windowMs = HAND_POINTING_WINDOW_MS) {
    this.windowMs = windowMs;
  }

  get snapshot(): HandPointingSnapshot {
    return this.current;
  }

  observe(input: {
    now: number;
    boardPoint: { x: number; y: number } | null;
    targetId: string | null;
    /**
     * False when no hand is tracked this frame. The gesture controller keeps
     * reporting its frozen last cursor after the hand is lost; such frames
     * must not keep the last point looking fresh. Defaults to true.
     */
    tracked?: boolean;
  }): HandPointingSnapshot {
    const { now } = input;
    if (input.tracked === false) {
      this.visits = this.visits.filter((visit) => now - visit.at <= this.windowMs);
      const targetIds = this.visits.map((visit) => visit.id);
      if (
        targetIds.length !== this.current.targetIds.length ||
        targetIds.some((id, index) => id !== this.current.targetIds[index])
      ) {
        this.current = Object.freeze({
          ...this.current,
          targetIds: Object.freeze(targetIds) as string[],
        }) as HandPointingSnapshot;
      }
      return this.current;
    }
    const { targetId } = input;
    if (targetId) {
      const last = this.visits.at(-1);
      if (last?.id === targetId) {
        last.at = now;
      } else {
        this.visits = this.visits.filter((visit) => visit.id !== targetId);
        this.visits.push({ id: targetId, at: now });
      }
    }
    this.visits = this.visits.filter((visit) => now - visit.at <= this.windowMs);
    const boardPoint = input.boardPoint ?? this.current.boardPoint;
    this.current = Object.freeze({
      at: now,
      boardPoint: boardPoint ? Object.freeze({ x: boardPoint.x, y: boardPoint.y }) : null,
      targetIds: Object.freeze(this.visits.map((visit) => visit.id)) as string[],
    }) as HandPointingSnapshot;
    return this.current;
  }

  /** Forget a shape that was deleted, so "that" never resolves to it. */
  forget(targetId: string): void {
    this.visits = this.visits.filter((visit) => visit.id !== targetId);
    this.current = Object.freeze({
      ...this.current,
      targetIds: Object.freeze(this.visits.map((visit) => visit.id)) as string[],
    }) as HandPointingSnapshot;
  }

  reset(): void {
    this.visits = [];
    this.current = EMPTY_HAND_POINTING_SNAPSHOT;
  }
}

/**
 * Resolves spoken pointing words against a snapshot taken when speech began.
 *
 * - `here`: the board point under the hand.
 * - `this` alone (or "it" said while pointing): the most recent shape.
 * - "this … that" (`count: 2`): the last two shapes in the order the hand
 *   visited them, so "connect this to that" after pointing at A then B gives
 *   [A, B].
 *
 * A snapshot older than `maxAgeMs` relative to `now` resolves to nothing, so a
 * stale point never captures an unrelated command.
 */
export function resolveHandPointing(
  snapshot: HandPointingSnapshot | null | undefined,
  options: { now: number; count?: 1 | 2; maxAgeMs?: number },
): { here: { x: number; y: number } | null; targetIds: string[] } {
  const maxAgeMs = options.maxAgeMs ?? HAND_POINTING_WINDOW_MS;
  if (!snapshot || snapshot.at <= 0 || options.now - snapshot.at > maxAgeMs) {
    return { here: null, targetIds: [] };
  }
  const count = options.count ?? 1;
  return {
    here: snapshot.boardPoint ? { ...snapshot.boardPoint } : null,
    targetIds: snapshot.targetIds.slice(-count),
  };
}

export type HandDwellConfig = {
  /** How long the open hand must rest on one shape. */
  dwellMs: number;
  /** Screen-pixel drift still counted as resting. */
  tolerancePx: number;
};

export const defaultHandDwellConfig: HandDwellConfig = {
  dwellMs: 900,
  tolerancePx: 22,
};

/**
 * Hand multi-select: while something is already selected, resting the open
 * hand still on another shape for `dwellMs` adds it to the selection. Fires
 * once per visit; the hand must leave the shape before it can fire again.
 */
export class HandDwellSelectTracker {
  private readonly config: HandDwellConfig;
  private dwell: {
    targetId: string;
    anchor: { x: number; y: number };
    since: number;
    fired: boolean;
  } | null = null;

  constructor(config: Partial<HandDwellConfig> = {}) {
    this.config = { ...defaultHandDwellConfig, ...config };
  }

  update(input: {
    now: number;
    targetId: string | null;
    screenPoint: { x: number; y: number } | null;
    /** False while grabbing, carrying, or with nothing selected. */
    eligible: boolean;
  }): string | null {
    const { now, targetId, screenPoint } = input;
    if (!targetId || !screenPoint) {
      this.dwell = null;
      return null;
    }
    if (!this.dwell || this.dwell.targetId !== targetId) {
      this.dwell = { targetId, anchor: screenPoint, since: now, fired: false };
      return null;
    }
    if (
      Math.hypot(screenPoint.x - this.dwell.anchor.x, screenPoint.y - this.dwell.anchor.y) >
      this.config.tolerancePx
    ) {
      this.dwell.anchor = screenPoint;
      this.dwell.since = now;
      return null;
    }
    if (!input.eligible) {
      this.dwell.since = now;
      return null;
    }
    if (!this.dwell.fired && now - this.dwell.since >= this.config.dwellMs) {
      this.dwell.fired = true;
      return targetId;
    }
    return null;
  }

  reset(): void {
    this.dwell = null;
  }
}
