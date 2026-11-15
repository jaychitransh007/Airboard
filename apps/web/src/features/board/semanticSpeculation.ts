import type {
  ResolveSemanticIntentOptions,
  SemanticIntentAddressedBy,
  SemanticIntentContext,
  SemanticIntentParserIssue,
  SemanticIntentPendingClarification,
} from "./semanticIntent";

/**
 * Speculative planner calls for a held voice command.
 *
 * A spoken command waits in the coalescer (about 1.2 s) in case the speaker
 * continues it ("add a cache… called Orders"). For a command that will go to
 * the AI planner anyway, the planner request can start during that wait. When
 * the command flushes, its planner request is built exactly as before; the
 * speculative answer is used only when that request is identical to the one
 * already sent (same words, same board and selection context, same open
 * question, same model, same turn) and nothing cancelled or superseded it in
 * between. Anything else discards the speculation and the command is planned
 * as usual, so a speculation never changes what is applied, only when.
 *
 * A speculative call never touches the board: it is a plain request whose
 * answer is applied (or dropped) by the normal path.
 */

export type SemanticSpeculationMiss =
  | "none"
  | "key"
  | "generation"
  | "request"
  | "clarification";

export type SemanticSpeculationTake<T> =
  | { hit: true; promise: Promise<T>; startedAt: number }
  | { hit: false; reason: SemanticSpeculationMiss };

export type SemanticSpeculationStart<T> = {
  /** voiceTurnId + NUL + normalized instruction; see semanticSpeculationKey. */
  key: string;
  /** The planner generation (request id counter) when the speculation started. */
  generation: number;
  /** Exact serialized request; see semanticRequestFingerprint. */
  fingerprint: string;
  /** The open clarification record the request was built with (compared by identity). */
  clarification: unknown;
  run: (signal: AbortSignal) => Promise<T>;
};

type Slot<T> = {
  key: string;
  generation: number;
  fingerprint: string;
  clarification: unknown;
  controller: AbortController;
  promise: Promise<T>;
  startedAt: number;
};

export class SemanticSpeculation<T> {
  private slot: Slot<T> | null = null;
  private readonly now: () => number;

  constructor(options: { now?: () => number } = {}) {
    this.now = options.now ?? (() => Date.now());
  }

  /** The key of the running speculation, if any. */
  get activeKey(): string | null {
    return this.slot?.key ?? null;
  }

  /**
   * Starts a speculation. A running one with the same key and request is kept
   * (returns false); any other running one is aborted and replaced.
   */
  start(params: SemanticSpeculationStart<T>): boolean {
    const current = this.slot;
    if (
      current &&
      current.key === params.key &&
      current.fingerprint === params.fingerprint &&
      current.generation === params.generation &&
      current.clarification === params.clarification
    ) {
      return false;
    }
    this.invalidate();
    const controller = new AbortController();
    const promise = params.run(controller.signal);
    // A discarded speculation's rejection is expected; never surface it as unhandled.
    promise.catch(() => undefined);
    this.slot = {
      key: params.key,
      generation: params.generation,
      fingerprint: params.fingerprint,
      clarification: params.clarification,
      controller,
      promise,
      startedAt: this.now(),
    };
    return true;
  }

  /**
   * Hands over the running speculation's answer only on an exact match, and
   * clears the slot either way. A mismatch aborts the speculative request.
   */
  take(match: {
    key: string;
    generation: number;
    fingerprint: string;
    clarification: unknown;
  }): SemanticSpeculationTake<T> {
    const slot = this.slot;
    if (!slot) return { hit: false, reason: "none" };
    this.slot = null;
    const reason: SemanticSpeculationMiss | null =
      slot.key !== match.key
        ? "key"
        : slot.generation !== match.generation
          ? "generation"
          : slot.clarification !== match.clarification
            ? "clarification"
            : slot.fingerprint !== match.fingerprint
              ? "request"
              : null;
    if (reason) {
      slot.controller.abort();
      return { hit: false, reason };
    }
    return { hit: true, promise: slot.promise, startedAt: slot.startedAt };
  }

  /** Aborts and forgets the running speculation, if any. Returns its key. */
  invalidate(): string | null {
    const slot = this.slot;
    this.slot = null;
    slot?.controller.abort();
    return slot?.key ?? null;
  }
}

export function semanticSpeculationKey(voiceTurnId: string, instruction: string): string {
  return `${voiceTurnId}\u0000${instruction.trim().replace(/\s+/gu, " ")}`;
}

/** How a spoken command was addressed, as the planner request states it. */
export function voiceAddressedBy(wakePhrase: string | undefined): SemanticIntentAddressedBy | undefined {
  return wakePhrase === "push-to-talk"
    ? "palm"
    : wakePhrase === "hold-to-edit"
      ? "hold"
      : wakePhrase === "follow-up" || wakePhrase === "answer"
        ? undefined
        : "wake";
}

export type SemanticRequestInputs = {
  apiBaseUrl: string;
  accessToken?: string | null | undefined;
  voiceTurnId: string;
  transcript: string;
  parserIssue: SemanticIntentParserIssue;
  context: SemanticIntentContext;
  pendingClarification?: SemanticIntentPendingClarification | undefined;
  model?: string | null | undefined;
  addressedBy?: SemanticIntentAddressedBy | undefined;
};

/**
 * The planner request for a command. Both the speculative call and the
 * normal call build their request here, so equal inputs give equal requests.
 */
export function composeSemanticRequestOptions(inputs: SemanticRequestInputs): ResolveSemanticIntentOptions {
  return {
    apiBaseUrl: inputs.apiBaseUrl,
    ...(inputs.accessToken ? { accessToken: inputs.accessToken } : {}),
    voiceTurnId: inputs.voiceTurnId,
    transcript: inputs.transcript,
    parserIssue: inputs.parserIssue,
    context: inputs.context,
    ...(inputs.pendingClarification ? { pendingClarification: inputs.pendingClarification } : {}),
    ...(inputs.model ? { model: inputs.model } : {}),
    ...(inputs.addressedBy ? { addressedBy: inputs.addressedBy } : {}),
  };
}

/** Everything that reaches the server, serialized in a fixed order. */
export function semanticRequestFingerprint(options: ResolveSemanticIntentOptions): string {
  return JSON.stringify([
    options.apiBaseUrl,
    options.accessToken ?? null,
    options.voiceTurnId,
    options.transcript,
    options.parserIssue,
    options.context,
    options.pendingClarification ?? null,
    options.addressedBy ?? null,
    options.model ?? null,
  ]);
}

/**
 * How the planner request states who addressed it: a typed command (no voice
 * turn), the way the running voice command was addressed, or the wake word.
 * The speculation passes voiceAddressedBy(decision.wakePhrase), which is
 * what the voice queue records for the same decision.
 */
export function plannerRequestAddressedBy(
  voiceTurnId: string | undefined,
  voiceAddressed: { addressedBy: SemanticIntentAddressedBy | undefined } | null,
): SemanticIntentAddressedBy | undefined {
  if (!voiceTurnId) return "typed";
  return voiceAddressed ? voiceAddressed.addressedBy : "wake";
}

/**
 * Whether the planner is told a pointer is available. A voice command's
 * captured reference decides it (even when it holds no point); without one,
 * the last gesture pointer does.
 */
export function plannerRequestHasPointer(
  voiceReference: { point: unknown } | null,
  lastGesturePointer: unknown,
): boolean {
  return voiceReference ? Boolean(voiceReference.point) : Boolean(lastGesturePointer);
}
