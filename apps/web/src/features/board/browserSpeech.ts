import { AIRBOARD_SEMANTIC_TRANSCRIPTION_KEYTERMS } from "@airboard/core/semantic-capabilities";

export type BrowserSpeechCallbacks = {
  onStart?: () => void;
  onInterim?: (transcript: string) => void;
  onFinal: (transcript: string) => void;
  onEnd?: () => void;
  onError?: (message: string) => void;
};

export type BrowserSpeechSession = {
  start(): void;
  stop(): void;
  abort(): void;
};

export type BrowserSpeechHeardEvent = {
  transcript: string;
  isFinal: boolean;
};

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

export type BrowserWakeSpeechEndReason = "stopped" | "aborted" | "error";

export type BrowserWakeSpeechCallbacks = {
  onStart?: () => void;
  onListening?: (listening: boolean) => void;
  onHeard?: (event: BrowserSpeechHeardEvent) => void;
  onInterim?: (transcript: string) => void;
  onWake?: (event: BrowserWakeEvent) => void;
  onCommand: (event: BrowserWakeCommandEvent) => void;
  onError?: (message: string, code?: string) => void;
  onEnd?: (reason: BrowserWakeSpeechEndReason) => void;
};

export type BrowserWakeSpeechOptions = {
  language?: string;
  restartDelayMs?: number;
};

export type BrowserWakeSpeechSession = BrowserSpeechSession & {
  isListening(): boolean;
};

export type BrowserWakeCommandRouter = {
  consumeFinalTranscript(transcript: string): void;
  reset(): void;
};

export type AirboardVoiceCommandRecovery = {
  command: string;
  objectType: string;
  basis: "constrained_asr_alias";
};

export const BROWSER_SPEECH_WAKE_PHRASES = [
  "Airo",
  "Airoh",
  "Aero",
  "Air O",
  "Air Oh",
  "Air Row",
  "Airboard",
  "Air board",
  "Arrow",
] as const;

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

type SpeechResultLike = {
  isFinal: boolean;
  0?: { transcript?: string };
};

type SpeechResultListLike = {
  length: number;
  [index: number]: SpeechResultLike | undefined;
};

type SpeechRecognitionEventLike = Event & {
  resultIndex?: number;
  results?: SpeechResultListLike;
};

type SpeechRecognitionErrorEventLike = Event & {
  error?: string;
  message?: string;
};

type SpeechRecognitionLike = {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  maxAlternatives: number;
  onstart: (() => void) | null;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: ((event: SpeechRecognitionErrorEventLike) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
};

type SpeechRecognitionConstructor = new () => SpeechRecognitionLike;

type SpeechWindow = Window & {
  SpeechRecognition?: SpeechRecognitionConstructor;
  webkitSpeechRecognition?: SpeechRecognitionConstructor;
};

export function supportsBrowserSpeech(): boolean {
  if (typeof window === "undefined") {
    return false;
  }
  const speechWindow = window as SpeechWindow;
  return Boolean(speechWindow.SpeechRecognition ?? speechWindow.webkitSpeechRecognition);
}

export function createBrowserSpeechSession(
  callbacks: BrowserSpeechCallbacks,
  language = "en-US",
): BrowserSpeechSession | null {
  if (typeof window === "undefined") {
    return null;
  }

  const speechWindow = window as SpeechWindow;
  const Recognition = speechWindow.SpeechRecognition ?? speechWindow.webkitSpeechRecognition;
  if (!Recognition) {
    return null;
  }

  const recognition = new Recognition();
  recognition.continuous = false;
  recognition.interimResults = true;
  recognition.lang = language;
  recognition.maxAlternatives = 1;
  recognition.onstart = () => callbacks.onStart?.();
  recognition.onresult = (event) => {
    const results = event.results;
    if (!results) {
      return;
    }

    let interim = "";
    let final = "";
    const startIndex = event.resultIndex ?? 0;
    for (let index = startIndex; index < results.length; index += 1) {
      const result = results[index];
      if (!result) {
        continue;
      }
      const transcript = result?.[0]?.transcript?.trim();
      if (!transcript) {
        continue;
      }
      if (result.isFinal) {
        final = `${final} ${transcript}`.trim();
      } else {
        interim = `${interim} ${transcript}`.trim();
      }
    }

    if (interim) {
      callbacks.onInterim?.(interim);
    }
    if (final) {
      callbacks.onFinal(final);
    }
  };
  recognition.onerror = (event) => {
    callbacks.onError?.(describeSpeechError(event.error, event.message));
  };
  recognition.onend = () => callbacks.onEnd?.();

  return {
    start: () => recognition.start(),
    stop: () => recognition.stop(),
    abort: () => recognition.abort(),
  };
}

/**
 * Creates a long-lived speech session that only emits commands introduced by
 * an Airboard wake phrase. Browser speech engines routinely end recognition
 * after a period of silence, so the session restarts those normal endings
 * until its caller explicitly stops or aborts it.
 */
export function createBrowserWakeSpeechSession(
  callbacks: BrowserWakeSpeechCallbacks,
  options: BrowserWakeSpeechOptions = {},
): BrowserWakeSpeechSession | null {
  if (typeof window === "undefined") {
    return null;
  }

  const speechWindow = window as SpeechWindow;
  const Recognition = speechWindow.SpeechRecognition ?? speechWindow.webkitSpeechRecognition;
  if (!Recognition) {
    return null;
  }

  const recognition = new Recognition();
  const restartDelayMs = Math.max(0, options.restartDelayMs ?? 250);
  recognition.continuous = true;
  recognition.interimResults = true;
  recognition.lang = options.language ?? "en-US";
  recognition.maxAlternatives = 1;

  let wantsRecognition = false;
  let listening = false;
  let startReported = false;
  let endReported = false;
  let requestedEnd: BrowserWakeSpeechEndReason | null = null;
  let restartTimer: ReturnType<typeof setTimeout> | null = null;
  const commandRouter = createBrowserWakeCommandRouter(callbacks);

  const setListening = (nextListening: boolean) => {
    if (listening === nextListening) {
      return;
    }
    listening = nextListening;
    callbacks.onListening?.(nextListening);
  };

  const clearRestart = () => {
    if (restartTimer !== null) {
      clearTimeout(restartTimer);
      restartTimer = null;
    }
  };

  const reportEnd = (reason: BrowserWakeSpeechEndReason) => {
    if (endReported) {
      return;
    }
    endReported = true;
    setListening(false);
    callbacks.onEnd?.(reason);
  };

  const failSession = (message: string, code?: string) => {
    wantsRecognition = false;
    requestedEnd = "error";
    clearRestart();
    callbacks.onError?.(message, code);
    if (!listening) {
      reportEnd("error");
    }
  };

  const startRecognition = () => {
    if (!wantsRecognition) {
      return;
    }
    try {
      recognition.start();
    } catch (error) {
      if (isRecognitionAlreadyStartedError(error)) {
        return;
      }
      failSession(
        error instanceof Error
          ? error.message
          : "Speech recognition could not be restarted.",
      );
    }
  };

  const scheduleRestart = () => {
    if (!wantsRecognition || restartTimer !== null) {
      return;
    }
    restartTimer = setTimeout(() => {
      restartTimer = null;
      startRecognition();
    }, restartDelayMs);
  };

  recognition.onstart = () => {
    if (!wantsRecognition) {
      try {
        recognition.abort();
      } catch {
        reportEnd(requestedEnd ?? "aborted");
      }
      return;
    }
    clearRestart();
    setListening(true);
    if (!startReported) {
      startReported = true;
      callbacks.onStart?.();
    }
  };

  recognition.onresult = (event) => {
    const transcripts = collectSpeechTranscripts(event);
    if (transcripts.interim) {
      callbacks.onHeard?.({ transcript: transcripts.interim, isFinal: false });
      callbacks.onInterim?.(transcripts.interim);
    }
    if (transcripts.final) {
      callbacks.onHeard?.({ transcript: transcripts.final, isFinal: true });
      commandRouter.consumeFinalTranscript(transcripts.final);
    }
  };

  recognition.onerror = (event) => {
    if (event.error === "aborted" && requestedEnd === "aborted") {
      return;
    }

    const message = describeContinuousSpeechError(event.error, event.message);
    callbacks.onError?.(message, event.error);
    if (isFatalSpeechError(event.error)) {
      wantsRecognition = false;
      requestedEnd = "error";
      clearRestart();
    }
  };

  recognition.onend = () => {
    setListening(false);
    if (wantsRecognition) {
      scheduleRestart();
      return;
    }
    reportEnd(requestedEnd ?? "error");
  };

  const requestEnd = (reason: Exclude<BrowserWakeSpeechEndReason, "error">) => {
    const wasActive = wantsRecognition || listening || restartTimer !== null;
    wantsRecognition = false;
    requestedEnd = reason;
    commandRouter.reset();
    clearRestart();
    if (!wasActive) {
      reportEnd(reason);
      return;
    }
    try {
      if (reason === "aborted") {
        recognition.abort();
      } else {
        recognition.stop();
      }
    } catch {
      reportEnd(reason);
    }
  };

  return {
    start: () => {
      if (wantsRecognition) {
        return;
      }
      wantsRecognition = true;
      requestedEnd = null;
      startReported = false;
      endReported = false;
      commandRouter.reset();
      clearRestart();
      startRecognition();
    },
    stop: () => requestEnd("stopped"),
    abort: () => requestEnd("aborted"),
    isListening: () => listening,
  };
}

export function extractBrowserWakeCommands(transcript: string): BrowserWakeCommandEvent[] {
  return classifyBrowserWakeTranscript(transcript).commands;
}

/**
 * Routes finalized transcripts from any realtime speech provider through the
 * same wake-word semantics as the browser fallback. A wake-only turn arms the
 * immediately following finalized turn, which lets users pause after “Airo”.
 */
/**
 * How long a bare "Airo" stays armed before it is dropped. Without this cap a
 * wake-only turn would arm the router indefinitely, so an unrelated later
 * sentence (e.g. a coworker speaking minutes later) could execute as a command.
 */
export const WAKE_PENDING_MAX_AGE_MS = 10_000;

export function createBrowserWakeCommandRouter(
  callbacks: Pick<BrowserWakeSpeechCallbacks, "onWake" | "onCommand">,
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
        if (normalizeBrowserWakeCommand(commandBeforeWake)) {
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

/**
 * Classifies a final browser transcript without mutating a speech session.
 *
 * Chrome commonly renders the intended "Airo" wake word as "Aero", "Airoh",
 * "Air row", or "Arrow". "Arrow" is deliberately accepted only at the start
 * of a transcript so ordinary diagram requests such as "draw an arrow here"
 * do not accidentally activate the assistant.
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

const PREFIX_ARROW_PATTERN = /^\s*(arrow)\b/iu;

function findWakePhrases(transcript: string): WakePhraseMatch[] {
  const matches: WakePhraseMatch[] = [];
  const arrowPrefix = PREFIX_ARROW_PATTERN.exec(transcript);
  const arrowWakePhrase = arrowPrefix?.[1];
  if (arrowPrefix && arrowWakePhrase) {
    const index = arrowPrefix[0].lastIndexOf(arrowWakePhrase);
    matches.push({
      wakePhrase: arrowWakePhrase,
      index,
      end: index + arrowWakePhrase.length,
    });
  }
  for (const match of transcript.matchAll(WAKE_PHRASE_PATTERN)) {
    if (match.index === undefined) {
      continue;
    }
    const wakePhrase = match[0];
    matches.push({ wakePhrase, index: match.index, end: match.index + wakePhrase.length });
  }
  return matches.sort((left, right) => left.index - right.index);
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
 * Recovers a small, auditable set of create commands when ASR returns a
 * phonetically plausible but unparsable phrase. Recovery is deliberately
 * constrained to known diagram objects and must be confirmed by the user;
 * it is never a general fuzzy match that can silently mutate the board.
 */
export function recoverAirboardVoiceCommand(
  command: string,
): AirboardVoiceCommandRecovery | null {
  const normalized = normalizeVoiceRecoveryText(command);
  const createPrefix = String.raw`(?:(?:add|at|and|it|it\s+is|this\s+is|there\s+is)(?:\s+(?:a|an|the|her))?\s+)?`;
  const hereSuffix = String.raw`(?:\s+(?:here|hear))?`;
  const aliases: readonly { objectType: string; pattern: string; command: string }[] = [
    {
      objectType: "circle",
      pattern: String.raw`(?:circle|circles|circular|career)`,
      command: "add a circle here",
    },
    {
      objectType: "user",
      pattern: String.raw`(?:user|users|you\s+sir)`,
      command: "add a user here",
    },
    {
      objectType: "API",
      pattern: String.raw`(?:api|a\s+p\s+i|endpoint|gateway)`,
      command: "add an API here",
    },
    {
      objectType: "database",
      pattern: String.raw`(?:database|data\s*base|data\s+bass|datastore)`,
      command: "add a database here",
    },
    {
      objectType: "service",
      pattern: String.raw`(?:service|server|microservice)`,
      command: "add a service here",
    },
    {
      objectType: "queue",
      pattern: String.raw`(?:queue|cue|message\s+queue)`,
      command: "add a queue here",
    },
    {
      objectType: "decision",
      pattern: String.raw`(?:decision|condition|diamond)`,
      command: "add a decision here",
    },
    {
      objectType: "note",
      pattern: String.raw`(?:note|sticky|sticky\s+note)`,
      command: "add a note here",
    },
    {
      objectType: "box",
      pattern: String.raw`(?:box|component|node)`,
      command: "add a box here",
    },
  ];

  for (const alias of aliases) {
    const pattern = new RegExp(`^${createPrefix}${alias.pattern}${hereSuffix}$`, "iu");
    if (pattern.test(normalized)) {
      return {
        command: alias.command,
        objectType: alias.objectType,
        basis: "constrained_asr_alias",
      };
    }
  }
  return null;
}

/**
 * Rewrites the natural phrasings a user says while holding an element
 * ("rename to Payments", "delete it", "connect to the database") into the
 * deterministic selection-targeted grammar. Utterances outside the scoped edit
 * vocabulary pass through unchanged so the full grammar and semantic fallback
 * stay available. Label text keeps its original casing.
 */
export function normalizeScopedVoiceUtterance(utterance: string): string {
  const trimmed = utterance
    .replace(/^[\s,.:;!?–—-]+/u, "")
    .replace(/[\s,.;!?]+$/u, "")
    .trim();
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
    String.raw`^move(?:\s+${pronoun})?\s+(?:to\s+the\s+|the\s+)?(left|right|up|down)$`,
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

export function isAirboardVoiceConfirmation(command: string): boolean {
  const normalized = normalizeVoiceRecoveryText(command);
  return /^(?:yes|yes\s+please|confirm|confirm\s+it|apply|apply\s+it|do\s+it|correct|that(?:'s|\s+is)\s+right)$/iu.test(
    normalized,
  );
}

function normalizeVoiceRecoveryText(command: string): string {
  return command
    .normalize("NFKC")
    .toLocaleLowerCase("en-US")
    .replace(/[^\p{L}\p{N}'\s]+/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
}

function collectSpeechTranscripts(event: SpeechRecognitionEventLike): {
  interim: string;
  final: string;
} {
  const results = event.results;
  if (!results) {
    return { interim: "", final: "" };
  }

  let interim = "";
  let final = "";
  const startIndex = event.resultIndex ?? 0;
  for (let index = startIndex; index < results.length; index += 1) {
    const result = results[index];
    const transcript = result?.[0]?.transcript?.trim();
    if (!result || !transcript) {
      continue;
    }
    if (result.isFinal) {
      final = `${final} ${transcript}`.trim();
    } else {
      interim = `${interim} ${transcript}`.trim();
    }
  }
  return { interim, final };
}

function isRecognitionAlreadyStartedError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "InvalidStateError";
}

function isFatalSpeechError(error?: string): boolean {
  return (
    error === "not-allowed" ||
    error === "service-not-allowed" ||
    error === "audio-capture" ||
    error === "language-not-supported"
  );
}

function describeContinuousSpeechError(error?: string, message?: string): string {
  if (error === "no-speech") {
    return "Still listening for ‘Airo’ followed by a command.";
  }
  return describeSpeechError(error, message);
}

function describeSpeechError(error?: string, message?: string): string {
  if (error === "not-allowed" || error === "service-not-allowed") {
    return "Microphone access is blocked. Allow it or type the command instead.";
  }
  if (error === "no-speech") {
    return "No command was heard. Try again or type it below.";
  }
  if (error === "audio-capture") {
    return "No microphone is available. Type the command instead.";
  }
  return message?.trim() || "Speech recognition stopped unexpectedly. Type the command instead.";
}
