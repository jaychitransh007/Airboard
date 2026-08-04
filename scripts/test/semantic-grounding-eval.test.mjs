import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  evaluateGroundedSemanticPlan,
  seedBoardFromSemanticContext,
  validateGroundedSemanticOutcome,
} from "../lib/semantic-grounding-eval.mjs";

const emptyContext = {
  selectionCount: 0,
  selected: [],
  objects: [],
  edges: [],
  projectGlossary: [],
  pointerAvailable: false,
};

test("semantic eval uses production grounding, atomic commit, and one-step Undo", () => {
  const result = evaluateGroundedSemanticPlan(
    {
      version: "1.1",
      status: "resolved",
      issueCode: "none",
      clarificationQuestion: null,
      missingSlots: [],
      actions: [
        {
          type: "create",
          nodeType: "api",
          label: "Orders API",
          handle: "orders-api",
          placement: { kind: "auto" },
        },
        {
          type: "create",
          nodeType: "database",
          label: "Orders DB",
          handle: "orders-db",
          placement: { kind: "auto" },
        },
        {
          type: "connect",
          from: { kind: "plan_handle", handle: "orders-api" },
          to: { kind: "plan_handle", handle: "orders-db" },
          label: "writes",
        },
      ],
    },
    emptyContext,
  );

  assert.equal(result.status, "applied");
  assert.equal(result.mutationApplied, true);
  assert.equal(result.commands.length, 3);
  assert.equal(result.eventDelta.length, 6);
  assert.deepEqual(
    {
      nodes: result.effects.nodeCountDelta,
      edges: result.effects.edgeCountDelta,
    },
    { nodes: 2, edges: 1 },
  );
  assert.equal(result.undo.applicable, true);
  assert.equal(result.undo.roundTripPassed, true);
  assert.deepEqual(
    validateGroundedSemanticOutcome(
      result,
      {
        finalState: {
          nodeCountDelta: 2,
          edgeCountDelta: 1,
          requiredNodes: [
            { label: "Orders API", nodeType: "api" },
            { label: "Orders DB", nodeType: "database" },
          ],
          requiredEdges: [
            {
              from: { label: "Orders API", nodeType: "api" },
              to: { label: "Orders DB", nodeType: "database" },
              label: "writes",
            },
          ],
        },
      },
      "resolved",
    ),
    [],
  );
});

test("current_selection remains the request-time target across a multi-action plan", () => {
  const planner = {
    label: "Planner",
    nodeType: "process",
    ordinal: 1,
    selected: true,
    position: { x: 620, y: 260 },
    size: { width: 180, height: 92 },
  };
  const context = {
    ...emptyContext,
    selectionCount: 1,
    selected: [planner],
    objects: [
      {
        label: "Golden Dataset",
        nodeType: "database",
        ordinal: 1,
        selected: false,
        position: { x: 220, y: 140 },
        size: { width: 180, height: 92 },
      },
      {
        label: "Historical Dataset",
        nodeType: "database",
        ordinal: 2,
        selected: false,
        position: { x: 220, y: 380 },
        size: { width: 180, height: 92 },
      },
      planner,
    ],
  };
  const result = evaluateGroundedSemanticPlan(
    {
      version: "1.1",
      status: "resolved",
      issueCode: "none",
      clarificationQuestion: null,
      missingSlots: [],
      actions: [
        {
          type: "connect",
          from: {
            kind: "visible_label",
            label: "Golden Dataset",
            occurrence: 1,
          },
          to: { kind: "current_selection" },
          label: "additional context",
        },
        {
          type: "connect",
          from: {
            kind: "visible_label",
            label: "Historical Dataset",
            occurrence: 1,
          },
          to: { kind: "current_selection" },
          label: "additional context",
        },
      ],
    },
    context,
  );

  assert.equal(result.status, "applied");
  assert.equal(result.effects.edgeCountDelta, 2);
  assert.equal(result.undo.roundTripPassed, true);
  assert.deepEqual(
    validateGroundedSemanticOutcome(
      result,
      {
        selectionCount: 2,
        finalState: {
          nodeCountDelta: 0,
          edgeCountDelta: 2,
          requiredEdges: [
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
          ],
        },
      },
      "resolved",
    ),
    [],
  );
});

test("Data/Dataset repair reaches the exact final graph and remains one-step undoable", () => {
  const context = {
    ...emptyContext,
    objects: [
      {
        label: "Historical Dataset",
        nodeType: "database",
        ordinal: 1,
        position: { x: 180, y: 120 },
        size: { width: 180, height: 92 },
      },
      {
        label: "Golden Dataset",
        nodeType: "database",
        ordinal: 2,
        position: { x: 180, y: 360 },
        size: { width: 180, height: 92 },
      },
      {
        label: "Planner",
        nodeType: "process",
        ordinal: 1,
        position: { x: 560, y: 240 },
        size: { width: 180, height: 92 },
      },
    ],
  };
  const result = evaluateGroundedSemanticPlan(
    {
      version: "1.1",
      status: "resolved",
      issueCode: "none",
      clarificationQuestion: null,
      missingSlots: [],
      actions: [
        {
          type: "connect",
          from: {
            kind: "visible_label",
            label: "Historical Data",
            occurrence: null,
          },
          to: {
            kind: "visible_label",
            label: "Planner",
            occurrence: null,
          },
          label: "additional context",
        },
        {
          type: "connect",
          from: {
            kind: "visible_label",
            label: "Golden Dataset",
            occurrence: null,
          },
          to: {
            kind: "visible_label",
            label: "Planner",
            occurrence: null,
          },
          label: "additional context",
        },
      ],
    },
    context,
  );
  assert.equal(result.status, "applied");
  assert.equal(result.eventDelta.length, 4);
  assert.equal(result.undo.applicable, true);
  assert.equal(result.undo.roundTripPassed, true);
  assert.deepEqual(
    validateGroundedSemanticOutcome(
      result,
      {
        selectionCount: 2,
        finalState: {
          nodeCountDelta: 0,
          edgeCountDelta: 2,
          requiredEdges: [
            {
              from: { label: "Historical Dataset" },
              to: { label: "Planner" },
              label: "additional context",
            },
            {
              from: { label: "Golden Dataset" },
              to: { label: "Planner" },
              label: "additional context",
            },
          ],
        },
      },
      "resolved",
    ),
    [],
  );

  const destructive = evaluateGroundedSemanticPlan(
    {
      version: "1.1",
      status: "resolved",
      issueCode: "none",
      clarificationQuestion: null,
      missingSlots: [],
      actions: [
        {
          type: "delete",
          targets: [
            {
              kind: "visible_label",
              label: "Historical Data",
              occurrence: null,
            },
          ],
        },
      ],
    },
    context,
  );
  assert.equal(destructive.status, "grounding_failed");
  assert.equal(destructive.mutationApplied, false);
  assert.deepEqual(destructive.eventDelta, []);
});

test("ambiguous references fail closed before any board event escapes", () => {
  const context = {
    ...emptyContext,
    objects: [
      {
        label: "API",
        nodeType: "api",
        ordinal: 1,
        position: { x: 100, y: 100 },
        size: { width: 120, height: 60 },
      },
      {
        label: "API",
        nodeType: "api",
        ordinal: 2,
        position: { x: 300, y: 100 },
        size: { width: 120, height: 60 },
      },
    ],
  };
  const result = evaluateGroundedSemanticPlan(
    {
      version: "1.1",
      status: "resolved",
      issueCode: "none",
      clarificationQuestion: null,
      missingSlots: [],
      actions: [
        {
          type: "rename",
          target: {
            kind: "visible_label",
            label: "API",
            occurrence: null,
          },
          label: "Gateway",
        },
      ],
    },
    context,
  );

  assert.equal(result.status, "grounding_failed");
  assert.equal(result.mutationApplied, false);
  assert.deepEqual(result.eventDelta, []);
  assert.match(result.groundingError, /matches 2 objects/u);
});

test("parallel connector occurrence is retained in deleted-edge effects", () => {
  const context = {
    ...emptyContext,
    objects: [
      {
        label: "API",
        nodeType: "api",
        ordinal: 1,
        position: { x: 100, y: 100 },
        size: { width: 120, height: 60 },
      },
      {
        label: "DB",
        nodeType: "database",
        ordinal: 1,
        position: { x: 300, y: 100 },
        size: { width: 120, height: 60 },
      },
    ],
    edges: [
      {
        from: { label: "API", nodeType: "api", ordinal: 1 },
        to: { label: "DB", nodeType: "database", ordinal: 1 },
        label: "primary",
        occurrence: 1,
      },
      {
        from: { label: "API", nodeType: "api", ordinal: 1 },
        to: { label: "DB", nodeType: "database", ordinal: 1 },
        label: "backup",
        occurrence: 2,
      },
    ],
  };
  const result = evaluateGroundedSemanticPlan(
    {
      version: "1.1",
      status: "resolved",
      issueCode: "none",
      clarificationQuestion: null,
      missingSlots: [],
      actions: [
        {
          type: "delete_connection",
          connection: {
            from: {
              kind: "visible_label",
              label: "API",
              occurrence: null,
            },
            to: {
              kind: "visible_label",
              label: "DB",
              occurrence: null,
            },
            label: null,
            occurrence: 2,
          },
        },
      ],
    },
    context,
  );

  assert.equal(result.status, "applied");
  assert.equal(result.effects.deletedEdges.length, 1);
  assert.equal(result.effects.deletedEdges[0].label, "backup");
  assert.equal(result.effects.deletedEdges[0].occurrence, 2);
  assert.equal(result.undo.roundTripPassed, true);
});

test("clarification and unsupported plans are mutation-free", () => {
  for (const status of ["clarification", "unsupported"]) {
    const result = evaluateGroundedSemanticPlan(
      {
        version: "1.1",
        status,
        issueCode:
          status === "clarification"
            ? "ambiguous_reference"
            : "not_board_command",
        clarificationQuestion:
          status === "clarification" ? "Which API?" : null,
        missingSlots:
          status === "clarification" ? ["object_reference"] : [],
        actions: [],
      },
      emptyContext,
    );
    assert.equal(result.status, "not_applied");
    assert.equal(result.mutationApplied, false);
    assert.deepEqual(result.eventDelta, []);
    assert.equal(result.undo.roundTripPassed, true);
  }
});

test("new independent action seeds ground to their exact final-state and selection oracles", async () => {
  const source = JSON.parse(
    await readFile(
      new URL("../../evals/voice-intent/v1.json", import.meta.url),
      "utf8",
    ),
  );
  const byId = new Map(source.cases.map((entry) => [entry.id, entry]));
  const resolved = (actions) => ({
    version: "1.1",
    status: "resolved",
    issueCode: "none",
    clarificationQuestion: null,
    missingSlots: [],
    actions,
  });
  const plans = new Map([
    [
      "duplicate-current-selection-right",
      resolved([
        {
          type: "duplicate",
          targets: [{ kind: "current_selection" }],
          placement: {
            kind: "offset",
            direction: "right",
            distance: "small",
          },
        },
      ]),
    ],
    [
      "move-current-selection-to-pointer",
      resolved([
        {
          type: "move",
          targets: [{ kind: "current_selection" }],
          placement: { kind: "pointer" },
        },
      ]),
    ],
    [
      "align-current-selection-left",
      resolved([
        {
          type: "align",
          targets: [{ kind: "current_selection" }],
          alignment: "left",
        },
      ]),
    ],
    [
      "distribute-current-selection-horizontal",
      resolved([
        {
          type: "distribute",
          targets: [{ kind: "current_selection" }],
          axis: "horizontal",
        },
      ]),
    ],
    [
      "layout-current-selection-grid",
      resolved([
        {
          type: "layout",
          targets: [{ kind: "current_selection" }],
          direction: "grid",
        },
      ]),
    ],
    [
      "group-current-selection",
      resolved([
        {
          type: "group",
          targets: [{ kind: "current_selection" }],
          label: "Checkout Services",
          handle: "checkout-services",
        },
      ]),
    ],
    [
      "select-second-service-by-ordinal",
      resolved([
        {
          type: "select",
          targets: [
            {
              kind: "type_ordinal",
              nodeType: "service",
              ordinal: 2,
            },
          ],
          mode: "replace",
        },
      ]),
    ],
    ["undo-last-board-change", resolved([{ type: "undo" }])],
    ["cancel-pending-board-command", resolved([{ type: "cancel" }])],
    [
      "stale-destructive-target-rejected",
      {
        version: "1.1",
        status: "clarification",
        issueCode: "missing_context",
        clarificationQuestion:
          "Payments API is not on the current board. Which object should I delete?",
        missingSlots: ["object_reference"],
        actions: [],
      },
    ],
  ]);

  for (const [caseId, plan] of plans) {
    const sourceCase = byId.get(caseId);
    assert.ok(sourceCase, `missing source case ${caseId}`);
    const grounded = evaluateGroundedSemanticPlan(
      plan,
      sourceCase.context,
    );
    assert.deepEqual(
      validateGroundedSemanticOutcome(
        grounded,
        sourceCase.expected,
        sourceCase.expected.status,
      ),
      [],
      caseId,
    );
  }
});

test("semantic board seeding rejects dangling edge references", () => {
  assert.throws(
    () =>
      seedBoardFromSemanticContext({
        ...emptyContext,
        edges: [
          {
            from: { label: "Missing", nodeType: "api", ordinal: 1 },
            to: { label: "Also missing", nodeType: "database", ordinal: 1 },
            occurrence: 1,
          },
        ],
      }),
    /absent from context\.objects/u,
  );
});

test("reported Airboard narrative plans satisfy the shared spatial oracle", async () => {
  const corpus = JSON.parse(
    await readFile(
      new URL("../../evals/audio/stt-scenarios.v1.json", import.meta.url),
      "utf8",
    ),
  );
  const caseIds = [
    "fake-ptt-airboard-brand-narrative-flow",
    "fake-ptt-airboard-authentication-round-trip-flow",
  ];

  for (const caseId of caseIds) {
    const scenario = corpus.scenarios.find(({ id }) => id === caseId);
    assert.ok(scenario, `missing audio regression ${caseId}`);
    const grounded = evaluateGroundedSemanticPlan(
      scenario.source.semanticPlan,
      scenario.context,
    );
    assert.deepEqual(
      validateGroundedSemanticOutcome(
        grounded,
        { finalState: scenario.finalState },
        scenario.oracle.expectedSemanticStatus,
      ),
      [],
      caseId,
    );
  }
});
