import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { registerHooks } from "node:module";
import test from "node:test";
import { fileURLToPath } from "node:url";

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith(".") && context.parentURL) {
      const candidate = new URL(`${specifier}.ts`, context.parentURL);
      if (existsSync(fileURLToPath(candidate))) {
        return nextResolve(candidate.href, context);
      }
    }
    return nextResolve(specifier, context);
  },
});

const {
  SemanticSpeculation,
  composeSemanticRequestOptions,
  semanticRequestFingerprint,
  plannerRequestAddressedBy,
  plannerRequestHasPointer,
  semanticSpeculationKey,
  voiceAddressedBy,
} = await import("../src/features/board/semanticSpeculation.ts");
const { buildSemanticIntentContext } = await import("../src/features/board/intentPipeline.ts");
const { createInitialBoardState } = await import("@airboard/core");
const { VoiceCommandCoalescer } = await import("../src/features/board/voiceCommandRouter.ts");
const { resolveSemanticIntent } = await import("../src/features/board/semanticIntent.ts");

const CONTEXT = {
  selectionCount: 0,
  selected: [],
  objects: [],
  edges: [],
  projectGlossary: [],
  pointerAvailable: false,
};

function request(overrides = {}) {
  return composeSemanticRequestOptions({
    apiBaseUrl: "https://api.example.test",
    accessToken: "access-token",
    voiceTurnId: "turn-00000001",
    transcript: "add a cache",
    parserIssue: "unsupported_command",
    context: CONTEXT,
    model: "gpt-test",
    addressedBy: "wake",
    ...overrides,
  });
}

/** A speculation runner that records its signals and resolves on demand. */
function runner(label) {
  const calls = [];
  const run = (signal) => {
    const call = { label, signal, aborted: false };
    signal.addEventListener("abort", () => {
      call.aborted = true;
    });
    calls.push(call);
    return Promise.resolve({ plan: label });
  };
  return { run, calls };
}

function startFor(speculation, opts) {
  const options = request(opts.request ?? {});
  const { run, calls } = runner(opts.label ?? options.transcript);
  const started = speculation.start({
    key: semanticSpeculationKey(options.voiceTurnId, options.transcript),
    generation: opts.generation ?? 1,
    fingerprint: semanticRequestFingerprint(options),
    clarification: opts.clarification ?? null,
    run,
  });
  return { started, calls, options };
}

function takeFor(speculation, opts) {
  const options = request(opts.request ?? {});
  return speculation.take({
    key: semanticSpeculationKey(options.voiceTurnId, options.transcript),
    generation: opts.generation ?? 1,
    fingerprint: semanticRequestFingerprint(options),
    clarification: opts.clarification ?? null,
  });
}

test("an identical request consumes the speculation", async () => {
  const speculation = new SemanticSpeculation({ now: () => 100 });
  const { started, calls } = startFor(speculation, {});
  assert.equal(started, true);
  const taken = takeFor(speculation, {});
  assert.equal(taken.hit, true);
  assert.equal(taken.startedAt, 100);
  assert.deepEqual(await taken.promise, { plan: "add a cache" });
  assert.equal(calls[0].aborted, false, "a consumed speculation is not aborted");
  assert.equal(speculation.activeKey, null, "the slot is cleared");
  assert.deepEqual(takeFor(speculation, {}), { hit: false, reason: "none" });
});

test("starting the same speculation twice keeps the running one", () => {
  const speculation = new SemanticSpeculation();
  const first = startFor(speculation, {});
  const second = startFor(speculation, {});
  assert.equal(second.started, false);
  assert.equal(second.calls.length, 0);
  assert.equal(first.calls[0].aborted, false);
});

test("a generation bump (cancel, undo, typed command) discards it", () => {
  const speculation = new SemanticSpeculation();
  const { calls } = startFor(speculation, { generation: 4 });
  assert.deepEqual(takeFor(speculation, { generation: 5 }), { hit: false, reason: "generation" });
  assert.equal(calls[0].aborted, true);
});

test("a changed clarification record discards it", () => {
  const asked = { request: { previousTranscript: "add a box", question: "Which box?", missingSlots: [] } };
  const speculation = new SemanticSpeculation();
  const { calls } = startFor(speculation, { clarification: asked });
  const replacement = { ...asked };
  assert.deepEqual(takeFor(speculation, { clarification: replacement }), { hit: false, reason: "clarification" });
  assert.equal(calls[0].aborted, true);
});

test("a changed model, board context, selection or address discards it", () => {
  for (const change of [
    { model: "gpt-other" },
    { context: { ...CONTEXT, objects: [{ label: "API" }] } },
    { context: { ...CONTEXT, pointerAvailable: true } },
    { addressedBy: "palm" },
    { parserIssue: "compound_command" },
    { accessToken: "refreshed-token" },
  ]) {
    const speculation = new SemanticSpeculation();
    const { calls } = startFor(speculation, {});
    assert.deepEqual(
      takeFor(speculation, { request: change }),
      { hit: false, reason: "request" },
      JSON.stringify(change),
    );
    assert.equal(calls[0].aborted, true);
  }
});

test("a different instruction or turn is a key miss and is aborted", () => {
  const speculation = new SemanticSpeculation();
  const { calls } = startFor(speculation, {});
  assert.deepEqual(
    takeFor(speculation, { request: { transcript: "add a cache called Orders" } }),
    { hit: false, reason: "key" },
  );
  assert.equal(calls[0].aborted, true);
});

test("a superseding start aborts the old speculation; invalidate aborts the current one", () => {
  const speculation = new SemanticSpeculation();
  const first = startFor(speculation, {});
  const second = startFor(speculation, { request: { transcript: "add a cache called Orders" } });
  assert.equal(second.started, true);
  assert.equal(first.calls[0].aborted, true);
  assert.equal(second.calls[0].aborted, false);
  assert.equal(speculation.invalidate(), semanticSpeculationKey("turn-00000001", "add a cache called Orders"));
  assert.equal(second.calls[0].aborted, true);
  assert.equal(speculation.invalidate(), null);
});

test("a rejected discarded speculation never surfaces as unhandled", async () => {
  const speculation = new SemanticSpeculation();
  speculation.start({
    key: "k",
    generation: 1,
    fingerprint: "f",
    clarification: null,
    run: (signal) =>
      new Promise((_, reject) => signal.addEventListener("abort", () => reject(new Error("aborted")))),
  });
  speculation.invalidate();
  await new Promise((resolve) => setImmediate(resolve));
});

test("split utterance: only the merged command's plan is ever consumed", async () => {
  // "Airo, add a cache" … "called Orders": the first hold speculates on
  // "add a cache", the merge re-speculates on the whole command, and the
  // flush consumes the merged one.
  let clock = 0;
  const timers = new Map();
  let nextId = 1;
  const speculation = new SemanticSpeculation({ now: () => clock });
  const requests = [];
  const applied = [];
  const voiceTurnId = "turn-00000042";
  const coalescer = new VoiceCommandCoalescer({
    now: () => clock,
    setTimer: (callback, ms) => {
      const id = nextId++;
      timers.set(id, { at: clock + ms, callback });
      return id;
    },
    clearTimer: (id) => timers.delete(id),
    onHold: (decision) => {
      const options = request({ voiceTurnId, transcript: decision.command });
      speculation.start({
        key: semanticSpeculationKey(voiceTurnId, decision.command),
        generation: 1,
        fingerprint: semanticRequestFingerprint(options),
        clarification: null,
        run: (signal) => {
          const entry = { transcript: decision.command, signal };
          requests.push(entry);
          return Promise.resolve({ plan: decision.command });
        },
      });
    },
    onFlush: (decision) => {
      const options = request({ voiceTurnId, transcript: decision.command });
      const taken = speculation.take({
        key: semanticSpeculationKey(voiceTurnId, decision.command),
        generation: 1,
        fingerprint: semanticRequestFingerprint(options),
        clarification: null,
      });
      assert.equal(taken.hit, true);
      applied.push(taken.promise);
    },
  });
  const tick = (ms) => {
    const target = clock + ms;
    for (;;) {
      const due = [...timers.entries()].filter(([, t]) => t.at <= target).sort((a, b) => a[1].at - b[1].at)[0];
      if (!due) break;
      timers.delete(due[0]);
      clock = due[1].at;
      due[1].callback();
    }
    clock = target;
  };

  coalescer.push({ channel: "wake", command: "add a cache", transcript: "Airo, add a cache", wakePhrase: "Airo" });
  tick(500);
  coalescer.noteSpeechActivity();
  tick(900);
  assert.equal(coalescer.offerContinuation("called Orders"), true);
  tick(1_200);
  assert.deepEqual(requests.map((r) => r.transcript), ["add a cache", "add a cache called Orders"]);
  assert.equal(requests[0].signal.aborted, true, "the partial command's call is abandoned");
  assert.equal(requests[1].signal.aborted, false);
  assert.equal(applied.length, 1);
  assert.deepEqual(await applied[0], { plan: "add a cache called Orders" });
});

test("composeSemanticRequestOptions matches the original request shape", () => {
  assert.deepEqual(
    composeSemanticRequestOptions({
      apiBaseUrl: "https://api.example.test",
      accessToken: null,
      voiceTurnId: "turn-00000001",
      transcript: "add a cache",
      parserIssue: "unsupported_command",
      context: CONTEXT,
      pendingClarification: undefined,
      model: null,
      addressedBy: undefined,
    }),
    {
      apiBaseUrl: "https://api.example.test",
      voiceTurnId: "turn-00000001",
      transcript: "add a cache",
      parserIssue: "unsupported_command",
      context: CONTEXT,
    },
  );
  assert.equal(voiceAddressedBy("push-to-talk"), "palm");
  assert.equal(voiceAddressedBy("hold-to-edit"), "hold");
  assert.equal(voiceAddressedBy("follow-up"), undefined);
  assert.equal(voiceAddressedBy("answer"), undefined);
  assert.equal(voiceAddressedBy("Airo"), "wake");
  assert.equal(voiceAddressedBy(undefined), "wake");
});

test("resolveSemanticIntent: an external abort rejects with SEMANTIC_INTENT_ABORTED and is not retried", async () => {
  let fetches = 0;
  const controller = new AbortController();
  const fetchImpl = (_url, init) => {
    fetches += 1;
    return new Promise((_, reject) => {
      init.signal.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
    });
  };
  const pending = resolveSemanticIntent({ ...request(), signal: controller.signal }, fetchImpl);
  controller.abort();
  await assert.rejects(pending, (error) => error.code === "SEMANTIC_INTENT_ABORTED");
  assert.equal(fetches, 1);

  await assert.rejects(
    resolveSemanticIntent({ ...request(), signal: AbortSignal.abort() }, fetchImpl),
    (error) => error.code === "SEMANTIC_INTENT_ABORTED",
  );
  assert.equal(fetches, 1, "an already-aborted signal sends nothing");
});

test("the speculative request and the command's own request match for the same voice command", () => {
  const board = createInitialBoardState("speculation-fingerprint");
  const base = {
    apiBaseUrl: "https://api.example.test",
    accessToken: "token",
    voiceTurnId: "turn-1",
    transcript: "add a condition block",
    parserIssue: "unknown_command",
    model: "gpt-5.6-luna",
  };
  for (const wakePhrase of ["Airo", "push-to-talk", "hold-to-edit", "follow-up", "answer"]) {
    for (const reference of [{ point: { x: 10, y: 20 } }, { point: null }]) {
      for (const lastGesturePointer of [null, { x: 1, y: 2 }]) {
        // As speculateHeldVoiceCommandRef builds it while the command is held.
        const speculative = composeSemanticRequestOptions({
          ...base,
          context: buildSemanticIntentContext(board, [], plannerRequestHasPointer(reference, null)),
          addressedBy: voiceAddressedBy(wakePhrase),
        });
        // As queueVoiceCommand + prepareIntentCommandWithSemantic build it when it runs.
        const voiceAddressed = { addressedBy: voiceAddressedBy(wakePhrase) };
        const real = composeSemanticRequestOptions({
          ...base,
          context: buildSemanticIntentContext(
            board,
            [],
            plannerRequestHasPointer(reference, lastGesturePointer),
          ),
          addressedBy: plannerRequestAddressedBy(base.voiceTurnId, voiceAddressed),
        });
        assert.equal(
          semanticRequestFingerprint(speculative),
          semanticRequestFingerprint(real),
          `${wakePhrase}, point ${Boolean(reference.point)}, last pointer ${Boolean(lastGesturePointer)}`,
        );
      }
    }
  }
});

test("a request that differs in pointer, selection or addressing does not match the speculation", () => {
  const board = createInitialBoardState("speculation-fingerprint");
  const make = (overrides) =>
    semanticRequestFingerprint(
      composeSemanticRequestOptions({
        apiBaseUrl: "https://api.example.test",
        voiceTurnId: "turn-1",
        transcript: "add a condition block",
        parserIssue: "unknown_command",
        context: buildSemanticIntentContext(board, overrides.selection ?? [], overrides.pointer ?? false),
        addressedBy: overrides.addressedBy ?? "wake",
      }),
    );
  const baseline = make({});
  assert.notEqual(make({ pointer: true }), baseline);
  assert.notEqual(make({ addressedBy: "palm" }), baseline);
  assert.equal(plannerRequestAddressedBy(undefined, null), "typed");
  assert.equal(plannerRequestAddressedBy("turn-1", null), "wake");
  assert.equal(plannerRequestAddressedBy("turn-1", { addressedBy: undefined }), undefined);
  assert.equal(plannerRequestHasPointer(null, { x: 1, y: 1 }), true);
  assert.equal(plannerRequestHasPointer({ point: null }, { x: 1, y: 1 }), false);
});
