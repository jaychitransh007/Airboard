import assert from "node:assert/strict";
import test from "node:test";

import {
  parseExistingBoardFanIn,
  resolveExistingBoardFanIn,
} from "../src/features/board/existingBoardFanIn.ts";

function context({
  selected = true,
  extraObjects = [],
  edges = [],
} = {}) {
  const planner = {
    label: "Planner",
    nodeType: "process",
    ordinal: 1,
    selected,
  };
  return {
    selectionCount: selected ? 1 : 0,
    selected: selected ? [planner] : [],
    objects: [
      { label: "Golden Dataset", nodeType: "database", ordinal: 1, selected: false },
      { label: "Historical Dataset", nodeType: "database", ordinal: 2, selected: false },
      planner,
      ...extraObjects,
    ],
    edges,
    projectGlossary: [
      { term: "Planner" },
      { term: "Golden Dataset" },
      { term: "Historical Dataset" },
    ],
    pointerAvailable: false,
  };
}

function compactActions(plan) {
  return plan?.actions.map((action) => ({
    type: action.type,
    from: action.from?.label,
    to: action.to?.label,
    label: action.label,
  }));
}

test("expands an existing-board recipient clause into one edge per source", () => {
  const plan = parseExistingBoardFanIn(
    "The planner gets the additional context from the golden dataset and historical dataset.",
    context(),
  );
  assert.deepEqual(compactActions(plan), [
    {
      type: "connect",
      from: "Golden Dataset",
      to: "Planner",
      label: "additional context",
    },
    {
      type: "connect",
      from: "Historical Dataset",
      to: "Planner",
      label: "additional context",
    },
  ]);
  assert.equal(plan.actions.some((action) => action.type === "create"), false);
});

test("repairs the observed final transcript only in a uniquely grounded closed context", () => {
  const plan = parseExistingBoardFanIn(
    "So this will accept the additional content from the schema data and another additional context from the historical dataset.",
    context(),
  );
  assert.deepEqual(compactActions(plan), [
    {
      type: "connect",
      from: "Golden Dataset",
      to: "Planner",
      label: "additional context",
    },
    {
      type: "connect",
      from: "Historical Dataset",
      to: "Planner",
      label: "additional context",
    },
  ]);
});

test("does not guess a deictic recipient or residual source when grounding is ambiguous", () => {
  const transcript =
    "So this will accept the additional content from the schema data and another additional context from the historical dataset.";
  assert.equal(
    parseExistingBoardFanIn(transcript, context({ selected: false })),
    null,
  );
  assert.equal(
    parseExistingBoardFanIn(
      transcript,
      context({
        extraObjects: [
          {
            label: "Schema Archive",
            nodeType: "database",
            ordinal: 3,
            selected: false,
          },
        ],
      }),
    ),
    null,
  );
});

test("emits only the missing relationship and never duplicates an existing edge", () => {
  const plan = parseExistingBoardFanIn(
    "Planner receives additional context from Golden Dataset and Historical Dataset",
    context({
      edges: [
        {
          from: { label: "Golden Dataset", nodeType: "database", ordinal: 1 },
          to: { label: "Planner", nodeType: "process", ordinal: 1 },
          label: "additional context",
          occurrence: 1,
        },
      ],
    }),
  );
  assert.deepEqual(compactActions(plan), [
    {
      type: "connect",
      from: "Historical Dataset",
      to: "Planner",
      label: "additional context",
    },
  ]);
});

test("grounds data and dataset morphology on a dense board without closed-world guessing", () => {
  const resolution = resolveExistingBoardFanIn(
    "Planner receives the additional context from the historical data and golden dataset.",
    context({
      selected: false,
      extraObjects: [
        { label: "Policy Store", nodeType: "database", ordinal: 3 },
        { label: "Feature Service", nodeType: "service", ordinal: 1 },
        { label: "Evaluation Runner", nodeType: "process", ordinal: 2 },
        { label: "Audit Queue", nodeType: "queue", ordinal: 1 },
        { label: "Schema Registry", nodeType: "database", ordinal: 4 },
      ],
    }),
  );
  assert.equal(resolution.status, "resolved");
  assert.deepEqual(compactActions(resolution.plan), [
    {
      type: "connect",
      from: "Historical Dataset",
      to: "Planner",
      label: "additional context",
    },
    {
      type: "connect",
      from: "Golden Dataset",
      to: "Planner",
      label: "additional context",
    },
  ]);
});

test("keeps fan-in resolution invariant under common courtesy and discourse prefixes", () => {
  for (const prefix of [
    "Please, ",
    "Could you please ",
    "Okay, so, ",
    "I mean, ",
    "At your convenience, ",
  ]) {
    const resolution = resolveExistingBoardFanIn(
      `${prefix}Planner receives the additional context from the historical data and golden dataset.`,
      context({ selected: false }),
    );
    assert.equal(resolution.status, "resolved", prefix);
    assert.equal(resolution.plan.actions.length, 2, prefix);
  }
});

test("fails closed when a data/dataset canonical source is not unique", () => {
  const resolution = resolveExistingBoardFanIn(
    "Planner receives additional context from Historical Datasets and Golden Dataset",
    context({
      extraObjects: [
        {
          label: "Historical Data",
          nodeType: "database",
          ordinal: 3,
        },
      ],
    }),
  );
  assert.equal(resolution.status, "unrecognized");
});

test("returns an explicit already-satisfied outcome without inventing an empty plan", () => {
  const edges = [
    {
      from: { label: "Golden Dataset" },
      to: { label: "Planner" },
      label: "additional context",
    },
    {
      from: { label: "Historical Dataset" },
      to: { label: "Planner" },
      label: "additional context",
    },
  ];
  const board = context({ selected: false, edges });
  const transcript =
    "Planner receives the additional context from the historical data and golden dataset.";
  const resolution = resolveExistingBoardFanIn(transcript, board);
  assert.deepEqual(resolution, {
    status: "already_satisfied",
    recipientLabel: "Planner",
    sourceLabels: ["Historical Dataset", "Golden Dataset"],
    relationLabel: "additional context",
  });
  assert.equal(parseExistingBoardFanIn(transcript, board), null);
});

test("trusts an exact visible Schema Data label instead of hard-coding an acoustic substitution", () => {
  const board = context({
    extraObjects: [
      {
        label: "Schema Data",
        nodeType: "database",
        ordinal: 3,
        selected: false,
      },
    ],
  });
  const plan = parseExistingBoardFanIn(
    "Planner gets additional context from Schema Data and Historical Dataset",
    board,
  );
  assert.deepEqual(compactActions(plan), [
    {
      type: "connect",
      from: "Schema Data",
      to: "Planner",
      label: "additional context",
    },
    {
      type: "connect",
      from: "Historical Dataset",
      to: "Planner",
      label: "additional context",
    },
  ]);
});
