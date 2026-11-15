import assert from "node:assert/strict";
import test from "node:test";

import { buildSessionKeyterms } from "../src/features/board/voiceSessionKeyterms.ts";

function board(elements = {}) {
  return {
    boardId: "board-test",
    sceneVersion: 3,
    elements,
    activeStrokes: {},
    eraseActions: {},
    participants: {},
    cursors: {},
    lastSequence: 0,
  };
}

function richText(text) {
  return {
    type: "doc",
    blocks: [{ id: "block-0", type: "paragraph", runs: [{ text }] }],
  };
}

const base = {
  boardId: "board-test",
  status: "active",
  transform: { x: 0, y: 0, width: 160, height: 80, rotation: 0 },
  zIndex: 1,
  locked: false,
  visible: true,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  revision: 1,
};

function shapeNode(id, label) {
  return { ...base, id, kind: "shape", shapeKind: "service", content: richText(label), style: {} };
}

test("adds current board entities to the complete transcription vocabulary", () => {
  const initial = buildSessionKeyterms(board());
  assert.equal(initial.includes("Planner"), false);

  const updated = buildSessionKeyterms(
    board({
      planner: shapeNode("planner", "Planner"),
      golden: shapeNode("golden", "Golden Dataset"),
      historical: shapeNode("historical", "Historical Dataset"),
    }),
    ["planner"],
  );
  assert.equal(updated.includes("Planner"), true);
  assert.equal(updated.includes("Golden Dataset"), true);
  assert.equal(updated.includes("Historical Dataset"), true);
  assert.ok(updated.indexOf("Planner") < updated.indexOf("Golden Dataset"));
  assert.ok(updated.length <= 100);
  assert.ok(updated.reduce((total, term) => total + term.length, 0) <= 1_000);
});

test("prioritizes node labels over connector labels and removes deleted labels", () => {
  const elements = {
    connector: { ...base, id: "connector", kind: "connector", label: richText("additional context") },
    planner: shapeNode("planner", "Planner"),
    deleted: { ...shapeNode("deleted", "Retired Dataset"), status: "deleted" },
  };
  const keyterms = buildSessionKeyterms(board(elements));
  assert.ok(keyterms.indexOf("Planner") < keyterms.indexOf("additional context"));
  assert.equal(keyterms.includes("Retired Dataset"), false);
});

test("includes canonical scene labels, shape names, and connector labels", () => {
  const elements = {
    database: {
      ...base,
      id: "database",
      kind: "shape",
      shapeKind: "database",
      content: richText("Customer Data"),
      style: {},
    },
    service: {
      ...base,
      id: "service",
      kind: "shape",
      shapeKind: "service",
      content: richText(""),
      style: {},
    },
    connector: {
      ...base,
      id: "connector",
      kind: "connector",
      label: richText("syncs to"),
    },
  };
  const keyterms = buildSessionKeyterms(board(elements), ["database"]);
  assert.ok(keyterms.indexOf("Customer Data") < keyterms.indexOf("Service"));
  assert.ok(keyterms.indexOf("Service") < keyterms.indexOf("syncs to"));
});

test("deduplicates case-insensitively and fits large boards to both limits", () => {
  const elements = Object.fromEntries(
    Array.from({ length: 80 }, (_, index) => [
      `node-${index}`,
      shapeNode(`node-${index}`, `Dataset Vocabulary ${index}`),
    ]),
  );
  elements.duplicate = shapeNode("duplicate", "dataset vocabulary 0");
  const keyterms = buildSessionKeyterms(board(elements));
  assert.equal(
    keyterms.filter(
      (term) => term.toLocaleLowerCase("en-US") === "dataset vocabulary 0",
    ).length,
    1,
  );
  assert.ok(keyterms.length <= 100);
  assert.ok(keyterms.reduce((total, term) => total + term.length, 0) <= 1_000);
});
