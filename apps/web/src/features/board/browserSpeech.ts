import { AIRBOARD_SEMANTIC_TRANSCRIPTION_KEYTERMS } from "@airboard/core/semantic-capabilities";

export type BrowserWakeEvent = {
  wakePhrase: string;
  transcript: string;
};

export type BrowserWakeCommandEvent = BrowserWakeEvent & {
  command: string;
};

export type BrowserWakeTranscriptClassification = {
  transcript: string;
  wakeDetected: boolean;
  wakePhrases: string[];
  commands: BrowserWakeCommandEvent[];
};

export type BrowserWakeCommandCallbacks = {
  onWake?: (event: BrowserWakeEvent) => void;
  onCommand: (event: BrowserWakeCommandEvent) => void;
};

export type BrowserWakeCommandRouter = {
  consumeFinalTranscript(transcript: string): void;
  reset(): void;
};

export const AIRBOARD_TRANSCRIPTION_KEYTERMS = [
  "Airo",
  "Airboard",
  "Hey Airo",
  "Airo add a circle here",
  "Airo add a user here",
  "Airo connect User to API",
  "Airo confirm",
  "Airo cancel",
  "add a circle here",
  "add a user here",
  "add an API here",
  "add a database here",
  "add a service here",
  "add a queue here",
  "connect User to API",
  ...AIRBOARD_SEMANTIC_TRANSCRIPTION_KEYTERMS,
  "connector",
  "rectangle",
] as const;

export function extractBrowserWakeCommands(transcript: string): BrowserWakeCommandEvent[] {
  return classifyBrowserWakeTranscript(transcript).commands;
}

/**
 * Routes finalized transcripts from the realtime speech provider through
 * Airboard's wake-word semantics. A wake-only turn arms the immediately
 * following finalized turn, which lets users pause after “Airo”.
 */
/**
 * How long a bare "Airo" stays armed before it is dropped. Without this cap a
 * wake-only turn would arm the router indefinitely, so an unrelated later
 * sentence (e.g. a coworker speaking minutes later) could execute as a command.
 */
export const WAKE_PENDING_MAX_AGE_MS = 10_000;

export function createBrowserWakeCommandRouter(
  callbacks: BrowserWakeCommandCallbacks,
  options: { now?: () => number } = {},
): BrowserWakeCommandRouter {
  const now = options.now ?? (() => Date.now());
  let pendingWake: BrowserWakeEvent | null = null;
  // Timestamp of the original wake, preserved across non-command carryover turns
  // so the expiry window is measured from the wake, not from the latest turn.
  let pendingWakeArmedAt = 0;

  const emitCommand = (wake: BrowserWakeEvent, transcript: string, armedAt: number) => {
    const command = normalizeBrowserWakeCommand(transcript);
    if (!command) {
      pendingWake = wake;
      pendingWakeArmedAt = armedAt;
      return;
    }
    pendingWake = null;
    callbacks.onCommand({ ...wake, command });
  };

  // Return the armed wake only if it has not expired; drop it otherwise.
  const takeFreshPendingWake = (): BrowserWakeEvent | null => {
    if (!pendingWake) {
      return null;
    }
    if (now() - pendingWakeArmedAt > WAKE_PENDING_MAX_AGE_MS) {
      pendingWake = null;
      return null;
    }
    return pendingWake;
  };

  return {
    consumeFinalTranscript: (transcript) => {
      const wakeMatches = findWakePhrases(transcript);
      if (wakeMatches.length === 0) {
        const wake = takeFreshPendingWake();
        if (wake) {
          emitCommand(wake, transcript, pendingWakeArmedAt);
        }
        return;
      }

      const firstWake = wakeMatches[0];
      const carriedWake = takeFreshPendingWake();
      if (carriedWake && firstWake) {
        const commandBeforeWake = transcript.slice(0, firstWake.index);
        const beforeWake = normalizeBrowserWakeCommand(commandBeforeWake);
        // Text before an in-sentence wake ("and now Airo …", "thanks Airo …")
        // is only a command for the carried wake when it reads as one.
        if (beforeWake && !isWakeLeadInOnly(beforeWake)) {
          emitCommand(carriedWake, commandBeforeWake, pendingWakeArmedAt);
        } else {
          pendingWake = null;
        }
      } else {
        pendingWake = null;
      }

      for (let index = 0; index < wakeMatches.length; index += 1) {
        const wake = wakeMatches[index];
        if (!wake) {
          continue;
        }
        const event = { wakePhrase: wake.wakePhrase, transcript };
        callbacks.onWake?.(event);
        const nextWake = wakeMatches[index + 1];
        emitCommand(
          event,
          transcript.slice(wake.end, nextWake?.index ?? transcript.length),
          now(),
        );
      }
    },
    reset: () => {
      pendingWake = null;
    },
  };
}

const WAKE_LEAD_IN_ONLY_PATTERN =
  /^(?:(?:hey(?:\s+there)?|hi|hello|okay|ok|please|uh|um|erm|ah|well|so|alright|right|and|now|then|next|also|thanks|thank\s+you|cheers)(?:[\s,.:;!?\u2013\u2014-]+|$))+$/iu;

function isWakeLeadInOnly(text: string): boolean {
  return WAKE_LEAD_IN_ONLY_PATTERN.test(text);
}

/**
 * Classifies a final browser transcript without mutating a speech session.
 *
 * Chrome commonly renders the intended "Airo" wake word as "Aero", "Airoh",
 * "Air row", or "Arrow". "Arrow" is deliberately accepted only at the start
 * of a transcript (optionally after "Hey") and only when a command follows, so
 * ordinary diagram requests such as "draw an arrow here" and narration such as
 * "arrow keys are broken" do not activate the assistant. "Aero" and "Airboard"
 * likewise need a request after them: a command, a polite request ("Aero, can
 * you add a database", "Arrow please add…", "Aero, I need a cache"), or — for
 * "Aero" / "Airboard" followed by a vocative comma or pause — a narrated
 * request ("Airboard, users sign in through auth"). "Airo" itself is accepted
 * at the start of a turn or sentence. Mid-sentence, a wake word counts only in
 * address position — after a connective or lead-in ("and now Airo add…",
 * "thanks Airo add…", "so as I was saying airo add…") or a vocative comma — and
 * only when a request immediately follows. Narration about Airo ("I told the
 * team Airo can add a database", "did you see Airo delete the database") is
 * never a command.
 */
export function classifyBrowserWakeTranscript(
  transcript: string,
): BrowserWakeTranscriptClassification {
  const matches = findWakePhrases(transcript);
  const commands: BrowserWakeCommandEvent[] = [];
  for (let index = 0; index < matches.length; index += 1) {
    const wake = matches[index];
    if (!wake) {
      continue;
    }
    const nextWake = matches[index + 1];
    const command = normalizeBrowserWakeCommand(
      transcript.slice(wake.end, nextWake?.index ?? transcript.length),
    );
    if (command) {
      commands.push({ wakePhrase: wake.wakePhrase, transcript, command });
    }
  }
  return {
    transcript,
    wakeDetected: matches.length > 0,
    wakePhrases: matches.map(({ wakePhrase }) => wakePhrase),
    commands,
  };
}

type WakePhraseMatch = {
  wakePhrase: string;
  index: number;
  end: number;
};

const WAKE_PHRASE_PATTERN =
  /\b(?:air\s*board|air[\s-]+row|air[\s-]+oh|air[\s-]+o|airoh|airo|aero)\b/giu;

// "Arrow" is a common Chrome rendering of "Airo", but it is also an ordinary
// diagram word. It is only considered at the very start of a turn (optionally
// after a greeting such as "Hey"), and only when a command follows.
const PREFIX_ARROW_PATTERN = /^\s*(?:(?:hey|hi|hello|okay|ok)[\s,.:;!?\u2013\u2014-]+)*(arrow)\b/iu;

// A brand mention inside a diagram narrative is content, not activation.
// Accept wake phrases where a person would address Airo: at the beginning of
// a finalized turn, after a sentence boundary, or after a short conversational
// lead-in such as "Hey," or "Please". Once explicitly addressed, a second
// non-canonical ASR variant may still delimit an unpunctuated follow-up command
// (legacy Chrome behavior). Canonical "Airboard" always requires address
// position so labels such as "Airboard page" cannot split a semantic request.
const WAKE_ADDRESS_LEAD_IN_PATTERN =
  /^\s*(?:(?:hey(?:\s+there)?|hi|hello|okay|ok|please|uh|um|erm|ah|well|so|alright|right)(?:[\s,.:;!?\u2013\u2014-]+|$))*$/iu;

/**
 * Imperative board verbs. An utterance that starts with one of these (after
 * fillers and an optional connective such as "and" / "then" / "now") is
 * "command-shaped": it reads as an instruction to the board rather than as
 * narration. Used for mid-sentence wakes, mishearing-prefixed wakes, the
 * post-command follow-up window, and continuation merging.
 */
const BOARD_COMMAND_VERB_SOURCE = String.raw`(?:add|create|draw|put|place|insert|connect|link|join|attach|delete|remove|erase|rename|relabel|call|name|label|make|change|turn|convert|move|shift|group|ungroup|align|arrange|distribute|lay\s+(?:out|them|it|these)|layout|undo|redo|zoom|focus|fit|show|hide|duplicate|copy|color|colour|paint|fill|resize|swap|replace|select|clear)`;

const COMMAND_FILLER_SOURCE = String.raw`(?:(?:uh|um|erm|ah|hmm|okay|ok|alright|right|so|please)(?:[\s,.:;!?\u2013\u2014-]+))*`;
const COMMAND_CONNECTIVE_SOURCE = String.raw`(?:(?:and\s+then|and\s+now|and\s+also|and|also|then|now|next)(?:[\s,.:;!?\u2013\u2014-]+)(?:please[\s,]+)?)?`;

const COMMAND_SHAPED_PATTERN = new RegExp(
  String.raw`^\s*${COMMAND_FILLER_SOURCE}${COMMAND_CONNECTIVE_SOURCE}${BOARD_COMMAND_VERB_SOURCE}\b`,
  "iu",
);

const CONNECTIVE_COMMAND_PATTERN = new RegExp(
  String.raw`^\s*${COMMAND_FILLER_SOURCE}(?:and\s+then|and\s+now|and\s+also|and|also|then)(?:[\s,.:;!?\u2013\u2014-]+)(?:please[\s,]+)?${BOARD_COMMAND_VERB_SOURCE}\b`,
  "iu",
);

// Idioms that start with a board verb but are ordinary talk, and verbs used
// as nouns ("undo is broken", "zoom doesn't work").
const COMMAND_SHAPED_IDIOM_PATTERN = new RegExp(
  String.raw`^\s*${COMMAND_FILLER_SOURCE}${COMMAND_CONNECTIVE_SOURCE}(?:${BOARD_COMMAND_VERB_SOURCE}\s+(?:is|was|are|were|isn't|wasn't|doesn't|didn't|works?|worked|button|buttons|feature|key|keys|shortcut)\b|make\s+sure|make\s+(?:an?|the)\s+end\b|make\s+a\s+note\s+(?:that|of|to)|draw\s+a\s+line\s+under|move\s+on|show\s+you|call\s+(?:me|him|her|us|them|you|back|it\s+a\s+(?:day|night|wrap)|it\s+(?:done|quits|even|good))|turn\s+(?:up|down)\b(?!\s+the\s+(?:size|width|height)))\b`,
  "iu",
);

const REFERENCE_ANSWER_PATTERN =
  /^(?:(?:uh|um|erm|ah|oh|okay|ok|so|yes|yeah|no|sorry)[\s,.]+)*(?:(?:the|that|this)\s+(?:[\p{L}\p{N}'-]+\s+){0,3}one|(?:the\s+)?(?:first|second|third|fourth|fifth|last|top|bottom|left|right|left-most|right-most|other|new|old|newest|oldest)(?:\s+one)?|both(?:\s+of\s+them)?|neither|number\s+[\p{L}\p{N}]+)(?:\s+please)?$/iu;

/**
 * True when an utterance reads as an instruction to the board: it starts with
 * an imperative board verb ("add a cache", "rename it to Orders"), optionally
 * after fillers and a connective ("and connect it to the API", "now delete
 * that"). Narrative talk ("the arrow keys are broken", "so the user hits the
 * API") is not command-shaped. ASR punctuation is ignored.
 */
export function isCommandShapedUtterance(utterance: string): boolean {
  const text = utterance.normalize("NFKC");
  return COMMAND_SHAPED_PATTERN.test(text) && !COMMAND_SHAPED_IDIOM_PATTERN.test(text);
}

/** True when a command-shaped utterance opens with a connective ("and connect…"). */
export function isConnectiveCommandUtterance(utterance: string): boolean {
  const text = utterance.normalize("NFKC");
  return CONNECTIVE_COMMAND_PATTERN.test(text) && !COMMAND_SHAPED_IDIOM_PATTERN.test(text);
}

const POLITE_ASK_LEAD_IN_PATTERN = new RegExp(
  String.raw`^\s*${COMMAND_FILLER_SOURCE}(?:(?:and|also|then|now)[\s,]+)?(?:(?:can|could|would|will)\s+you(?:\s+(?:please|also|just|now))*|please(?:\s+(?:also|just|now))*)(?:[\s,.:;!?\u2013\u2014-]+|$)`,
  "iu",
);

const WANT_REQUEST_LEAD_IN_PATTERN = new RegExp(
  String.raw`^\s*${COMMAND_FILLER_SOURCE}(?:i|we)(?:'d\s+like|\s+(?:really\s+|also\s+|just\s+)?(?:want|need|would\s+like))(?:\s+(?:you\s+)?to)?(?:[\s,]+)`,
  "iu",
);

const REQUESTED_OBJECT_PATTERN =
  /^(?:a|an|another|one|two|three|four|five|some|the|more)\s+\S/iu;

function normalizeApostrophes(text: string): string {
  return text.normalize("NFKC").replace(/[\u2018\u2019\u02bc]/gu, "'");
}

/**
 * Removes a polite ask ("can you", "could you please", "please also") from
 * the start of an utterance so the board command behind it can be tested.
 * Returns the utterance unchanged when it has no such lead-in.
 */
export function stripPoliteCommandLeadIn(utterance: string): string {
  const text = normalizeApostrophes(utterance);
  const match = POLITE_ASK_LEAD_IN_PATTERN.exec(text);
  return match ? text.slice(match[0].length).trim() : text.trim();
}

/**
 * True when an utterance spoken right after a wake word is a request to the
 * board: command-shaped ("add a cache"), a polite ask in front of a command
 * ("can you add a database", "could you please connect it"), or a stated want
 * ("I need a cache in front of the API", "we'd like to add a queue").
 */
export function isAddressedRequestUtterance(utterance: string): boolean {
  const text = normalizeApostrophes(utterance).trim();
  if (isCommandShapedUtterance(text)) {
    return true;
  }
  const polite = POLITE_ASK_LEAD_IN_PATTERN.exec(text);
  if (polite) {
    const rest = text.slice(polite[0].length).trim();
    if (rest && isCommandShapedUtterance(rest)) {
      return true;
    }
  }
  const want = WANT_REQUEST_LEAD_IN_PATTERN.exec(text);
  if (want) {
    const rest = text.slice(want[0].length).trim();
    return isCommandShapedUtterance(rest) || REQUESTED_OBJECT_PATTERN.test(rest);
  }
  return false;
}

/**
 * True for a short spoken answer that picks out a board element, such as
 * "the billing one", "the second one", "that one" or "the last". These carry
 * no verb, so they only route while a follow-up or answer window is open.
 */
export function isReferenceAnswerUtterance(utterance: string): boolean {
  const text = utterance
    .normalize("NFKC")
    .replace(/[\s,.;:!?]+$/u, "")
    .replace(/^[\s,.;:!?]+/u, "")
    .trim();
  if (!text || text.split(/\s+/u).length > 7) {
    return false;
  }
  return REFERENCE_ANSWER_PATTERN.test(text);
}

function findWakePhrases(transcript: string): WakePhraseMatch[] {
  const matches: WakePhraseMatch[] = [];
  const arrowPrefix = PREFIX_ARROW_PATTERN.exec(transcript);
  const arrowWakePhrase = arrowPrefix?.[1];
  if (arrowPrefix && arrowWakePhrase) {
    const index = arrowPrefix[0].lastIndexOf(arrowWakePhrase);
    const end = index + arrowWakePhrase.length;
    if (isAddressedRemainder(transcript.slice(end), false)) {
      matches.push({ wakePhrase: arrowWakePhrase, index, end });
    }
  }
  for (const match of transcript.matchAll(WAKE_PHRASE_PATTERN)) {
    if (match.index === undefined) {
      continue;
    }
    const wakePhrase = match[0];
    const index = match.index;
    const end = index + wakePhrase.length;
    const canonicalAirboard = isCanonicalAirboardWake(wakePhrase);
    const followsAcceptedWake = matches.length > 0 && !canonicalAirboard;
    const addressPosition = isWakeAddressPosition(transcript, index);
    const remainder = transcript.slice(end);
    // Mid-sentence, a wake word addresses Airo only after a connective /
    // lead-in ("and now", "thanks", "so as I was saying") or a vocative comma,
    // and only when a request immediately follows. After a subject or verb
    // ("I told Airo…", "watch Airo draw…", "Airo can add…") it is narration.
    if (isWakeAsSubject(remainder)) {
      // "Airo can add a database for us", "Airo is part of the demo": Airo is
      // the subject of the sentence, not the one being addressed.
      continue;
    }
    const midSentenceAddress =
      !addressPosition &&
      isMidSentenceAddressPosition(transcript, index, end) &&
      isAddressedRequestUtterance(normalizeBrowserWakeCommand(remainder));
    let accepted: boolean;
    if (isMishearingWake(wakePhrase)) {
      // "Aero…" / "Airboard…" are also real words and product names. They
      // count as addressing Airo only when a request follows (or the turn is
      // the bare word, which arms the next sentence).
      accepted =
        (addressPosition && isAddressedRemainder(remainder, true)) ||
        (followsAcceptedWake && !canonicalAirboard) ||
        (!canonicalAirboard && midSentenceAddress);
    } else {
      // "Airo" itself: accepted at the start of a turn / sentence, or in
      // mid-sentence address position when a request follows.
      accepted = addressPosition || followsAcceptedWake || midSentenceAddress;
    }
    if (!accepted) {
      continue;
    }
    matches.push({ wakePhrase, index, end });
  }
  return matches.sort((left, right) => left.index - right.index);
}

function isMishearingWake(wakePhrase: string): boolean {
  return /^(?:aero|air\s*board)$/iu.test(wakePhrase);
}

/**
 * A wake remainder that is empty (bare wake), a request (command-shaped or a
 * polite / "I need…" ask) or — when `allowVocativePause` — any multi-word
 * narration separated from the wake word by a comma or pause ("Aero, users
 * sign in through the auth service").
 */
function isAddressedRemainder(remainder: string, allowVocativePause: boolean): boolean {
  const normalized = normalizeBrowserWakeCommand(remainder).replace(/[\s.!?]+$/u, "");
  if (normalized === "" || isAddressedRequestUtterance(normalized)) {
    return true;
  }
  return (
    allowVocativePause &&
    /^\s*[,.:;!?\u2013\u2014-]/u.test(remainder) &&
    normalized.split(/\s+/u).length >= 2
  );
}

// A wake word directly followed (no vocative comma) by a verb or modal that
// takes it as the subject: "Airo can…", "Airo will…", "Airo is…". "Airo can
// you…" is still a question addressed to Airo.
const WAKE_AS_SUBJECT_PATTERN =
  /^\s+(?:can|could|will|would|should|might|may|must|shall|is|was|isn't|wasn't|does|doesn't|did|didn't|has|hasn't|had|just|already|really|never|always|keeps|seems|works|handles|knows|thinks|said|says|told|went|got|gets|made|added|drew|deleted|created)\b(?!\s+(?:you|u)\b)/iu;

function isWakeAsSubject(remainder: string): boolean {
  return WAKE_AS_SUBJECT_PATTERN.test(normalizeApostrophes(remainder));
}

// Words that put an in-sentence wake word in address position: connectives,
// acknowledgements and discourse lead-ins, directly before the wake word.
const MID_SENTENCE_WAKE_LEAD_IN_PATTERN =
  /(?:^|[\s,.:;!?\u2013\u2014-])(?:and|now|then|next|also|okay|ok|so|alright|right|well|anyway|thanks|thank\s+you|cheers|great|perfect|cool|nice|hey|hi|hello|please|as\s+i\s+was\s+saying|um|uh|erm)[\s,.:;!?\u2013\u2014-]*$/iu;

function isMidSentenceAddressPosition(transcript: string, index: number, end: number): boolean {
  const before = transcript.slice(0, index);
  if (/,\s*$/u.test(before) || /^\s*,/u.test(transcript.slice(end))) {
    // Vocative comma: "…, Airo add…" / "thanks Airo, add…".
    return true;
  }
  return MID_SENTENCE_WAKE_LEAD_IN_PATTERN.test(before);
}

function isCanonicalAirboardWake(wakePhrase: string): boolean {
  return /^air\s*board$/iu.test(wakePhrase);
}

function isWakeAddressPosition(transcript: string, index: number): boolean {
  const before = transcript.slice(0, index);
  const boundaryIndex = Math.max(
    before.lastIndexOf("."),
    before.lastIndexOf("!"),
    before.lastIndexOf("?"),
    before.lastIndexOf("\n"),
    before.lastIndexOf("\r"),
  );
  return WAKE_ADDRESS_LEAD_IN_PATTERN.test(before.slice(boundaryIndex + 1));
}

const MISHEARD_CREATE_PREFIX =
  /^and(?=\s+(?:(?:a|an|one|two|three|four|five|six|seven|eight|nine|ten|\d+)\b))/iu;

/**
 * Repairs a narrow set of recognition-only command errors after a wake word.
 * Chrome commonly hears "add a ..." as "and a ...". The repair is limited to
 * an explicitly activated create-shaped phrase, so normal typed commands and
 * ordinary uses of "and" keep their deterministic behavior.
 */
export function normalizeBrowserWakeCommand(command: string): string {
  const trimmed = command
    .replace(/^[\s,.:;!?\u2013\u2014-]+/u, "")
    .replace(/[\s,;]+$/u, "")
    .trim();
  return trimmed.replace(MISHEARD_CREATE_PREFIX, "add");
}

/**
 * Rewrites the natural phrasings a user says while holding an element
 * ("rename to Payments", "delete it", "connect to the database") into the
 * deterministic selection-targeted grammar. Utterances outside the scoped edit
 * vocabulary pass through unchanged so the full grammar and semantic fallback
 * stay available. Label text keeps its original casing.
 */
export function normalizeScopedVoiceUtterance(utterance: string): string {
  let trimmed = utterance
    .replace(/^[\s,.:;!?–—-]+/u, "")
    .replace(/[\s,.;!?]+$/u, "")
    .trim();
  for (let pass = 0; pass < 8; pass += 1) {
    const next = trimmed
      .replace(
        /^(?:(?:uh|um|erm|ah|hmm|well|so|okay|ok|alright|right|please)(?:[\s,.:;!?–—-]+|$)|(?:can|could|would)\s+you(?:[\s,.:;!?–—-]+|$))/iu,
        "",
      )
      .trim();
    if (next === trimmed) break;
    trimmed = next;
  }
  if (!trimmed) {
    return utterance;
  }

  const pronoun = String.raw`(?:it|this|that|this\s+one)`;

  const rename = new RegExp(
    String.raw`^(?:rename|relabel)(?:\s+${pronoun})?\s+(?:to|as)\s+(.+)$`,
    "iu",
  ).exec(trimmed);
  if (rename?.[1]) {
    return `rename selected to ${rename[1]}`;
  }

  const callIt = new RegExp(
    String.raw`^(?:call|name|label)\s+${pronoun}\s+(.+)$`,
    "iu",
  ).exec(trimmed);
  if (callIt?.[1]) {
    return `rename selected to ${callIt[1].replace(/^(?:to|as)\s+/iu, "")}`;
  }

  if (new RegExp(String.raw`^(?:delete|remove)(?:\s+${pronoun})?$`, "iu").test(trimmed)) {
    return "delete selected";
  }

  if (new RegExp(String.raw`^(?:duplicate|copy)(?:\s+${pronoun})?$`, "iu").test(trimmed)) {
    return "duplicate selected";
  }

  const move = new RegExp(
    String.raw`^move(?:\s+${pronoun})?\s+(?:to\s+the\s+|the\s+)?(left|right|up|down|above|below)$`,
    "iu",
  ).exec(trimmed);
  if (move?.[1]) {
    return `move selected ${move[1].toLocaleLowerCase("en-US")}`;
  }

  const resizeAdjective = new RegExp(
    String.raw`^make(?:\s+${pronoun})?\s+(?:a\s+(?:bit|little)\s+|much\s+)?(bigger|larger|smaller|wider|narrower|taller|shorter)$`,
    "iu",
  ).exec(trimmed);
  if (resizeAdjective?.[1]) {
    return `make selected ${resizeAdjective[1].toLocaleLowerCase("en-US")}`;
  }

  const resizeDimension = new RegExp(
    String.raw`^(reduce|decrease|shrink|increase|grow|expand)\s+(?:the\s+|its\s+)?(height|width|size)$`,
    "iu",
  ).exec(trimmed);
  if (resizeDimension?.[1] && resizeDimension[2]) {
    return `${resizeDimension[1].toLocaleLowerCase("en-US")} the ${resizeDimension[2].toLocaleLowerCase("en-US")} of selected`;
  }

  const colorNames =
    "red|blue|green|yellow|orange|purple|pink|teal|gray|grey|black|white|brown";
  const recolorShort = new RegExp(
    String.raw`^(?:make|color|colour|paint|fill)\s+${pronoun}\s+(?:in\s+)?(${colorNames})$`,
    "iu",
  ).exec(trimmed);
  if (recolorShort?.[1]) {
    return `make selected ${recolorShort[1].toLocaleLowerCase("en-US")}`;
  }
  const recolorChange = new RegExp(
    String.raw`^(?:change|set)\s+(?:the\s+|its\s+)?(?:color|colour|fill)\s+to\s+(${colorNames})$`,
    "iu",
  ).exec(trimmed);
  if (recolorChange?.[1]) {
    return `make selected ${recolorChange[1].toLocaleLowerCase("en-US")}`;
  }

  const connect = new RegExp(
    String.raw`^connect(?:\s+${pronoun})?\s+to\s+(.+)$`,
    "iu",
  ).exec(trimmed);
  if (connect?.[1]) {
    // "this" grounds against the held/hovered element in the interaction layer.
    return `connect this to ${connect[1]}`;
  }

  return trimmed;
}
