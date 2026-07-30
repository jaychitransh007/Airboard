import assert from "node:assert/strict";
import test from "node:test";

import {
  createVoiceTraceReporter,
  postVoiceTrace,
  VOICE_TRACE_STAGES,
} from "../src/features/board/voiceTrace.ts";

test("stage vocabulary spans capture, transport, interpretation, grounding, feedback, and Undo", () => {
  for (const stage of [
    "capture_started",
    "audio_dropped",
    "stt_connection",
    "stt_finalization",
    "routing",
    "parser_outcome",
    "semantic_request",
    "grounding",
    "action_applied",
    "feedback",
    "correction",
    "action_undone",
  ]) {
    assert.ok(VOICE_TRACE_STAGES.includes(stage), `missing ${stage}`);
  }
});

test("posts a bounded voice stage without raw audio", async () => {
  let request;
  await postVoiceTrace(
    {
      apiBaseUrl: "http://127.0.0.1:4000",
      voiceTurnId: "09f53452-e33d-4b28-8701-87116ab2f893",
      stage: "stt_final",
      occurredAt: "2026-07-12T12:00:00.000Z",
      data: {
        transcript: "Airo add a decision",
        provider: "deepgram",
        rawAudio: "must-not-leave-the-browser",
        audioBytes: [1, 2, 3],
      },
    },
    async (input, init) => {
      request = { input: String(input), init };
      return new Response(null, { status: 204 });
    },
  );

  assert.equal(request.input, "http://127.0.0.1:4000/voice/trace");
  const payload = JSON.parse(request.init.body);
  assert.equal(payload.stage, "stt_final");
  assert.equal(payload.data.transcript, "Airo add a decision");
  assert.equal(payload.data.rawAudio, undefined);
  assert.equal(payload.data.audioBytes, undefined);
});

test("best-effort reporter does not surface telemetry failures", async () => {
  const report = createVoiceTraceReporter("http://127.0.0.1:4000", async () => {
    throw new Error("offline");
  });
  report("voice-turn-1", "parser_outcome", { status: "parsed" });
  await new Promise((resolve) => setTimeout(resolve, 0));
});

test("serializes trace stages for the same voice turn", async () => {
  const stages = [];
  const report = createVoiceTraceReporter("http://127.0.0.1:4000", async (_url, init) => {
    const payload = JSON.parse(init.body);
    if (payload.stage === "capture_metadata") {
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    stages.push(payload.stage);
    return new Response(null, { status: 202 });
  });
  report("voice-turn-ordered", "capture_metadata");
  report("voice-turn-ordered", "stt_final");
  report("voice-turn-ordered", "wake_classification");
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.deepEqual(stages, ["capture_metadata", "stt_final", "wake_classification"]);
});

test("timestamps stages when reported rather than when queued posts begin", async () => {
  const payloads = [];
  let releaseFirst;
  const firstPostBlocked = new Promise((resolve) => {
    releaseFirst = resolve;
  });
  const report = createVoiceTraceReporter("http://127.0.0.1:4000", async (_url, init) => {
    const payload = JSON.parse(init.body);
    payloads.push(payload);
    if (payload.stage === "capture_metadata") {
      await firstPostBlocked;
    }
    return new Response(null, { status: 202 });
  });

  report("voice-turn-timestamps", "capture_metadata");
  await new Promise((resolve) => setTimeout(resolve, 10));
  report("voice-turn-timestamps", "stt_final");
  await new Promise((resolve) => setTimeout(resolve, 10));
  releaseFirst();
  await new Promise((resolve) => setTimeout(resolve, 10));

  assert.equal(payloads.length, 2);
  assert.ok(
    Date.parse(payloads[1].occurredAt) > Date.parse(payloads[0].occurredAt),
    "the queued event retains its actual report time",
  );
});

test("observer receives the shared sanitized stage vocabulary synchronously", () => {
  const observed = [];
  const report = createVoiceTraceReporter(
    "http://127.0.0.1:4000",
    async () => new Response(null, { status: 202 }),
    undefined,
    (event) => observed.push(event),
  );
  report("voice-turn-observer", "stt_final", {
    transcript: "Airo add API",
    rawAudio: "never expose this",
  });
  assert.equal(observed.length, 1);
  assert.equal(observed[0].stage, "stt_final");
  assert.equal(observed[0].data.transcript, "Airo add API");
  assert.equal(observed[0].data.rawAudio, undefined);
});

test("rejects unbounded trace payloads before transport", async () => {
  await assert.rejects(
    postVoiceTrace(
      {
        apiBaseUrl: "http://127.0.0.1:4000",
        voiceTurnId: "voice-turn-2",
        stage: "semantic_request",
        data: { alternatives: Array.from({ length: 40 }, () => "x".repeat(1_000)) },
      },
      async () => new Response(null, { status: 204 }),
    ),
    /too large/,
  );
});
