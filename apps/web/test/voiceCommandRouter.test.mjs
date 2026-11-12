import assert from "node:assert/strict";
import test from "node:test";

import { readFileSync } from "node:fs";

import {
  VOICE_ANSWER_WINDOW_MS,
  VOICE_COALESCE_ACTIVITY_HOLD_MS,
  VOICE_COALESCE_HOLD_MS,
  VOICE_COALESCE_MAX_HOLD_MS,
  VOICE_FOLLOW_UP_WINDOW_MS,
  VoiceCommandCoalescer,
  VoiceCommandRouter,
  isAnswerShapedUtterance,
  isBoardFollowUpUtterance,
  isCommandContinuationUtterance,
} from "../src/features/board/voiceCommandRouter.ts";

const MEETING_NEGATIVES = JSON.parse(
  readFileSync(new URL("../../../evals/voice-intent/meeting-negatives.v1.json", import.meta.url), "utf8"),
).utterances.map((utterance) => utterance.text);

function makeRouter(startMs = 100_000) {
  let clock = startMs;
  const router = new VoiceCommandRouter({ now: () => clock });
  return {
    router,
    tick: (ms) => {
      clock += ms;
    },
  };
}

test("wake-word transcripts route exactly one command with the wake stripped", () => {
  const { router } = makeRouter();
  const { decisions, wakeDetected } = router.handleFinalTranscript("Airo, add a circle here");
  assert.equal(wakeDetected, true);
  assert.equal(decisions.length, 1);
  assert.equal(decisions[0].channel, "wake");
  assert.equal(decisions[0].command, "add a circle here");
});

test("plain meeting talk routes nothing", () => {
  const { router } = makeRouter();
  const { decisions, wakeDetected } = router.handleFinalTranscript(
    "so the user hits the payment API",
  );
  assert.equal(decisions.length, 0);
  assert.equal(wakeDetected, false);
});

test("a wake-only turn arms the next transcript (carryover)", () => {
  const { router, tick } = makeRouter();
  assert.equal(router.handleFinalTranscript("Airo").decisions.length, 0);
  tick(1_000);
  const { decisions } = router.handleFinalTranscript("add a user here");
  assert.equal(decisions.length, 1);
  assert.equal(decisions[0].command, "add a user here");
});

test("an open push-to-talk gate outranks the wake router — exactly one decision", () => {
  const { router } = makeRouter();
  router.openGate({ mode: "ptt" });
  const { decisions } = router.handleFinalTranscript("Airo, add a queue here");
  assert.equal(decisions.length, 1);
  assert.equal(decisions[0].channel, "gated-ptt");
  // Wake prefix stripped even on the gated path.
  assert.equal(decisions[0].command, "add a queue here");
});

test("Airboard entity mentions do not split a gated semantic narrative", () => {
  const { router } = makeRouter();
  const narrative =
    "User makes a request to Airboard, and, uh, then the authentication service gets fired, and, uh, then user lands to the Airboard page. So create a flow diagram for this.";

  const ambient = router.handleFinalTranscript(narrative);
  assert.equal(ambient.wakeDetected, false);
  assert.deepEqual(ambient.decisions, []);

  router.openGate({ mode: "ptt" });
  const gated = router.handleFinalTranscript(narrative);
  assert.equal(gated.wakeDetected, false);
  assert.equal(gated.decisions.length, 1);
  assert.equal(gated.decisions[0].channel, "gated-ptt");
  assert.equal(gated.decisions[0].command, narrative);
});

test("a leading wake routes one narrative while preserving inner Airboard mentions", () => {
  const { router } = makeRouter();
  const narrative =
    "User makes a request to Airboard, and, uh, then the authentication service gets fired, and, uh, then user lands to the Airboard page. So create a flow diagram for this.";
  const routed = router.handleFinalTranscript(`Airo, ${narrative}`);

  assert.equal(routed.wakeDetected, true);
  assert.equal(routed.decisions.length, 1);
  assert.equal(routed.decisions[0].channel, "wake");
  assert.equal(routed.decisions[0].command, narrative);
});

test("an open gate routes multiple utterances until it closes", () => {
  const { router, tick } = makeRouter();
  router.openGate({ mode: "ptt" });
  assert.equal(router.handleFinalTranscript("add a user here").decisions.length, 1);
  tick(500);
  assert.equal(router.handleFinalTranscript("add an API here").decisions.length, 1);
});

test("a closed gate routes exactly one utterance inside its grace window", () => {
  const { router, tick } = makeRouter();
  router.openGate({ mode: "ptt" });
  router.closeGate("ptt");
  tick(800); // inside the 1600ms ptt grace
  const first = router.handleFinalTranscript("add a database here");
  assert.equal(first.decisions.length, 1);
  assert.equal(first.decisions[0].channel, "gated-ptt");
  // Room talk after the grace gate was used is not routed: the grace gate is
  // single-use. (A command-shaped sentence would still route, but through the
  // follow-up window, not the gate — see the follow-up tests.)
  const second = router.handleFinalTranscript("so that is the payments flow");
  assert.equal(second.decisions.length, 0, "grace gate must be single-use");
  assert.equal(router.snapshot, null);
});

test("a closed gate past its grace window routes nothing and expires", () => {
  const { router, tick } = makeRouter();
  router.openGate({ mode: "ptt" });
  router.closeGate("ptt");
  tick(2_000); // past 1600ms
  const { decisions } = router.handleFinalTranscript("add a database here");
  assert.equal(decisions.length, 0);
  assert.equal(router.snapshot, null);
});

test("speech that begins inside a gate still executes when its final transcript arrives late", () => {
  const { router, tick } = makeRouter();
  router.openGate({ mode: "ptt" });
  router.noteSpeechActivity();
  router.closeGate("ptt");
  tick(5_000); // provider finalization is later than the normal 1600ms gate grace
  const { decisions } = router.handleFinalTranscript("add a database here");
  assert.equal(decisions.length, 1);
  assert.equal(decisions[0].channel, "gated-ptt");
  assert.equal(decisions[0].command, "add a database here");
  assert.equal(router.snapshot, null, "the captured utterance consumes the gate exactly once");
});

test("an abandoned captured utterance expires instead of routing later room speech", () => {
  const { router, tick } = makeRouter();
  router.openGate({ mode: "ptt" });
  router.noteSpeechActivity();
  router.closeGate("ptt");
  tick(16_000);
  const { decisions } = router.handleFinalTranscript("add a database here");
  assert.equal(decisions.length, 0);
});

test("scoped gates normalize the utterance and carry the stroke id", () => {
  const { router } = makeRouter();
  router.openGate({ mode: "scoped", strokeId: "stroke-7" });
  const { decisions } = router.handleFinalTranscript("rename to Payments");
  assert.equal(decisions.length, 1);
  assert.equal(decisions[0].channel, "gated-scoped");
  assert.equal(decisions[0].command, "rename selected to Payments");
  assert.equal(decisions[0].strokeId, "stroke-7");
});

test("scoped grace is long enough for grab-release-speak", () => {
  const { router, tick } = makeRouter();
  router.openGate({ mode: "scoped", strokeId: "s1" });
  router.closeGate("scoped");
  tick(6_000); // within the 8000ms scoped grace
  const { decisions } = router.handleFinalTranscript("delete");
  assert.equal(decisions.length, 1);
  assert.equal(decisions[0].command, "delete selected");
});

test("closing a gate that is not open is a no-op; snapshot reflects open state", () => {
  const { router } = makeRouter();
  router.closeGate("ptt");
  assert.equal(router.snapshot, null);
  router.openGate({ mode: "scoped", strokeId: "s2" });
  assert.deepEqual(router.snapshot, { mode: "scoped", strokeId: "s2", open: true });
  router.closeGate("ptt"); // wrong mode — ignored
  assert.equal(router.snapshot.open, true);
  router.closeGate("scoped");
  assert.equal(router.snapshot.open, false);
});

test("reset drops gates and wake carryover", () => {
  const { router } = makeRouter();
  router.handleFinalTranscript("Airo"); // arms carryover
  router.openGate({ mode: "ptt" });
  router.reset();
  assert.equal(router.snapshot, null);
  const { decisions } = router.handleFinalTranscript("add a user here");
  assert.equal(decisions.length, 0, "carryover must not survive reset");
});

test("an open palm gate keeps routing every sentence while held (with speech activity)", () => {
  const { router, tick } = makeRouter();
  router.openGate({ mode: "ptt" });
  tick(300);
  router.noteSpeechActivity();
  tick(900);
  const first = router.handleFinalTranscript("add a user");
  assert.equal(first.decisions[0]?.channel, "gated-ptt");
  assert.deepEqual(router.snapshot, { mode: "ptt", open: true }, "captured utterance must not consume an open gate");
  tick(1_500);
  router.noteSpeechActivity();
  tick(900);
  const second = router.handleFinalTranscript("users sign in through the auth service");
  assert.equal(second.decisions.length, 1);
  assert.equal(second.decisions[0].channel, "gated-ptt");
  assert.equal(second.decisions[0].command, "users sign in through the auth service");
  tick(1_500);
  router.noteSpeechActivity();
  router.closeGate("ptt");
  tick(3_000);
  const late = router.handleFinalTranscript("the cache sits in front of it");
  assert.equal(late.decisions[0]?.channel, "gated-ptt", "speech begun under the palm still lands after the drop");
  assert.equal(router.snapshot, null);
});

test("speech that began before the palm went up is not grabbed by the gate", () => {
  const { router, tick } = makeRouter();
  router.noteSpeechActivity(); // a normal sentence to the room starts
  tick(1_200);
  router.noteSpeechActivity();
  router.openGate({ mode: "ptt" }); // palm raised just after finishing it
  tick(400);
  router.noteSpeechActivity();
  const { decisions } = router.handleFinalTranscript("so that is how billing works today");
  assert.equal(decisions.length, 0);
  assert.equal(router.snapshot?.open, true, "the gate stays open for the real command");
  tick(500);
  router.noteSpeechActivity();
  tick(800);
  const command = router.handleFinalTranscript("add a billing service");
  assert.equal(command.decisions[0]?.channel, "gated-ptt");
});

test("speech starting within the short lead before the gate opens still belongs to it", () => {
  const { router, tick } = makeRouter();
  router.noteSpeechActivity();
  tick(200);
  router.openGate({ mode: "ptt" });
  tick(700);
  const { decisions } = router.handleFinalTranscript("add a database");
  assert.equal(decisions[0]?.channel, "gated-ptt");
});

test("an explicit speech-start timestamp decides ownership", () => {
  const { router, tick } = makeRouter(50_000);
  tick(1_000);
  router.openGate({ mode: "ptt" }); // opened at 51_000
  router.noteSpeechStart(50_000); // VAD says speech began a second earlier
  assert.equal(router.handleFinalTranscript("we shipped it last week").decisions.length, 0);
  router.noteSpeechStart(51_100);
  assert.equal(router.handleFinalTranscript("add a cache").decisions[0]?.channel, "gated-ptt");
});

test("an abandoned interim does not make the next utterance look old", () => {
  const { router, tick } = makeRouter();
  router.noteSpeechActivity(); // interim that never finalizes
  tick(5_000);
  router.openGate({ mode: "ptt" });
  tick(200);
  router.noteSpeechActivity();
  tick(800);
  assert.equal(router.handleFinalTranscript("add a queue").decisions[0]?.channel, "gated-ptt");
});

test("follow-up window: a command-shaped next sentence routes without a wake word", () => {
  const { router, tick } = makeRouter();
  assert.equal(router.handleFinalTranscript("Airo, add a database").decisions.length, 1);
  assert.equal(router.windows.followUpOpen, true);
  tick(3_000);
  const next = router.handleFinalTranscript("and connect it to the API");
  assert.equal(next.decisions.length, 1);
  assert.equal(next.decisions[0].channel, "follow-up");
  assert.equal(next.decisions[0].wakePhrase, "follow-up");
  assert.equal(next.decisions[0].command, "and connect it to the API");
  tick(4_000); // the follow-up itself restarts the window
  const third = router.handleFinalTranscript("Rename it to Orders.");
  assert.equal(third.decisions[0]?.channel, "follow-up");
  tick(2_000);
  assert.equal(router.handleFinalTranscript("the billing one").decisions[0]?.channel, "follow-up");
});

test("follow-up window: room talk is ignored and closes the window; fillers do not", () => {
  const { router, tick } = makeRouter();
  router.handleFinalTranscript("Airo, add a database");
  tick(1_000);
  assert.equal(router.handleFinalTranscript("um").decisions.length, 0);
  assert.equal(router.windows.followUpOpen, true, "a filler keeps the window");
  assert.equal(router.handleFinalTranscript("so anyway the numbers look good").decisions.length, 0);
  assert.equal(router.windows.followUpOpen, false);
  assert.equal(router.handleFinalTranscript("add a cache").decisions.length, 0, "window closed by room talk");
});

test("follow-up window expires", () => {
  const { router, tick } = makeRouter();
  router.handleFinalTranscript("Airo, add a database");
  tick(VOICE_FOLLOW_UP_WINDOW_MS + 1);
  assert.equal(router.handleFinalTranscript("add a cache").decisions.length, 0);
  assert.equal(router.handleFinalTranscript("make sure the API is up").decisions.length, 0);
});

test("follow-up window: idioms and narration are not commands", () => {
  const { router, tick } = makeRouter();
  for (const talk of ["make sure we ship on Friday", "let's move on", "the arrow keys are broken", "so call it done"]) {
    router.handleFinalTranscript("Airo, add a database");
    tick(500);
    assert.equal(router.handleFinalTranscript(talk).decisions.length, 0, talk);
  }
});

test("follow-up window: meeting imperatives never route, real board follow-ups do", () => {
  const meetingImperatives = [
    "please rename the branch before you merge it",
    "delete the feature flag once the rollout completes",
    "move the config into the environment file instead",
    "remove the console logs before shipping please",
    "make a note that we owe legal a response by Friday",
    "create a ticket for the flaky test and assign it to me",
    "add Priya to the invite when you get a chance",
    "place the order before the discount expires",
    "insert a slide about churn after the revenue one",
    "draw a line under it and let's move on",
    "please add your input on the proposal",
    "add the document to the shared drive",
    "make an end of it and ship",
    "make it black and white for the printout",
    "select all the options that apply in the form",
    "please distribute the meeting minutes after this call",
    "and then move the API to the new cluster next sprint",
  ];
  for (const talk of [...meetingImperatives, ...MEETING_NEGATIVES]) {
    const { router, tick } = makeRouter();
    router.handleFinalTranscript("Airo, add a database");
    tick(2_000);
    assert.deepEqual(router.handleFinalTranscript(talk).decisions, [], talk);
    assert.equal(isBoardFollowUpUtterance(talk), false, talk);
  }
  for (const followUp of [
    "add a cache",
    "and connect it to the API",
    "make it red",
    "rename it to Orders",
    "delete the database",
    "can you also connect it to the API",
    "now delete that",
    "add a box called Friday",
    "scratch that",
    "no, I meant a cache",
    "the billing one",
  ]) {
    const { router, tick } = makeRouter();
    router.handleFinalTranscript("Airo, add a database");
    tick(2_000);
    assert.equal(router.handleFinalTranscript(followUp).decisions[0]?.channel, "follow-up", followUp);
  }
});

test("noteCommandSettled restarts the follow-up window from when the result landed", () => {
  const { router, tick } = makeRouter();
  router.handleFinalTranscript("Airo, create a diagram where a user calls the API");
  tick(6_000); // planner time
  router.noteCommandSettled();
  tick(6_000);
  assert.equal(router.handleFinalTranscript("add a cache").decisions[0]?.channel, "follow-up");
});

test("answer window takes the next sentence of any shape, once", () => {
  const { router, tick } = makeRouter();
  assert.equal(router.handleFinalTranscript("billing").decisions.length, 0);
  router.openAnswerWindow();
  assert.equal(router.windows.answerOpen, true);
  tick(4_000);
  const answer = router.handleFinalTranscript("Billing, I think.");
  assert.equal(answer.decisions.length, 1);
  assert.equal(answer.decisions[0].channel, "answer");
  assert.equal(answer.decisions[0].wakePhrase, "answer");
  assert.equal(answer.decisions[0].command, "Billing, I think.");
  assert.equal(router.windows.answerOpen, false);
  tick(500);
  // Afterwards only command-shaped follow-ups route.
  assert.equal(router.handleFinalTranscript("and the other thing is pricing").decisions.length, 0);
});

test("answer window ignores asides and long talk, and closes after one answer", () => {
  const { router, tick } = makeRouter();
  router.openAnswerWindow();
  for (const aside of [
    "hmm let me think about that",
    "sorry Bob, go ahead",
    "I'm not sure we should even have that service in the diagram at all honestly",
  ]) {
    assert.equal(router.handleFinalTranscript(aside).decisions.length, 0, aside);
    assert.equal(router.windows.answerOpen, true, `${aside} leaves the question open`);
    tick(500);
  }
  assert.equal(router.handleFinalTranscript("Orders").decisions[0]?.channel, "answer");
  assert.equal(router.windows.answerOpen, false);
  tick(500);
  assert.equal(router.handleFinalTranscript("Payments").decisions.length, 0, "one answer only");

  // A long but command-shaped answer is still an answer.
  router.openAnswerWindow();
  const long = "connect the billing service to the payments API and the ledger database please";
  assert.equal(isAnswerShapedUtterance(long), true);
  assert.equal(router.handleFinalTranscript(long).decisions[0]?.channel, "answer");
});

test("answer window expires and is closed by a wake command", () => {
  const { router, tick } = makeRouter();
  router.openAnswerWindow();
  tick(VOICE_ANSWER_WINDOW_MS + 1);
  assert.equal(router.handleFinalTranscript("the billing service").decisions.length, 0);

  router.openAnswerWindow(5_000);
  const wake = router.handleFinalTranscript("Airo, delete the payments service");
  assert.equal(wake.decisions[0]?.channel, "wake");
  assert.equal(router.windows.answerOpen, false);
  router.openAnswerWindow();
  router.closeAnswerWindow();
  assert.equal(router.windows.answerOpen, false);
});

test("a gate-claimed turn drops a stale bare-wake carryover", () => {
  const { router, tick } = makeRouter();
  router.handleFinalTranscript("Airo");
  router.openGate({ mode: "ptt" });
  assert.equal(router.handleFinalTranscript("add a user").decisions[0]?.channel, "gated-ptt");
  router.closeGate("ptt");
  tick(VOICE_FOLLOW_UP_WINDOW_MS + 2_000);
  assert.equal(router.handleFinalTranscript("we should talk to legal").decisions.length, 0);
});

test("mid-sentence wakes and mishearings route through the router", () => {
  const { router, tick } = makeRouter();
  const cases = [
    ["And now Airo, add a database", "add a database"],
    ["so as I was saying airo add a cache", "add a cache"],
    ["Thanks Airo. Add a queue.", "Add a queue."],
    ["Hey Arrow, add a user", "add a user"],
    ["Aero rename the API to Gateway", "rename the API to Gateway"],
  ];
  for (const [transcript, command] of cases) {
    tick(VOICE_FOLLOW_UP_WINDOW_MS + 1);
    const { decisions } = router.handleFinalTranscript(transcript);
    assert.equal(decisions.length, 1, transcript);
    assert.equal(decisions[0].channel, "wake", transcript);
    assert.equal(decisions[0].command, command, transcript);
  }
  for (const talk of [
    "Arrow keys are broken in the editor",
    "Aero dynamics is a different team",
    "the Airboard page loads after sign in",
    "draw an arrow here on the whiteboard later",
    "I told Airo about it yesterday",
    "I told the team Airo can add a database for us",
    "did you see airo delete the database",
  ]) {
    tick(VOICE_FOLLOW_UP_WINDOW_MS + 1);
    assert.equal(router.handleFinalTranscript(talk).decisions.length, 0, talk);
  }
});

test("reset closes the follow-up and answer windows", () => {
  const { router } = makeRouter();
  router.handleFinalTranscript("Airo, add a database");
  router.openAnswerWindow();
  router.reset();
  assert.deepEqual(router.windows, { followUpOpen: false, answerOpen: false });
  assert.equal(router.handleFinalTranscript("add a cache").decisions.length, 0);
});

/* ---------------------------- VoiceCommandCoalescer ---------------------------- */

function makeCoalescer(overrides = {}) {
  let clock = 0;
  let nextId = 1;
  const timers = new Map();
  const flushed = [];
  const coalescer = new VoiceCommandCoalescer({
    onFlush: (decision) => flushed.push(decision),
    now: () => clock,
    setTimer: (callback, ms) => {
      const id = nextId++;
      timers.set(id, { at: clock + ms, callback });
      return id;
    },
    clearTimer: (id) => {
      timers.delete(id);
    },
    ...overrides,
  });
  const tick = (ms) => {
    const target = clock + ms;
    for (;;) {
      const due = [...timers.entries()]
        .filter(([, timer]) => timer.at <= target)
        .sort((a, b) => a[1].at - b[1].at)[0];
      if (!due) break;
      timers.delete(due[0]);
      clock = due[1].at;
      due[1].callback();
    }
    clock = target;
  };
  return { coalescer, flushed, tick };
}

const wakeDecision = (command, transcript = `Airo, ${command}`) => ({
  channel: "wake",
  command,
  transcript,
  wakePhrase: "Airo",
});

test("coalescer merges a continuation spoken after a thinking pause", () => {
  const { coalescer, flushed, tick } = makeCoalescer();
  coalescer.push(wakeDecision("add a database"));
  tick(600);
  assert.equal(flushed.length, 0);
  assert.equal(coalescer.offerContinuation("Called Orders."), true);
  tick(VOICE_COALESCE_HOLD_MS - 1);
  assert.equal(flushed.length, 0, "a merge starts a fresh hold");
  tick(1);
  assert.equal(flushed.length, 1);
  assert.equal(flushed[0].command, "add a database called Orders.");
  assert.equal(flushed[0].channel, "wake");
  assert.equal(flushed[0].transcript, "Airo, add a database Called Orders.");
});

test("coalescer flushes after the hold when nothing follows", () => {
  const { coalescer, flushed, tick } = makeCoalescer();
  coalescer.push(wakeDecision("add a database"));
  tick(VOICE_COALESCE_HOLD_MS - 1);
  assert.equal(flushed.length, 0);
  tick(1);
  assert.equal(flushed.length, 1, "a lone command runs ~1.2 s after its final");
  assert.equal(coalescer.offerContinuation("called Orders"), false, "too late: nothing is held");
  coalescer.noteSpeechActivity(); // no-op with nothing held
  tick(10_000);
  assert.equal(flushed.length, 1);
});

test("coalescer: speech activity keeps the command held through a real thinking pause", () => {
  // "Airo, add a database… [1.5 s pause] …called Orders" with a 1.2 s ASR
  // end-of-turn: the first final lands 1.2 s into the pause, the speaker
  // resumes 0.3 s later, interims stream, and the continuation's final lands
  // 1.2 s + finalization after the last word.
  const { coalescer, flushed, tick } = makeCoalescer();
  coalescer.push(wakeDecision("add a database"));
  tick(500); // first interim of "called Orders"
  coalescer.noteSpeechActivity();
  tick(300);
  coalescer.noteSpeechActivity();
  tick(300); // last interim; speech ends
  coalescer.noteSpeechActivity();
  tick(1_400); // end-of-turn silence + finalization
  assert.equal(flushed.length, 0, "still held while the continuation finalizes");
  assert.equal(coalescer.offerContinuation("called Orders"), true);
  tick(VOICE_COALESCE_HOLD_MS);
  assert.deepEqual(flushed.map((d) => d.command), ["add a database called Orders"]);
});

test("coalescer: speech activity cannot stretch a hold past the hard cap", () => {
  const { coalescer, flushed, tick } = makeCoalescer();
  coalescer.push(wakeDecision("add a database"));
  for (let elapsed = 0; elapsed < VOICE_COALESCE_MAX_HOLD_MS + 2_000; elapsed += 200) {
    coalescer.noteSpeechActivity();
    tick(200);
    if (flushed.length) break;
  }
  assert.equal(flushed.length, 1);
  assert.ok(VOICE_COALESCE_ACTIVITY_HOLD_MS < VOICE_COALESCE_MAX_HOLD_MS);
});

test("coalescer: room talk finalizing during a hold is never merged and ends the stretch", () => {
  const { coalescer, flushed, tick } = makeCoalescer();
  coalescer.push(wakeDecision("add a database"));
  tick(300);
  coalescer.noteSpeechActivity();
  tick(1_000);
  for (const talk of [
    "which honestly is where everything breaks",
    "okay so that is the database guys",
    "nice",
    "great",
    "to be honest",
    "after the call",
    "add the slides to the drive",
  ]) {
    assert.equal(coalescer.offerContinuation(talk), false, talk);
  }
  tick(VOICE_COALESCE_HOLD_MS);
  assert.deepEqual(flushed.map((d) => d.command), ["add a database"]);

  // Same with the palm gate open: room talk is not a continuation.
  coalescer.setGateOpen(true);
  coalescer.push({ channel: "gated-ptt", command: "add a database", transcript: "add a database", wakePhrase: "push-to-talk" });
  assert.equal(coalescer.offerContinuation("okay so that is the database guys"), false);
  coalescer.push({ channel: "gated-ptt", command: "nice", transcript: "nice", wakePhrase: "push-to-talk" });
  assert.deepEqual(flushed.map((d) => d.command), ["add a database", "add a database"]);
  coalescer.setGateOpen(false);
  tick(1_000);
  assert.deepEqual(flushed.map((d) => d.command), ["add a database", "add a database", "nice"]);
});

test("continuation shapes", () => {
  for (const fragment of [
    "called Orders",
    "named the billing service",
    "and connect it to the API",
    "then make it blue",
    "next to the API",
    "right next to the cache",
    "between the user and the API",
    "in red",
    "to the API",
  ]) {
    assert.equal(isCommandContinuationUtterance(fragment, "add a database"), true, fragment);
  }
  assert.equal(isCommandContinuationUtterance("Payments", "rename to"), true);
  assert.equal(isCommandContinuationUtterance("Payments", "add a database"), false);
  assert.equal(isCommandContinuationUtterance("add a cache", "add a database"), false);
  for (const talk of MEETING_NEGATIVES) {
    assert.equal(isCommandContinuationUtterance(talk, "add a database"), false, talk);
  }
});

test("coalescer never merges a sentence with its own wake word", () => {
  const { coalescer, flushed, tick } = makeCoalescer();
  coalescer.push(wakeDecision("add a database"));
  tick(300);
  assert.equal(coalescer.offerContinuation("Airo, add a cache"), false);
  coalescer.push(wakeDecision("add a cache"));
  assert.equal(flushed.length, 1);
  assert.equal(flushed[0].command, "add a database");
  tick(VOICE_COALESCE_HOLD_MS);
  assert.deepEqual(flushed.map((d) => d.command), ["add a database", "add a cache"]);
});

test("coalescer does not merge an unaddressed fresh imperative but merges a connective one", () => {
  const { coalescer, flushed, tick } = makeCoalescer();
  coalescer.push(wakeDecision("add a database"));
  assert.equal(coalescer.offerContinuation("add the slides to the drive"), false);
  assert.equal(coalescer.offerContinuation("and connect it to the API"), true);
  tick(VOICE_COALESCE_HOLD_MS);
  assert.equal(flushed[0].command, "add a database and connect it to the API");
});

test("coalescer holds longer while the palm gate is open and flushes on palm drop", () => {
  const { coalescer, flushed, tick } = makeCoalescer();
  coalescer.setGateOpen(true);
  coalescer.push({ channel: "gated-ptt", command: "add a database", transcript: "add a database", wakePhrase: "push-to-talk" });
  tick(1_500);
  assert.equal(flushed.length, 0, "2 s hold while the palm is up");
  coalescer.push({ channel: "gated-ptt", command: "called Orders", transcript: "called Orders", wakePhrase: "push-to-talk" });
  tick(1_900);
  assert.equal(flushed.length, 0);
  coalescer.setGateOpen(false);
  tick(299);
  assert.equal(flushed.length, 0);
  tick(1);
  assert.equal(flushed.length, 1);
  assert.equal(flushed[0].command, "add a database called Orders");
  assert.equal(flushed[0].channel, "gated-ptt");
});

test("coalescer keeps separate gated imperatives as separate commands", () => {
  const { coalescer, flushed, tick } = makeCoalescer();
  coalescer.setGateOpen(true);
  const gated = (command) => ({ channel: "gated-ptt", command, transcript: command, wakePhrase: "push-to-talk" });
  coalescer.push(gated("add a user"));
  tick(1_000);
  coalescer.push(gated("add a database"));
  assert.deepEqual(flushed.map((d) => d.command), ["add a user"]);
  coalescer.setGateOpen(false);
  tick(300);
  assert.deepEqual(flushed.map((d) => d.command), ["add a user", "add a database"]);
});

test("coalescer merges follow-up fragments, re-normalizes scoped commands, and flushes undo at once", () => {
  const { coalescer, flushed, tick } = makeCoalescer();
  coalescer.push({ channel: "gated-scoped", command: "rename to", transcript: "rename to", wakePhrase: "hold-to-edit", strokeId: "s1" });
  coalescer.push({ channel: "gated-scoped", command: "Payments", transcript: "Payments", wakePhrase: "hold-to-edit", strokeId: "s1" });
  tick(VOICE_COALESCE_HOLD_MS);
  assert.equal(flushed[0].command, "rename selected to Payments");
  assert.equal(flushed[0].strokeId, "s1");

  coalescer.push(wakeDecision("undo"));
  assert.equal(flushed.length, 2, "undo does not wait");
  assert.equal(flushed[1].command, "undo");
});

test("coalescer flush and cancel", () => {
  const { coalescer, flushed, tick } = makeCoalescer();
  coalescer.push(wakeDecision("add a database"));
  assert.equal(coalescer.flush()?.command, "add a database");
  assert.equal(coalescer.pending, null);
  coalescer.push(wakeDecision("add a cache"));
  coalescer.cancel();
  tick(5_000);
  assert.deepEqual(flushed.map((d) => d.command), ["add a database"]);
  assert.equal(coalescer.offerContinuation("um"), false);
});

test("expectsFollowUp reflects the follow-up and answer windows", () => {
  const { router, tick } = makeRouter();
  assert.equal(router.expectsFollowUp(), false);
  router.handleFinalTranscript("Airo, add a database");
  assert.equal(router.expectsFollowUp(), true);
  tick(VOICE_FOLLOW_UP_WINDOW_MS + 1);
  assert.equal(router.expectsFollowUp(), false);
  router.openAnswerWindow();
  assert.equal(router.expectsFollowUp(), true);
});
