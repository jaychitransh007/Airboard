import assert from "node:assert/strict";
import test from "node:test";

import {
  AIRBOARD_TRANSCRIPTION_KEYTERMS,
  classifyBrowserWakeTranscript,
  createBrowserWakeCommandRouter,
  createBrowserWakeSpeechSession,
  extractBrowserWakeCommands,
  isAirboardVoiceConfirmation,
  isAddressedRequestUtterance,
  isCommandShapedUtterance,
  isConnectiveCommandUtterance,
  isReferenceAnswerUtterance,
  stripPoliteCommandLeadIn,
  normalizeScopedVoiceUtterance,
  recoverAirboardVoiceCommand,
} from "../src/features/board/browserSpeech.ts";
import { parseIntentCanvasCommand } from "../src/features/board/intentCanvasParser.ts";

test("extracts canonical and common Chrome wake variants", () => {
  const transcript =
    "Airo add a circle. Airoh add a note. Aero add a service. Air O add a user. Air Oh add an API. Air row align them. Airboard connect them. Air board distribute them";

  assert.deepEqual(
    extractBrowserWakeCommands(transcript).map(({ wakePhrase, command }) => ({
      wakePhrase,
      command,
    })),
    [
      { wakePhrase: "Airo", command: "add a circle." },
      { wakePhrase: "Airoh", command: "add a note." },
      { wakePhrase: "Aero", command: "add a service." },
      { wakePhrase: "Air O", command: "add a user." },
      { wakePhrase: "Air Oh", command: "add an API." },
      { wakePhrase: "Air row", command: "align them." },
      { wakePhrase: "Airboard", command: "connect them." },
      { wakePhrase: "Air board", command: "distribute them" },
    ],
  );
});

test("accepts Arrow only as a transcript prefix", () => {
  assert.deepEqual(
    extractBrowserWakeCommands("  Arrow, add a user").map(({ wakePhrase, command }) => ({
      wakePhrase,
      command,
    })),
    [{ wakePhrase: "Arrow", command: "add a user" }],
  );

  assert.deepEqual(extractBrowserWakeCommands("draw an arrow here"), []);
  assert.deepEqual(extractBrowserWakeCommands("please arrow add a user"), []);
});

test("repairs Chrome hearing add as and after the wake word", () => {
  const [event] = extractBrowserWakeCommands("Arrow and a circle");
  assert.ok(event);
  assert.equal(event.wakePhrase, "Arrow");
  assert.equal(event.command, "add a circle");

  const parsed = parseIntentCanvasCommand(event.command, {
    activationPolicy: "externally_activated",
  });
  assert.equal(parsed.status, "parsed");
  if (parsed.status !== "parsed") {
    assert.fail(parsed.issue.message);
  }
  assert.equal(parsed.command.kind, "create_node");
  if (parsed.command.kind !== "create_node") {
    assert.fail("Expected a create-node command");
  }
  assert.equal(parsed.command.nodeType, "circle");
});

test("uses phrase-level prompting and safely recovers constrained ASR object aliases", () => {
  assert.ok(AIRBOARD_TRANSCRIPTION_KEYTERMS.includes("Airo add a circle here"));
  assert.ok(AIRBOARD_TRANSCRIPTION_KEYTERMS.includes("connect User to API"));

  assert.deepEqual(recoverAirboardVoiceCommand("It is her career."), {
    command: "add a circle here",
    objectType: "circle",
    basis: "constrained_asr_alias",
  });
  assert.equal(recoverAirboardVoiceCommand("at a data bass hear")?.command, "add a database here");
  assert.equal(recoverAirboardVoiceCommand("you sir here")?.command, "add a user here");
  assert.equal(recoverAirboardVoiceCommand("please discuss her career"), null);
  assert.equal(recoverAirboardVoiceCommand("connect the service to the API"), null);

  assert.equal(isAirboardVoiceConfirmation("confirm"), true);
  assert.equal(isAirboardVoiceConfirmation("yes please"), true);
  assert.equal(isAirboardVoiceConfirmation("add something else"), false);
});

test("classifies wake-only, command, and ordinary final transcripts", () => {
  assert.deepEqual(classifyBrowserWakeTranscript("Aero"), {
    transcript: "Aero",
    wakeDetected: true,
    wakePhrases: ["Aero"],
    commands: [],
  });

  const command = classifyBrowserWakeTranscript("Air row add a database");
  assert.equal(command.wakeDetected, true);
  assert.deepEqual(command.wakePhrases, ["Air row"]);
  assert.deepEqual(command.commands.map((event) => event.command), ["add a database"]);

  assert.deepEqual(classifyBrowserWakeTranscript("please add a database"), {
    transcript: "please add a database",
    wakeDetected: false,
    wakePhrases: [],
    commands: [],
  });
});

test("routes a wake-only realtime turn into the next finalized command", () => {
  const commands = [];
  const router = createBrowserWakeCommandRouter({
    onCommand: ({ command }) => commands.push(command),
  });

  router.consumeFinalTranscript("Airo");
  router.consumeFinalTranscript("add a circle here");
  router.consumeFinalTranscript("ordinary meeting speech");
  assert.deepEqual(commands, ["add a circle here"]);

  router.consumeFinalTranscript("Airo");
  router.reset();
  router.consumeFinalTranscript("add a database here");
  assert.deepEqual(commands, ["add a circle here"]);
});

test("drops a stale pending wake so later unrelated speech cannot execute", () => {
  const commands = [];
  let now = 1_000;
  const router = createBrowserWakeCommandRouter(
    { onCommand: ({ command }) => commands.push(command) },
    { now: () => now },
  );

  // Bare wake, then a long silence before an unrelated command-like sentence.
  router.consumeFinalTranscript("Airo");
  now += 11_000;
  router.consumeFinalTranscript("delete the selected object");
  assert.deepEqual(commands, []);

  // A wake still followed promptly by a command works as before.
  router.consumeFinalTranscript("Airo");
  now += 2_000;
  router.consumeFinalTranscript("add a circle here");
  assert.deepEqual(commands, ["add a circle here"]);
});

test("ignores ordinary speech that merely resembles a wake phrase", () => {
  assert.deepEqual(extractBrowserWakeCommands("please add a database"), []);
  assert.deepEqual(extractBrowserWakeCommands("draw an arrow here"), []);
  assert.deepEqual(extractBrowserWakeCommands("narrow the gap between the nodes"), []);
  assert.deepEqual(extractBrowserWakeCommands("use an aerodynamic shape"), []);
  assert.deepEqual(extractBrowserWakeCommands("the air outside feels cold"), []);
});

test("keeps Airboard entity mentions inside one narrative command", () => {
  const narrative =
    "User makes a request to Airboard, and, uh, then the authentication service gets fired, and, uh, then user lands to the Airboard page. So create a flow diagram for this.";

  assert.deepEqual(classifyBrowserWakeTranscript(narrative), {
    transcript: narrative,
    wakeDetected: false,
    wakePhrases: [],
    commands: [],
  });

  const invoked = classifyBrowserWakeTranscript(`Airo, ${narrative}`);
  assert.equal(invoked.wakeDetected, true);
  assert.deepEqual(invoked.wakePhrases, ["Airo"]);
  assert.deepEqual(invoked.commands.map(({ command }) => command), [narrative]);
});

test("continuous session emits only woken commands and carries a wake across results", async (t) => {
  const originalWindow = globalThis.window;
  const recognitions = [];

  class FakeRecognition {
    continuous = false;
    interimResults = false;
    lang = "";
    maxAlternatives = 0;
    onstart = null;
    onresult = null;
    onerror = null;
    onend = null;
    startCalls = 0;

    constructor() {
      recognitions.push(this);
    }

    start() {
      this.startCalls += 1;
      this.onstart?.();
    }

    stop() {
      this.onend?.();
    }

    abort() {
      this.onend?.();
    }

    emitFinal(transcript) {
      this.onresult?.({
        resultIndex: 0,
        results: [{ isFinal: true, 0: { transcript } }],
      });
    }
  }

  globalThis.window = { SpeechRecognition: FakeRecognition };
  t.after(() => {
    if (originalWindow === undefined) {
      delete globalThis.window;
    } else {
      globalThis.window = originalWindow;
    }
  });

  const commands = [];
  const wakePhrases = [];
  const listening = [];
  const endReasons = [];
  const session = createBrowserWakeSpeechSession(
    {
      onCommand: (event) => commands.push(event.command),
      onWake: (event) => wakePhrases.push(event.wakePhrase),
      onListening: (active) => listening.push(active),
      onEnd: (reason) => endReasons.push(reason),
    },
    { restartDelayMs: 0 },
  );

  assert.ok(session);
  session.start();
  const recognition = recognitions[0];
  assert.equal(recognition.continuous, true);
  assert.equal(recognition.interimResults, true);

  recognition.emitFinal("add a user without activation");
  recognition.emitFinal("Aero");
  recognition.emitFinal("add a user");
  recognition.emitFinal("Air row add an API Airoh connect user to API");
  recognition.emitFinal("Arrow and a circle");
  recognition.emitFinal("Arrow add a database");

  assert.deepEqual(commands, [
    "add a user",
    "add an API",
    "connect user to API",
    "add a circle",
    "add a database",
  ]);
  assert.deepEqual(wakePhrases, ["Aero", "Air row", "Airoh", "Arrow", "Arrow"]);

  recognition.onend?.();
  await new Promise((resolve) => setTimeout(resolve, 5));
  assert.equal(recognition.startCalls, 2, "a normal browser end should restart recognition");

  session.stop();
  await new Promise((resolve) => setTimeout(resolve, 5));
  assert.equal(recognition.startCalls, 2, "an explicit stop must prevent another restart");
  assert.deepEqual(listening, [true, false, true, false]);
  assert.deepEqual(endReasons, ["stopped"]);
});

test("scoped utterances rewrite to selection-targeted commands", () => {
  assert.equal(
    normalizeScopedVoiceUtterance("rename to Payments API"),
    "rename selected to Payments API",
  );
  assert.equal(
    normalizeScopedVoiceUtterance("Rename it as Ledger"),
    "rename selected to Ledger",
  );
  assert.equal(normalizeScopedVoiceUtterance("call it Orders Queue"), "rename selected to Orders Queue");
  assert.equal(normalizeScopedVoiceUtterance("name this Billing"), "rename selected to Billing");
  assert.equal(normalizeScopedVoiceUtterance("delete"), "delete selected");
  assert.equal(normalizeScopedVoiceUtterance("remove it"), "delete selected");
  assert.equal(normalizeScopedVoiceUtterance("duplicate this"), "duplicate selected");
  assert.equal(normalizeScopedVoiceUtterance("move it to the left"), "move selected left");
  assert.equal(normalizeScopedVoiceUtterance("move right"), "move selected right");
  assert.equal(
    normalizeScopedVoiceUtterance("connect it to the database"),
    "connect this to the database",
  );
  assert.equal(
    normalizeScopedVoiceUtterance("connect to Payments"),
    "connect this to Payments",
  );
});

test("non-scoped utterances pass through the scoped normalizer unchanged", () => {
  assert.equal(
    normalizeScopedVoiceUtterance("add a queue below this"),
    "add a queue below this",
  );
  assert.equal(
    normalizeScopedVoiceUtterance("rename the User circle to Customer"),
    "rename the User circle to Customer",
  );
  assert.equal(normalizeScopedVoiceUtterance("undo"), "undo");
  assert.equal(normalizeScopedVoiceUtterance("   "), "   ");
  assert.equal(
    normalizeScopedVoiceUtterance("delete the whole board"),
    "delete the whole board",
  );
});

const commandsOf = (transcript) =>
  extractBrowserWakeCommands(transcript).map(({ command }) => command);

test("accepts Airo after connective lead-ins when a command follows (unpunctuated ASR too)", () => {
  assert.deepEqual(commandsOf("And now Airo, add a database"), ["add a database"]);
  assert.deepEqual(commandsOf("and now airo add a database"), ["add a database"]);
  assert.deepEqual(commandsOf("Then Airo add a database"), ["add a database"]);
  assert.deepEqual(commandsOf("Next, Airo, put a cache between the API and the database"), [
    "put a cache between the API and the database",
  ]);
  assert.deepEqual(commandsOf("Thanks Airo. Add a database."), ["Add a database."]);
  assert.deepEqual(commandsOf("thank you airo connect the cache to the API"), ["connect the cache to the API"]);
  assert.deepEqual(commandsOf("okay so airo add a cache"), ["add a cache"]);
  assert.deepEqual(commandsOf("so as I was saying airo add a database"), ["add a database"]);
  assert.deepEqual(commandsOf("Hey Arrow, add a database"), ["add a database"]);
});

test("mid-sentence Airo without a command, and brand mentions in narration, do not activate", () => {
  for (const talk of [
    "I told Airo about it yesterday",
    "thanks Airo",
    "and now Airo is part of the demo",
    "the Airboard page loads after sign in",
    "we moved to Airboard and add a database every sprint",
    "draw an arrow here",
    "draw an arrow connect them later",
  ]) {
    assert.equal(classifyBrowserWakeTranscript(talk).wakeDetected, false, talk);
  }
});

test("Arrow, Aero and Airboard prefixes count only when a command follows", () => {
  assert.deepEqual(commandsOf("Arrow keys are broken"), []);
  assert.equal(classifyBrowserWakeTranscript("Arrow keys are broken").wakeDetected, false);
  assert.equal(classifyBrowserWakeTranscript("Aero dynamics is a whole other team").wakeDetected, false);
  assert.equal(classifyBrowserWakeTranscript("Airboard is what we use for diagrams").wakeDetected, false);
  assert.deepEqual(commandsOf("Arrow, add a user"), ["add a user"]);
  assert.deepEqual(commandsOf("Aero rename the API to Gateway"), ["rename the API to Gateway"]);
  assert.deepEqual(commandsOf("Airboard connect them"), ["connect them"]);
  // The bare word still arms the next sentence, as "Airo" does.
  assert.equal(classifyBrowserWakeTranscript("Aero").wakeDetected, true);
  // Canonical Airo keeps accepting narrative descriptions (semantic requests).
  assert.deepEqual(commandsOf("Airo, users sign in through the auth service"), [
    "users sign in through the auth service",
  ]);
});

test("narration about Airo is not a command; only address position wakes mid-sentence", () => {
  for (const talk of [
    "I told the team Airo can add a database for us",
    "did you see airo delete the database",
    "watch airo draw this",
    "I think we should make sure Airo add more color",
    "Airo will add it later",
    "Airo can add a database for us",
    "Airo is part of the demo",
  ]) {
    assert.equal(classifyBrowserWakeTranscript(talk).wakeDetected, false, talk);
  }
  assert.deepEqual(commandsOf("we're nearly done, Airo add a cache"), ["add a cache"]);
  assert.deepEqual(commandsOf("Airo can you add a cache"), ["can you add a cache"]);
  assert.deepEqual(commandsOf("and Airo, could you connect it to the API"), ["could you connect it to the API"]);
});

test("Aero, Arrow and Airboard accept polite and narrated requests", () => {
  assert.deepEqual(commandsOf("Aero, can you add a database"), ["can you add a database"]);
  assert.deepEqual(commandsOf("Arrow, can you add a database"), ["can you add a database"]);
  assert.deepEqual(commandsOf("Arrow please add a user"), ["please add a user"]);
  assert.deepEqual(commandsOf("Aero, we need a cache in front of the API"), ["we need a cache in front of the API"]);
  assert.deepEqual(commandsOf("Aero I'd like to add a queue"), ["I'd like to add a queue"]);
  assert.deepEqual(
    commandsOf("Aero, users sign in through the auth service, which checks the user database"),
    ["users sign in through the auth service, which checks the user database"],
  );
  assert.deepEqual(commandsOf("Airboard, users sign in through auth"), ["users sign in through auth"]);
  // Without a vocative pause, narration after the mishearings stays content.
  assert.equal(classifyBrowserWakeTranscript("Aero dynamics is a whole other team").wakeDetected, false);
  assert.equal(classifyBrowserWakeTranscript("Airboard is what we use for diagrams").wakeDetected, false);
  assert.equal(classifyBrowserWakeTranscript("Arrow, users sign in").wakeDetected, false);
  assert.equal(isAddressedRequestUtterance("could you please connect it to the API"), true);
  assert.equal(isAddressedRequestUtterance("can you hear me"), false);
  assert.equal(stripPoliteCommandLeadIn("can you also connect it"), "connect it");
});

test("a carried wake ignores a connective lead-in before an in-sentence wake", () => {
  const commands = [];
  const router = createBrowserWakeCommandRouter({ onCommand: (event) => commands.push(event.command) });
  router.consumeFinalTranscript("Airo");
  router.consumeFinalTranscript("and now Airo add a database");
  assert.deepEqual(commands, ["add a database"]);
});

test("command-shape and reference-answer classifiers", () => {
  for (const command of [
    "add a cache",
    "Add a database.",
    "and connect it to the API",
    "then delete the queue",
    "now rename it to Orders",
    "um please make it blue",
    "undo",
    "zoom to fit",
    "lay out the diagram left to right",
  ]) {
    assert.equal(isCommandShapedUtterance(command), true, command);
  }
  for (const talk of [
    "so the user hits the payment API",
    "called Orders",
    "make sure we ship",
    "let's move on",
    "move on to the next slide",
    "call me after lunch",
    "the arrow keys are broken",
    "can you hear me",
    "undo is broken in the editor",
    "zoom doesn't work on my laptop",
    "so call it done",
    "make a note that we owe legal a response",
    "draw a line under it and let's move on",
  ]) {
    assert.equal(isCommandShapedUtterance(talk), false, talk);
  }
  assert.equal(isConnectiveCommandUtterance("and connect it to the API"), true);
  assert.equal(isConnectiveCommandUtterance("connect it to the API"), false);
  for (const answer of ["the billing one", "The second one.", "that one", "the last", "number two"]) {
    assert.equal(isReferenceAnswerUtterance(answer), true, answer);
  }
  for (const talk of ["the billing team is late", "one more thing", "that"]) {
    assert.equal(isReferenceAnswerUtterance(talk), false, talk);
  }
});
