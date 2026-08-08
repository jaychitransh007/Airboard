import assert from "node:assert/strict";
import test from "node:test";

import {
  AIRBOARD_TRANSCRIPTION_KEYTERMS,
  classifyBrowserWakeTranscript,
  createBrowserWakeCommandRouter,
  createBrowserWakeSpeechSession,
  extractBrowserWakeCommands,
  isAirboardVoiceConfirmation,
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
