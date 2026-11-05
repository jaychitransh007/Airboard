import assert from "node:assert/strict";
import test from "node:test";
import {
  buildSemanticNegativeCorpus,
  main,
} from "../eval-semantic-negatives.mjs";
import {
  compareWithKnownFalseAccepts,
  readKnownFalseAccepts,
  readSemanticNegativeRecordings,
  replaySemanticNegativeAnswers,
} from "../lib/semantic-negative-replay.mjs";

test("all meeting negatives enter production semantic fallback with tempting grounding", async () => {
  const corpus = await buildSemanticNegativeCorpus();
  assert.equal(corpus.cases.length, 60);
  for (const scenario of corpus.cases) {
    assert.equal(scenario.expected.status, "unsupported");
    assert.equal(scenario.expected.issueCode, "not_board_command");
    assert.deepEqual(scenario.expected.actionTypeCounts, {});
    assert.equal(scenario.context.objects.length, 12);
    assert.equal(scenario.context.edges.length, 3);
  }
});

test("semantic ambient-negative CLI remains offline by default", async () => {
  assert.equal(await main(["--validate-only"]), 0);
  await assert.rejects(
    () => main(["--attempts", "2"]),
    /require --live/u,
  );
});

test("recorded answers replay through production code and match the known list", async () => {
  const corpus = await buildSemanticNegativeCorpus();
  const replay = await replaySemanticNegativeAnswers(corpus, await readSemanticNegativeRecordings());
  assert.deepEqual(replay.stale, [], "re-record: the prompt, tool, model or request changed");
  assert.deepEqual(replay.unknown, []);
  assert.deepEqual(compareWithKnownFalseAccepts(replay, await readKnownFalseAccepts()), []);
  assert.equal(await main(["--replay"]), 0);
});

test("the replay gate catches a new false accept, a stale recording and an improvement", async () => {
  const corpus = await buildSemanticNegativeCorpus();
  const recordings = await readSemanticNegativeRecordings();
  const known = await readKnownFalseAccepts();
  const listed = new Set(known.cases.map((entry) => entry.caseId));
  const quietCase = recordings.answers.find((answer) => !listed.has(answer.caseId));

  // A quiet case whose answer now creates a node is a new false accept.
  const tampered = structuredClone(recordings);
  const answer = tampered.answers.find((entry) => entry.caseId === quietCase.caseId);
  answer.response.output[0].arguments = JSON.stringify({
    ...JSON.parse(answer.response.output[0].arguments),
    status: "resolved",
    issueCode: "none",
    clarificationQuestion: null,
    missingSlots: [],
    actions: [{ type: "create", nodeType: "note", label: "Chatter", handle: "chatter", placement: { kind: "pointer" } }],
  });
  const tamperedReplay = await replaySemanticNegativeAnswers(corpus, tampered);
  assert.deepEqual(compareWithKnownFalseAccepts(tamperedReplay, known), [
    `${quietCase.caseId} now changes_board (resolved/none: create Chatter)`,
  ]);

  // Answers recorded for another model no longer match the request it sends.
  const otherModel = { ...recordings, model: "gpt-5.6-terra" };
  assert.equal((await replaySemanticNegativeAnswers(corpus, otherModel)).stale.length, corpus.cases.length);

  // A listed case that stops misbehaving must leave the list.
  const fixedCase = known.cases[0].caseId;
  const fixed = structuredClone(recordings);
  const fixedAnswer = fixed.answers.find((entry) => entry.caseId === fixedCase);
  fixedAnswer.response.output[0].arguments = quietCase.response.output[0].arguments;
  assert.match(
    compareWithKnownFalseAccepts(await replaySemanticNegativeAnswers(corpus, fixed), known).join("\n"),
    new RegExp(`${fixedCase} is listed as ${known.cases[0].outcome} but is now quiet`),
  );
});

test("replay and record are separate modes", async () => {
  await assert.rejects(() => main(["--replay", "--record"]), /Choose one of/u);
  await assert.rejects(() => main(["--replay", "--live"]), /Choose one of/u);
});

