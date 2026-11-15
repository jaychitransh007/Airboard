// The .ts extension keeps this module directly runnable under Node's type
// stripping (unit tests, eval scripts) while the bundler resolves it the same.
import {
  classifyBrowserWakeTranscript,
  createBrowserWakeCommandRouter,
  isCommandShapedUtterance,
  isConnectiveCommandUtterance,
  isReferenceAnswerUtterance,
  normalizeBrowserWakeCommand,
  normalizeScopedVoiceUtterance,
  stripPoliteCommandLeadIn,
  type BrowserWakeCommandRouter,
} from "./browserSpeech.ts";

/**
 * The single owner of "does this finalized transcript become a board command,
 * and through which channel?". Channels, in priority order:
 *
 *   1. gated-scoped — a hold-to-edit gate is scoping an element,
 *   2. gated-ptt    — the open-palm-hold push-to-talk gate is open,
 *   3. wake         — the "Airo …" wake-word router,
 *   4. answer       — Airo asked a question; the next short or
 *                     command/reference-shaped sentence is the answer,
 *   5. follow-up    — a command was just routed; the next sentence that is
 *                     clearly a board edit ("and connect it to the API",
 *                     "make it red", "the billing one") needs no wake word.
 *                     Meeting imperatives ("create a ticket…", "add Priya to
 *                     the invite") never route this way — see
 *                     isBoardFollowUpUtterance.
 *
 * Everything that used to make this fragile is centralized here: gate grace
 * windows (a transcript may finalize just after the gesture releases),
 * single-consumption of grace-window gates, expiry, speech-start ownership
 * (speech that began before the palm went up is not the gate's), and —
 * critically — the dedup invariant: **one transcript can produce at most one
 * routed command**, even when a gate/window and the wake router would both
 * claim it. The class is pure over an injectable clock, so every rule is
 * unit-testable.
 */

export type VoiceGateMode = "ptt" | "scoped";

export type VoiceGateSnapshot = {
  mode: VoiceGateMode;
  strokeId?: string;
  /** False while the gate is in its post-release grace window. */
  open: boolean;
} | null;

export type VoiceRouteChannel =
  | "gated-scoped"
  | "gated-ptt"
  | "wake"
  | "follow-up"
  | "answer";

export type VoiceRouteDecision = {
  channel: VoiceRouteChannel;
  /** The command text to execute (wake-stripped, scope-normalized). */
  command: string;
  /** The raw transcript the decision came from. */
  transcript: string;
  /**
   * Provenance label for traces: gesture name ("push-to-talk",
   * "hold-to-edit"), window name ("follow-up", "answer") or the actual wake
   * phrase.
   */
  wakePhrase: string;
  /** Set for scoped decisions: the element the gate was scoping. */
  strokeId?: string;
};

export type VoiceWindowSnapshot = {
  /** A command was routed recently; a command-shaped sentence needs no wake word. */
  followUpOpen: boolean;
  /** Airo asked a question; the next sentence is taken as the answer. */
  answerOpen: boolean;
};

/** Follow-up window after any routed command. */
export const VOICE_FOLLOW_UP_WINDOW_MS = 8_000;
/** Answer window after Airo asks a question. */
export const VOICE_ANSWER_WINDOW_MS = 10_000;
/**
 * Speech that started at most this long before a gate opened still belongs to
 * the gate (people start talking as the palm settles). Earlier speech is the
 * previous, unaddressed sentence and is never grabbed.
 */
export const VOICE_GATE_SPEECH_LEAD_MS = 300;

export type VoiceCommandRouterConfig = {
  now?: () => number;
  /** Post-release routing grace for push-to-talk. */
  pttGraceMs?: number;
  /** Post-release routing grace for hold-to-edit ("grab, let go, speak"). */
  scopedGraceMs?: number;
  /** Maximum time an utterance that began inside a gate may take to finalize. */
  utteranceClaimMs?: number;
  /** See VOICE_FOLLOW_UP_WINDOW_MS. 0 disables the follow-up channel. */
  followUpWindowMs?: number;
  /** Default answer-window length for openAnswerWindow(). */
  answerWindowMs?: number;
  /** See VOICE_GATE_SPEECH_LEAD_MS. */
  gateSpeechLeadMs?: number;
  /**
   * Silence after which new speech activity counts as a new utterance even
   * though no final transcript arrived for the previous one.
   */
  utteranceSilenceResetMs?: number;
};

type GateState = {
  mode: VoiceGateMode;
  strokeId?: string;
  openedAt: number;
  closedAt: number | null;
};

const FILLER_ONLY_PATTERN =
  /^(?:(?:uh|um|erm|ah|hmm|mm|oh|okay|ok|alright|right|so|well|yeah|yes|hm)(?:[\s,.:;!?–—-]+|$))+$/iu;

/** Longest answer (in words) accepted without a command or reference shape. */
export const VOICE_ANSWER_MAX_WORDS = 12;

// Things a meeting does that the board does not: tickets, invites, branches,
// files, slides, orders, minutes, schedules, people. A follow-up mentioning one
// is room talk, whatever verb it starts with.
const MEETING_TALK_PATTERN = new RegExp(
  [
    String.raw`\b(?:tickets?|jira|invites?|invitations?|calendar|meetings?|minutes|agenda|branch(?:es)?|merge|merging|commits?|pull\s+requests?|PRs?|deploy(?:ment)?s?|rollout|release|feature\s+flags?|flags?)\b`,
    String.raw`\b(?:files?(?!\s+(?:storage|store|system|server|service))|folders?|drive|documents?|docs?|slides?|deck|presentation|e-?mails?|mail|inbox|messages?(?!\s+(?:queue|bus|broker))|slack|chat|thread|notes|printout|print|config|environment|console|logs|flaky)\b`,
    String.raw`\b(?:the|an|your|my|our)\s+order\b(?!\s+(?:service|queue|db|database|table|api|box|node|system))`,
    String.raw`\b(?:invoice|budget|discount|form|forms|options|input|proposal|legal|lunch|coffee|ship|shipping|team|customers?)\b`,
    String.raw`\b(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday|tomorrow|tonight|today|yesterday|week|sprint|quarter|deadline|eod)\b`,
    String.raw`\b(?:you|your|yours|me|my|we|our|let'?s)\b`,
    String.raw`\b(?:before|after|once|when|until|while|whenever)\s+(?:you|we|i|they|he|she|it\s+\w+s|shipping|merging|lunch|the\s+(?:call|meeting|rollout|release|demo|sprint|launch|review|break))\b`,
    String.raw`\bonce\s+the\b|\bend\s+of\s+it\b|\bmove\s+on\b|\bthis\s+call\b`,
  ].join("|"),
  "iu",
);

// Something on the board: a shape type, a connector, a reference, a colour,
// a size.
const BOARD_OBJECT_PATTERN =
  /\b(?:box(?:es)?|nodes?|shapes?|circles?|rectangles?|squares?|diamonds?|decisions?|databases?|db|datastores?|stores?|services?|servers?|apis?|gateways?|endpoints?|users?|actors?|clients?|browsers?|apps?|frontend|backend|queues?|caches?|note|sticky|stickies|text|labels?|titles?|arrows?|connectors?|connections?|lines?|edges?|links?|groups?|frames?|containers?|steps?|process(?:es)?|components?|workers?|functions?|lambdas?|storage|buckets?|tables?|topics?|streams?|balancers?|cdn|auth|login|diagram|board|flow|chart|canvas|layers?|ellipses?|ovals?|microservices?|terminators?|selected|selection|here|there|a\s+p\s+i|it|this|that|these|those|them|everything|all|both|one|ones|other|red|blue|green|yellow|orange|purple|pink|teal|gr[ae]y|black|white|brown|bigger|smaller|larger|wider|narrower|taller|shorter|bold|dashed|dotted|left|right|top|bottom|middle|center|centre)\b/iu;

// Flowchart shape types that share a word with meeting talk ("add a document
// here", "add an input here", "five sticky notes") read as shapes when spoken
// as a placed or named shape.
const SHAPE_PHRASE_PATTERN =
  /\b(?:sticky\s+notes?|(?:a|an|one|two|three|four|five|\d+)\s+(?:documents?|inputs?|starts?|ends?|terminators?|data)(?=\s+(?:here|there|named|called|labell?ed|titled|next\s+to|below|above|between)\b))/giu;

// Verbs that only make sense on the board.
const INHERENT_BOARD_VERB_PATTERN =
  /^(?:(?:and\s+then|and\s+now|and\s+also|and|also|then|now|next)[\s,]+)?(?:connect|link|undo|redo|zoom|fit|align|arrange|lay\s+(?:out|them|it|these)|layout|group|ungroup|resize|duplicate|rename|relabel)\b/iu;

// The label payload of a naming command is free text and is not scanned for
// meeting words ("rename it to Orders", "add a box called Friday").
const LABEL_PAYLOAD_PATTERN =
  /(\b(?:rename|relabel|call|name|label|retitle)\b.*?\b(?:to|as)\b|\b(?:called|named|labell?ed|titled)\b).*$/iu;

const CORRECTION_FOLLOW_UP_PATTERN =
  /^(?:(?:no|sorry|actually|oops|wait)[\s,.]+)*(?:scratch\s+that|undo\s+that|not\s+that\s+one|(?:i\s+)?meant\s+(?:the|a|an|it|this|that)\b.*|i\s+said\s+(?:the|a|an)\b.*)$/iu;

const CONVERSATIONAL_ANSWER_PATTERN =
  /^(?:(?:hmm|um|uh|so|well|okay|ok|oh)[\s,.]+)*(?:let\s+me\s+think|hold\s+on|hang\s+on|one\s+sec(?:ond)?|give\s+me\s+a\s+(?:sec|second|minute)|sorry\s+\p{Lu}\p{L}*|go\s+ahead|i\s+don'?t\s+know|never\s+mind\s+(?:that|him|her))\b/iu;

function wordCount(text: string): number {
  const trimmed = text.trim();
  return trimmed ? trimmed.split(/\s+/u).length : 0;
}

/**
 * True when a sentence heard without a wake word, right after a routed
 * command, is clearly another board edit and may route as a follow-up:
 *
 *   - a short reference answer ("the billing one", "the second one");
 *   - a correction ("scratch that", "no, I meant the cache");
 *   - an imperative board verb, optionally after a polite ask ("can you also
 *     connect it to the API"), whose object plausibly refers to the board —
 *     a shape or label, "it/this/that", a colour or size, or a board-only verb
 *     such as connect/link/rename/align — and which mentions nothing that
 *     belongs to the meeting instead (tickets, invites, branches, files,
 *     slides, orders, minutes, days, people, "before you merge…").
 *
 * Everything else is room talk. The planner must still apply its own
 * discussion test to follow-ups: this is a routing filter, not an addressing
 * guarantee.
 */
export function isBoardFollowUpUtterance(utterance: string): boolean {
  const text = normalizeBrowserWakeCommand(utterance.normalize("NFKC").replace(/[\u2018\u2019]/gu, "'"))
    .replace(/[\s.!?]+$/u, "")
    .trim();
  if (!text) {
    return false;
  }
  if (isReferenceAnswerUtterance(text)) {
    return true;
  }
  if (wordCount(text) <= 8 && CORRECTION_FOLLOW_UP_PATTERN.test(text)) {
    return true;
  }
  const core = stripPoliteCommandLeadIn(text);
  if (!core || !isCommandShapedUtterance(core) || wordCount(core) > 16) {
    return false;
  }
  const scanned = core.replace(LABEL_PAYLOAD_PATTERN, "$1").replace(SHAPE_PHRASE_PATTERN, "shape");
  if (MEETING_TALK_PATTERN.test(scanned)) {
    return false;
  }
  if (BOARD_OBJECT_PATTERN.test(scanned) || INHERENT_BOARD_VERB_PATTERN.test(core)) {
    return true;
  }
  // A bare verb ("delete", "delete please", "duplicate") acts on the selection.
  if (/^(?:\S+[\s,]+){0,2}\S+$/u.test(core) && !/\b(?:the|a|an|some)\b/iu.test(core)) {
    return wordCount(core.replace(/\b(?:please|now|then|and|also|again)\b/giu, "")) <= 1;
  }
  // A capitalized word after the verb is most likely a label on the board
  // ("delete Payments"); ASR capitalizes names, not ordinary words.
  return /\s\p{Lu}[\p{L}\p{N}-]*/u.test(scanned.replace(/\bI\b/gu, ""));
}

/**
 * True when a sentence heard while Airo's answer window is open may be taken
 * as the answer: short (at most VOICE_ANSWER_MAX_WORDS words) or command /
 * reference-shaped, and not an obvious aside to the room ("hold on", "sorry
 * Bob, go ahead", "let me think about that").
 */
export function isAnswerShapedUtterance(utterance: string): boolean {
  const text = normalizeBrowserWakeCommand(utterance).replace(/[\s.!?]+$/u, "").trim();
  if (!text || CONVERSATIONAL_ANSWER_PATTERN.test(text)) {
    return false;
  }
  return (
    wordCount(text) <= VOICE_ANSWER_MAX_WORDS ||
    isCommandShapedUtterance(stripPoliteCommandLeadIn(text)) ||
    isReferenceAnswerUtterance(text)
  );
}

export class VoiceCommandRouter {
  private readonly now: () => number;
  private readonly pttGraceMs: number;
  private readonly scopedGraceMs: number;
  private readonly utteranceClaimMs: number;
  private readonly followUpWindowMs: number;
  private readonly answerWindowMs: number;
  private readonly gateSpeechLeadMs: number;
  private readonly utteranceSilenceResetMs: number;
  private readonly wakeRouter: BrowserWakeCommandRouter;

  private gate: GateState | null = null;
  private utteranceGate: { gate: GateState; capturedAt: number } | null = null;
  private collectingWake: VoiceRouteDecision[] | null = null;
  private speechStartedAt: number | null = null;
  private lastSpeechAt: number | null = null;
  private followUpUntil: number | null = null;
  private answerUntil: number | null = null;

  constructor(config: VoiceCommandRouterConfig = {}) {
    this.now = config.now ?? (() => Date.now());
    this.pttGraceMs = config.pttGraceMs ?? 1_600;
    this.scopedGraceMs = config.scopedGraceMs ?? 8_000;
    this.utteranceClaimMs = config.utteranceClaimMs ?? 15_000;
    this.followUpWindowMs = config.followUpWindowMs ?? VOICE_FOLLOW_UP_WINDOW_MS;
    this.answerWindowMs = config.answerWindowMs ?? VOICE_ANSWER_WINDOW_MS;
    this.gateSpeechLeadMs = config.gateSpeechLeadMs ?? VOICE_GATE_SPEECH_LEAD_MS;
    this.utteranceSilenceResetMs = config.utteranceSilenceResetMs ?? 2_000;
    this.wakeRouter = createBrowserWakeCommandRouter(
      {
        onCommand: ({ command, transcript, wakePhrase }) => {
          this.collectingWake?.push({
            channel: "wake",
            command,
            transcript,
            wakePhrase,
          });
        },
      },
      { now: () => this.now() },
    );
  }

  /**
   * Reports that speech is being heard (call on every interim result). The
   * first activity of an utterance marks its start; only an utterance that
   * started after the gate opened (or within VOICE_GATE_SPEECH_LEAD_MS before)
   * is claimed by the gate.
   *
   * Speech providers often emit the final transcript several seconds after
   * the user has lowered their open palm. Capturing the gate on the first
   * interim result keeps that same utterance automatic without extending the
   * general post-gesture grace window for unrelated room speech.
   */
  noteSpeechActivity(atMs?: number): void {
    const at = atMs ?? this.now();
    this.expire();
    if (
      this.speechStartedAt === null ||
      (this.lastSpeechAt !== null && at - this.lastSpeechAt > this.utteranceSilenceResetMs)
    ) {
      this.speechStartedAt = at;
      this.utteranceGate = null;
    }
    this.lastSpeechAt = this.lastSpeechAt === null ? at : Math.max(this.lastSpeechAt, at);
    this.captureGateForUtterance();
  }

  /**
   * Reports an explicit start of speech (voice-activity "speech started"
   * events), which is more precise than the first interim result. Optional.
   */
  noteSpeechStart(atMs?: number): void {
    const at = atMs ?? this.now();
    this.expire();
    this.speechStartedAt = at;
    this.lastSpeechAt = at;
    this.utteranceGate = null;
    this.captureGateForUtterance();
  }

  get snapshot(): VoiceGateSnapshot {
    if (!this.gate) {
      return null;
    }
    return {
      mode: this.gate.mode,
      ...(this.gate.strokeId !== undefined ? { strokeId: this.gate.strokeId } : {}),
      open: this.gate.closedAt === null,
    };
  }

  /** Which no-wake-word windows are currently open. */
  get windows(): VoiceWindowSnapshot {
    const now = this.now();
    return {
      followUpOpen: this.followUpUntil !== null && now <= this.followUpUntil,
      answerOpen: this.answerUntil !== null && now <= this.answerUntil,
    };
  }

  /**
   * True while the next sentence may route without a wake word (a follow-up
   * or answer window is open). The UI uses it to decide whether heard speech
   * is addressed to Airo and may be shown on the presented tab.
   */
  expectsFollowUp(): boolean {
    const { followUpOpen, answerOpen } = this.windows;
    return followUpOpen || answerOpen;
  }

  openGate(gate: { mode: VoiceGateMode; strokeId?: string }): VoiceGateSnapshot {
    this.gate = {
      mode: gate.mode,
      ...(gate.strokeId !== undefined ? { strokeId: gate.strokeId } : {}),
      openedAt: this.now(),
      closedAt: null,
    };
    return this.snapshot;
  }

  closeGate(mode: VoiceGateMode): void {
    if (this.gate && this.gate.mode === mode && this.gate.closedAt === null) {
      this.gate.closedAt = this.now();
    }
  }

  /** Drops a grace-lapsed gate. Returns true when the gate was removed. */
  expire(): boolean {
    if (!this.gate || this.gate.closedAt === null) {
      return false;
    }
    const grace = this.gate.mode === "scoped" ? this.scopedGraceMs : this.pttGraceMs;
    if (this.now() - this.gate.closedAt > grace) {
      this.gate = null;
      return true;
    }
    return false;
  }

  /**
   * Airo asked a question: accept the next finalized answer-shaped sentence
   * (no wake word; short, or command / reference-shaped — see
   * isAnswerShapedUtterance) as the answer for `durationMs`. Decisions routed
   * this way use channel "answer". The window closes after one routed answer,
   * and any routed command closes it. A long aside to the room does not
   * consume it.
   */
  openAnswerWindow(durationMs: number = this.answerWindowMs): void {
    this.answerUntil = this.now() + Math.max(0, durationMs);
  }

  closeAnswerWindow(): void {
    this.answerUntil = null;
  }

  /**
   * Restarts the follow-up window from now. Call when a routed command has
   * finished applying (planning can take seconds), so the window is measured
   * from what the presenter sees, not from when the words were heard.
   */
  noteCommandSettled(): void {
    if (this.followUpWindowMs > 0) {
      this.followUpUntil = this.now() + this.followUpWindowMs;
    }
  }

  closeFollowUpWindow(): void {
    this.followUpUntil = null;
  }

  /**
   * Full routing for a final transcript (realtime transcription, test hooks).
   * Gates outrank the wake router, which outranks the answer and follow-up
   * windows; at most one channel claims a transcript.
   */
  handleFinalTranscript(transcript: string): {
    decisions: VoiceRouteDecision[];
    wakeDetected: boolean;
  } {
    const gated = this.routeGated(transcript);
    if (gated) {
      // The gate consumed this turn; a bare "Airo" said earlier must not
      // carry over onto the next, unrelated sentence.
      this.wakeRouter.reset();
      return { decisions: [gated], wakeDetected: false };
    }
    const decisions: VoiceRouteDecision[] = [];
    this.collectingWake = decisions;
    try {
      this.wakeRouter.consumeFinalTranscript(transcript);
    } finally {
      this.collectingWake = null;
    }
    const wakeDetected = classifyBrowserWakeTranscript(transcript).wakeDetected;
    if (decisions.length > 0) {
      this.noteRouted();
      return { decisions, wakeDetected };
    }
    const windowed = wakeDetected ? null : this.routeWindowed(transcript);
    return { decisions: windowed ? [windowed] : [], wakeDetected };
  }

  /** Session teardown: forget wake carryover, gates, and windows. */
  reset(): void {
    this.wakeRouter.reset();
    this.gate = null;
    this.utteranceGate = null;
    this.speechStartedAt = null;
    this.lastSpeechAt = null;
    this.followUpUntil = null;
    this.answerUntil = null;
  }

  private captureGateForUtterance(): void {
    if (!this.gate || this.utteranceGate || !this.speechBelongsTo(this.gate)) {
      return;
    }
    this.utteranceGate = {
      gate: { ...this.gate },
      capturedAt: this.now(),
    };
  }

  /** Unknown start (no activity reported) is treated as belonging. */
  private speechBelongsTo(gate: GateState): boolean {
    return (
      this.speechStartedAt === null ||
      this.speechStartedAt >= gate.openedAt - this.gateSpeechLeadMs
    );
  }

  private routeGated(transcript: string): VoiceRouteDecision | null {
    this.expire();
    const now = this.now();
    const captured =
      this.utteranceGate && now - this.utteranceGate.capturedAt <= this.utteranceClaimMs
        ? this.utteranceGate.gate
        : null;
    const liveGate = this.gate && this.speechBelongsTo(this.gate) ? this.gate : null;
    // A final transcript ends the utterance either way.
    this.utteranceGate = null;
    this.speechStartedAt = null;
    this.lastSpeechAt = null;
    const gate = captured ?? liveGate;
    if (!gate) {
      return null;
    }

    // A gated utterance may still carry a habitual "Airo" prefix — use the
    // wake classifier to strip it rather than parsing the wake word as text.
    const classification = classifyBrowserWakeTranscript(transcript);
    let command = classification.commands[0]?.command ?? transcript;
    if (gate.mode === "scoped") {
      command = normalizeScopedVoiceUtterance(command);
    }
    if (this.gate && this.gate.closedAt !== null) {
      // A grace-window gate routes exactly one utterance. An open gate keeps
      // routing every sentence until the palm drops.
      this.gate = null;
    }
    this.noteRouted();
    const decision: VoiceRouteDecision = {
      channel: gate.mode === "scoped" ? "gated-scoped" : "gated-ptt",
      command,
      transcript,
      wakePhrase: gate.mode === "scoped" ? "hold-to-edit" : "push-to-talk",
    };
    if (gate.strokeId !== undefined) {
      decision.strokeId = gate.strokeId;
    }
    return decision;
  }

  /** Answer and follow-up windows for a transcript with no wake word. */
  private routeWindowed(transcript: string): VoiceRouteDecision | null {
    const now = this.now();
    const text = normalizeBrowserWakeCommand(transcript);
    if (!text || FILLER_ONLY_PATTERN.test(text)) {
      // "um", "okay" — neither answers nor closes a window.
      return null;
    }
    if (this.answerUntil !== null && now <= this.answerUntil) {
      if (isAnswerShapedUtterance(text)) {
        this.answerUntil = null;
        this.noteRouted();
        return { channel: "answer", command: text, transcript, wakePhrase: "answer" };
      }
      // An aside to the room: leave the question open until it expires.
      return null;
    }
    this.answerUntil = null;
    if (this.followUpUntil !== null && now <= this.followUpUntil) {
      if (isBoardFollowUpUtterance(text)) {
        this.noteRouted();
        return { channel: "follow-up", command: text, transcript, wakePhrase: "follow-up" };
      }
      // The next sentence was room talk: the follow-up moment has passed.
      this.followUpUntil = null;
      return null;
    }
    this.followUpUntil = null;
    return null;
  }

  private noteRouted(): void {
    this.answerUntil = null;
    this.followUpUntil =
      this.followUpWindowMs > 0 ? this.now() + this.followUpWindowMs : null;
  }
}

/* -------------------------------------------------------------------------- */
/* Pause merging                                                              */
/* -------------------------------------------------------------------------- */

/**
 * Hold for an addressed command after its final transcript, with no further
 * speech heard, before it executes. A lone command therefore runs about this
 * long after its final arrives.
 *
 * Why this is enough for "Airo, add a database… [1.5 s pause] …called Orders":
 * realtime ASR finalizes a turn only after ~1.2 s of end-of-turn silence, so
 * the final for "add a database" arrives ~1.2 s into the pause and the
 * speaker resumes ~0.3 s later. The first interim of the continuation then
 * arrives well inside this hold, and from there `noteSpeechActivity()` keeps
 * the command held (see VOICE_COALESCE_ACTIVITY_HOLD_MS) until the
 * continuation's own final arrives and is merged.
 */
export const VOICE_COALESCE_HOLD_MS = 1_200;
/**
 * After the latest speech activity (interim result), keep holding at least
 * this long: covers the provider's end-of-turn silence (~1.2 s) plus
 * finalization latency, so the continuation's final can still arrive.
 */
export const VOICE_COALESCE_ACTIVITY_HOLD_MS = 1_800;
/**
 * Hard cap on how far speech activity can stretch a hold, measured from when
 * the command (or its latest merged continuation) was held. Ongoing room talk
 * can delay a command by at most this long.
 */
export const VOICE_COALESCE_MAX_HOLD_MS = 4_000;
/** Longer hold while a palm / hold-to-edit gate is still open. */
export const VOICE_COALESCE_GATE_HOLD_MS = 2_000;
/** Trailing grace after the gate closes before a held command flushes. */
export const VOICE_COALESCE_TRAILING_GRACE_MS = 300;
/**
 * Hold for a gated final that arrives after the palm dropped. The provider
 * finalizes a turn up to ~1.2 s after speech stops, so the palm may have
 * dropped in a thinking pause and the speaker may resume ("… called Orders")
 * a moment after this final arrives. The continuation's first interim lands
 * ~250-500 ms after speech resumes; this covers that while still running the
 * command 400 ms sooner than the ordinary hold.
 */
export const VOICE_COALESCE_LATE_GATED_FINAL_MS = 800;

/** Why a held command was emitted (for latency tracing). */
export type VoiceCoalescerFlushReason =
  /** The ordinary hold (or an activity-stretched hold) ran out. */
  | "timer"
  /** The palm / hold-to-edit gate closed, or a gated final arrived after it closed. */
  | "gate-drop"
  /** A new routed command that does not continue the held one. */
  | "new-command"
  /** Undo / cancel, or a complete local edit (see `flushImmediately`). */
  | "immediate"
  /** An interim result carried the wake word: the next command has started. */
  | "wake-interim"
  /** Room talk finalized during the hold and the shorter hold ran out. */
  | "room-talk"
  /** The caller flushed it directly. */
  | "explicit";

export type VoiceCoalescerFlushInfo = {
  /** From when the command was first held to its flush. */
  heldMs: number;
  merged: boolean;
  mergeCount: number;
  flushReason: VoiceCoalescerFlushReason;
  /** Time since the latest speech activity, or null when none was reported while held. */
  lastInterimAgoMs: number | null;
};

export type VoiceCommandCoalescerConfig = {
  /** Receives each command once it is complete (possibly merged). */
  onFlush: (decision: VoiceRouteDecision, info: VoiceCoalescerFlushInfo) => void;
  /**
   * Called whenever a command starts (or restarts) being held: a new held
   * command, a merge that changed it, or a gate change that re-armed its
   * hold. Never called for a command that flushes immediately. The decision
   * is what would flush if nothing else arrived.
   */
  onHold?: (decision: VoiceRouteDecision) => void;
  /**
   * True for a command that is complete on its own and should run at once
   * instead of waiting for a continuation (a style, delete or view change).
   * Only consulted while no gate is open and when the command does not end
   * open ("rename it to").
   */
  flushImmediately?: (decision: VoiceRouteDecision) => boolean;
  /** See VOICE_COALESCE_HOLD_MS. */
  holdMs?: number;
  /** See VOICE_COALESCE_ACTIVITY_HOLD_MS. */
  activityHoldMs?: number;
  /** See VOICE_COALESCE_MAX_HOLD_MS. */
  maxHoldMs?: number;
  gateHoldMs?: number;
  trailingGraceMs?: number;
  /** See VOICE_COALESCE_LATE_GATED_FINAL_MS. */
  lateGatedFinalMs?: number;
  /** Clock for hold deadlines (defaults to Date.now); keep it in step with setTimer. */
  now?: () => number;
  /** Injectable timers (defaults to globalThis setTimeout / clearTimeout). */
  setTimer?: (callback: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
};

const IMMEDIATE_COMMAND_PATTERN =
  /^(?:undo|redo|cancel|never\s*mind|scratch\s+that|go\s+back)\b/iu;

const LOWERCASE_CONTINUATION_LEAD =
  /^(?:Called|Named|Labelled|Labeled|Titled|With|And|Between|To|On|In|Next|Below|Above|Under|Over|Beside|Near|Inside|That|Which|Then|Also|For|From|Into|Of|Left|Right)\b/u;

const CONTINUATION_COLOR_SOURCE = String.raw`(?:red|blue|green|yellow|orange|purple|pink|teal|gr[ae]y|black|white|brown)`;

// Fragments that can only continue a command, never stand alone as room talk.
const CONTINUATION_FRAGMENT_PATTERNS: readonly RegExp[] = [
  // Naming: "called Orders", "named the billing service", "labelled API v2".
  /^(?:and\s+)?(?:called|named|labell?ed|titled|with\s+(?:the\s+)?(?:label|name|title|text))\s+\S/iu,
  // Placement: "next to the API", "below the cache", "between the user and the API".
  /^(?:and\s+)?(?:(?:right\s+|just\s+|directly\s+)?(?:next\s+to|beside|below|above|under(?:neath)?|over|on\s+top\s+of|to\s+the\s+(?:left|right)\s+of|left\s+of|right\s+of|between|inside|into|near|in\s+front\s+of|behind|on\s+the\s+(?:left|right)|at\s+the\s+(?:top|bottom))\s+\S)/iu,
  // Styling: "in red", "coloured blue", "red", "and make it blue" is a connective command.
  new RegExp(String.raw`^(?:and\s+)?(?:in\s+|colou?red\s+|filled\s+)?${CONTINUATION_COLOR_SOURCE}$`, "iu"),
  // Connection: "to the API", "from the user to the API".
  /^(?:[Aa]nd\s+)?(?:[Tt]o|[Ff]rom)\s+(?:(?:[Tt]he|[Aa]n?)\s+\S+|\p{Lu}\S*)(?:\s+\S+){0,3}$/u,
];

// Room talk that must never extend a held command, however short.
const NOT_A_CONTINUATION_PATTERN =
  /^(?:nice|great|cool|awesome|perfect|thanks|thank\s+you|cheers|wow|lol|haha|right(?!\s+(?:next|below|above|beside|under|of|between))|exactly|sure|yep|nope|no|yes|yeah|okay|ok|good|fine|got\s+it|makes\s+sense)\b|\b(?:i|you|we|they|he|she|it|that|this|there)\s+(?:am|is|are|was|were|'s|'re|'m|have|has|had|do|does|did|think|know|mean|guess|said|says|can|could|will|would|should)\b|\b(?:honestly|basically|anyway|guys|folks|everyone)\b/iu;

// A held command whose last word leaves it open: "rename it to", "add a box called".
const DANGLING_COMMAND_PATTERN =
  /\b(?:to|called|named|labell?ed|titled|as|between|and|with|from|of|into|next\s+to|below|above|beside)$/iu;

/**
 * True when `text` reads as the continuation of a held command rather than as
 * a sentence of its own: a naming fragment ("called Orders"), a connective
 * command ("and connect it to the API", "then make it red"), a placement
 * ("next to the API", "below the cache"), a colour ("in red"), a connection
 * end ("to the API"), or — when the held command is left open ("rename it
 * to", "add a box called") — a short noun phrase completing it ("Payments").
 */
export function isCommandContinuationUtterance(text: string, heldCommand = ""): boolean {
  const fragment = normalizeBrowserWakeCommand(text).replace(/[\s.!?]+$/u, "").trim();
  if (!fragment || FILLER_ONLY_PATTERN.test(fragment) || wordCount(fragment) > 12) {
    return false;
  }
  if (MEETING_TALK_PATTERN.test(fragment.replace(LABEL_PAYLOAD_PATTERN, "$1"))) {
    return false;
  }
  if (isConnectiveCommandUtterance(fragment)) {
    return true;
  }
  if (NOT_A_CONTINUATION_PATTERN.test(fragment)) {
    return false;
  }
  if (CONTINUATION_FRAGMENT_PATTERNS.some((pattern) => pattern.test(fragment))) {
    return true;
  }
  const held = heldCommand.replace(/[\s,.;:!?]+$/u, "");
  return (
    DANGLING_COMMAND_PATTERN.test(held) &&
    wordCount(fragment) <= 5 &&
    !isCommandShapedUtterance(fragment)
  );
}

/**
 * Holds an addressed command briefly so a continuation spoken after a
 * thinking pause is merged into it instead of being lost:
 *
 *   "Airo, add a database" … "called Orders"  →  "add a database called Orders"
 *
 * The UI must:
 *   - `push` every routed decision;
 *   - `offerContinuation` every final transcript the router did NOT route;
 *   - call `noteSpeechActivity()` on every interim result (and on provider
 *     "speech started" events) — this is what keeps a command held while its
 *     continuation is still being spoken, up to VOICE_COALESCE_MAX_HOLD_MS;
 *   - `setGateOpen` as the palm / hold-to-edit gate opens and closes.
 *
 * Only continuation-shaped text is merged (see isCommandContinuationUtterance),
 * whether it arrives unrouted, through the follow-up window, or through an
 * open gate. A decision that carries its own wake word, an answer, a fresh
 * imperative ("add a cache") or ordinary room talk is never merged: a routed
 * one flushes the held command and starts a new one. Undo / cancel flush
 * immediately.
 */
export class VoiceCommandCoalescer {
  private readonly onFlush: (decision: VoiceRouteDecision, info: VoiceCoalescerFlushInfo) => void;
  private readonly onHold: ((decision: VoiceRouteDecision) => void) | undefined;
  private readonly flushImmediately: ((decision: VoiceRouteDecision) => boolean) | undefined;
  private readonly holdMs: number;
  private readonly activityHoldMs: number;
  private readonly maxHoldMs: number;
  private readonly gateHoldMs: number;
  private readonly trailingGraceMs: number;
  private readonly lateGatedFinalMs: number;
  private readonly now: () => number;
  private readonly setTimer: (callback: () => void, ms: number) => unknown;
  private readonly clearTimer: (handle: unknown) => void;
  private held: VoiceRouteDecision | null = null;
  /** When the held command (or its latest merged continuation) was held. */
  private heldSince = 0;
  private deadline = 0;
  private timer: unknown = null;
  private gateOpen = false;
  /** When the held command was first held (merges do not reset it). */
  private firstHeldAt = 0;
  private mergeCount = 0;
  private lastActivityAt: number | null = null;
  /** What the pending timer means when it fires. */
  private timerReason: VoiceCoalescerFlushReason = "timer";

  constructor(config: VoiceCommandCoalescerConfig) {
    this.onFlush = config.onFlush;
    this.onHold = config.onHold;
    this.flushImmediately = config.flushImmediately;
    this.holdMs = config.holdMs ?? VOICE_COALESCE_HOLD_MS;
    this.activityHoldMs = config.activityHoldMs ?? VOICE_COALESCE_ACTIVITY_HOLD_MS;
    this.maxHoldMs = config.maxHoldMs ?? VOICE_COALESCE_MAX_HOLD_MS;
    this.gateHoldMs = config.gateHoldMs ?? VOICE_COALESCE_GATE_HOLD_MS;
    this.trailingGraceMs = config.trailingGraceMs ?? VOICE_COALESCE_TRAILING_GRACE_MS;
    this.lateGatedFinalMs = Math.max(
      this.trailingGraceMs,
      config.lateGatedFinalMs ?? VOICE_COALESCE_LATE_GATED_FINAL_MS,
    );
    this.now = config.now ?? (() => Date.now());
    this.setTimer =
      config.setTimer ?? ((callback, ms) => globalThis.setTimeout(callback, ms));
    this.clearTimer =
      config.clearTimer ??
      ((handle) => globalThis.clearTimeout(handle as ReturnType<typeof setTimeout>));
  }

  /** The command currently being held, if any. */
  get pending(): VoiceRouteDecision | null {
    return this.held;
  }

  /** Accepts a routed decision; merges it into the held command when it continues it. */
  push(decision: VoiceRouteDecision): void {
    if (this.held && this.continuesHeld(decision)) {
      this.held = mergeDecision(this.held, decision.command, decision.transcript);
      this.mergeCount += 1;
      if (this.isLateGatedFinal(decision)) {
        this.holdForLateGatedFinal();
      } else {
        this.holdFromNow();
      }
      this.notifyHold();
      return;
    }
    this.flushAs("new-command");
    this.held = { ...decision };
    this.firstHeldAt = this.now();
    this.mergeCount = 0;
    this.lastActivityAt = null;
    const command = decision.command.trim();
    if (
      IMMEDIATE_COMMAND_PATTERN.test(command) ||
      (!this.gateOpen &&
        this.flushImmediately !== undefined &&
        !DANGLING_COMMAND_PATTERN.test(command.replace(/[\s,.;:!?]+$/u, "")) &&
        this.flushImmediately(this.held))
    ) {
      this.flushAs("immediate");
      return;
    }
    if (this.isLateGatedFinal(decision)) {
      // The palm already dropped, possibly in a thinking pause before the
      // provider finalized this turn: hold long enough for a resumed
      // continuation's first interim (speech activity then stretches it, as
      // for any held command).
      this.holdForLateGatedFinal();
    } else {
      this.holdFromNow();
    }
    this.notifyHold();
  }

  /**
   * Offers a final transcript the router did not route. Returns true when it
   * was merged into the held command (the caller should then not report it as
   * unaddressed room talk). Only continuation-shaped text is merged.
   */
  offerContinuation(transcript: string): boolean {
    if (!this.held) {
      return false;
    }
    if (classifyBrowserWakeTranscript(transcript).wakeDetected) {
      return false;
    }
    const text = normalizeBrowserWakeCommand(transcript);
    if (!text || FILLER_ONLY_PATTERN.test(text)) {
      return false;
    }
    if (!isCommandContinuationUtterance(text, this.held.command)) {
      // Room talk finalized while the command was held. Whatever speech
      // stretched the hold was this sentence, not a continuation: fall back
      // to the ordinary hold.
      const fallback = this.now() + this.currentHoldMs();
      if (fallback < this.deadline) {
        this.scheduleAt(fallback, "room-talk");
      }
      return false;
    }
    this.held = mergeDecision(this.held, text, transcript);
    this.mergeCount += 1;
    this.holdFromNow();
    this.notifyHold();
    return true;
  }

  /**
   * Reports that speech is being heard (call on every interim result and on
   * provider "speech started" events). While a command is held, keeps it
   * held for at least VOICE_COALESCE_ACTIVITY_HOLD_MS after the latest
   * activity, so a continuation still being spoken can finalize and merge —
   * but never past VOICE_COALESCE_MAX_HOLD_MS from when it was held. No-op
   * when nothing is held.
   *
   * Pass the interim text of a new provider turn when there is one: an
   * interim that carries the wake word is the start of the next command,
   * which is never merged into the held one, so the held command flushes at
   * once instead of waiting. (Leave it out for a late interim of the turn
   * that was just finalized.)
   */
  noteSpeechActivity(interimTranscript?: string): void {
    if (!this.held) {
      return;
    }
    const now = this.now();
    this.lastActivityAt = now;
    if (interimTranscript && this.startsNextCommand(interimTranscript)) {
      this.flushAs("wake-interim");
      return;
    }
    const cap = this.heldSince + Math.max(this.maxHoldMs, this.gateOpen ? this.gateHoldMs : 0);
    const extended = Math.min(now + this.activityHoldMs, cap);
    if (extended > this.deadline) {
      this.scheduleAt(extended, this.timerReason === "gate-drop" ? "gate-drop" : "timer");
    }
  }

  /**
   * Tells the coalescer whether a palm / hold-to-edit gate is open. Opening
   * extends the hold; closing (palm drop) flushes after the trailing grace.
   */
  setGateOpen(open: boolean): void {
    if (open === this.gateOpen) {
      return;
    }
    this.gateOpen = open;
    if (!this.held) {
      return;
    }
    if (open) {
      this.scheduleAt(this.now() + this.gateHoldMs, "timer");
    } else {
      this.scheduleAt(this.now() + this.trailingGraceMs, "gate-drop");
    }
    this.notifyHold();
  }

  /** Emits the held command now. Returns it (or null when nothing was held). */
  flush(): VoiceRouteDecision | null {
    return this.flushAs("explicit");
  }

  /** Drops the held command without emitting it (session teardown). */
  cancel(): void {
    this.cancelTimer();
    this.held = null;
  }

  private flushAs(reason: VoiceCoalescerFlushReason): VoiceRouteDecision | null {
    this.cancelTimer();
    const held = this.held;
    this.held = null;
    if (held) {
      const now = this.now();
      this.onFlush(held, {
        heldMs: Math.max(0, now - this.firstHeldAt),
        merged: this.mergeCount > 0,
        mergeCount: this.mergeCount,
        flushReason: reason,
        lastInterimAgoMs: this.lastActivityAt === null ? null : Math.max(0, now - this.lastActivityAt),
      });
    }
    return held;
  }

  private notifyHold(): void {
    if (this.held && this.onHold) {
      this.onHold({ ...this.held });
    }
  }

  /** A gated final routed through the grace window after the palm dropped. */
  private isLateGatedFinal(decision: VoiceRouteDecision): boolean {
    return (
      !this.gateOpen &&
      (decision.channel === "gated-ptt" || decision.channel === "gated-scoped")
    );
  }

  private holdForLateGatedFinal(): void {
    const now = this.now();
    this.heldSince = now;
    this.scheduleAt(now + this.lateGatedFinalMs, "gate-drop");
  }

  /**
   * An interim that addresses Airo afresh. A decision with its own wake word
   * is never merged into the held command, so waiting longer cannot change
   * what runs; it only delays it.
   */
  private startsNextCommand(interimTranscript: string): boolean {
    // The wake word alone ("Airo …") may open narration about Airo ("Airo is
    // great"), whose final is room talk and leaves the hold in place. Only an
    // interim that already carries a command after the wake word is the next
    // command, the same condition under which its final routes as a new wake
    // decision.
    return classifyBrowserWakeTranscript(interimTranscript).commands.length > 0;
  }

  private continuesHeld(decision: VoiceRouteDecision): boolean {
    const held = this.held;
    if (!held) {
      return false;
    }
    if (decision.channel === "wake" || decision.channel === "answer") {
      return false;
    }
    if (decision.strokeId !== held.strokeId) {
      return false;
    }
    const text = normalizeBrowserWakeCommand(decision.command);
    if (!text) {
      return false;
    }
    if (classifyBrowserWakeTranscript(decision.transcript).wakeDetected) {
      return false;
    }
    if (IMMEDIATE_COMMAND_PATTERN.test(text)) {
      return false;
    }
    // Even through an open palm gate, only continuation-shaped speech merges;
    // anything else is its own gated command.
    return isCommandContinuationUtterance(text, held.command);
  }

  private currentHoldMs(): number {
    return this.gateOpen ? this.gateHoldMs : this.holdMs;
  }

  /** Starts a fresh hold for a newly held or just-merged command. */
  private holdFromNow(): void {
    const now = this.now();
    this.heldSince = now;
    this.scheduleAt(now + this.currentHoldMs(), "timer");
  }

  private scheduleAt(deadline: number, reason: VoiceCoalescerFlushReason): void {
    this.cancelTimer();
    this.deadline = deadline;
    this.timerReason = reason;
    this.timer = this.setTimer(() => {
      this.timer = null;
      this.flushAs(this.timerReason);
    }, Math.max(0, deadline - this.now()));
  }

  private cancelTimer(): void {
    if (this.timer !== null) {
      this.clearTimer(this.timer);
      this.timer = null;
    }
  }
}

function mergeDecision(
  held: VoiceRouteDecision,
  continuation: string,
  continuationTranscript: string,
): VoiceRouteDecision {
  let next = continuation.replace(/^[\s,.:;!?–—-]+/u, "").trim();
  if (LOWERCASE_CONTINUATION_LEAD.test(next)) {
    next = next.charAt(0).toLocaleLowerCase("en-US") + next.slice(1);
  }
  const base = held.command.replace(/[\s,.;:!?]+$/u, "");
  let command = `${base} ${next}`.trim();
  if (held.channel === "gated-scoped") {
    command = normalizeScopedVoiceUtterance(command);
  }
  return {
    ...held,
    command,
    transcript: `${held.transcript} ${continuationTranscript}`.trim(),
  };
}

/**
 * The interim text to pass to VoiceCommandCoalescer.noteSpeechActivity: the
 * transcript for a new provider turn, or undefined for a late interim of the
 * turn that was just finalized (its words are already in the held command, so
 * they only count as activity and never start the next command).
 */
export function coalescerInterimText(
  transcript: string,
  turnIndex: number | undefined,
  lastFinalTurnIndex: number | undefined,
): string | undefined {
  const lateInterim = turnIndex !== undefined && turnIndex === lastFinalTurnIndex;
  return lateInterim ? undefined : transcript;
}
