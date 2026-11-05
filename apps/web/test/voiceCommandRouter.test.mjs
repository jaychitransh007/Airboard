import assert from "node:assert/strict";
import test from "node:test";

import { VoiceCommandRouter } from "../src/features/board/voiceCommandRouter.ts";

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
  const second = router.handleFinalTranscript("add a note here");
  assert.equal(second.decisions.length, 0, "grace gate must be single-use");
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

test("INVARIANT: a gate-claimed transcript can never route again externally", () => {
  const { router } = makeRouter();
  router.openGate({ mode: "ptt" });
  const transcript = "Airo, add a circle here";
  const gated = router.routeGatedOnly(transcript);
  assert.ok(gated);
  // Simulate the browser-fallback session's internal wake router firing for
  // the SAME transcript — the router must refuse the duplicate.
  const duplicate = router.acceptExternalWakeCommand({
    transcript,
    command: "add a circle here",
    wakePhrase: "Airo",
  });
  assert.equal(duplicate, null);
});

test("external wake commands for unclaimed transcripts route normally", () => {
  const { router } = makeRouter();
  const decision = router.acceptExternalWakeCommand({
    transcript: "Airo, add a circle here",
    command: "add a circle here",
    wakePhrase: "Airo",
  });
  assert.ok(decision);
  assert.equal(decision.channel, "wake");
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

test("reset drops gates, claims, and wake carryover", () => {
  const { router } = makeRouter();
  router.handleFinalTranscript("Airo"); // arms carryover
  router.openGate({ mode: "ptt" });
  router.reset();
  assert.equal(router.snapshot, null);
  const { decisions } = router.handleFinalTranscript("add a user here");
  assert.equal(decisions.length, 0, "carryover must not survive reset");
});
