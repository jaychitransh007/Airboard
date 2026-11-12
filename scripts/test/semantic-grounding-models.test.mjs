import assert from "node:assert/strict";
import { test } from "node:test";

import {
  applyBoardEvent,
  applyDiagramCommand,
  createBoardSceneElement,
  createEventEnvelope,
  createInitialBoardState,
  createRichTextDocument,
} from "../../packages/core/src/index.ts";
import { deriveBoardEffects } from "../lib/semantic-grounding-eval.mjs";

// The grounding eval reads the model-independent diagram graph, so its board
// effects (node and edge lists, deletions, spatial facts) don't change when
// Airo draws v2 scene elements instead of legacy annotation strokes.

let eventCount = 0;
const context = {
  boardSessionId: "board",
  actorParticipantId: "participant",
  userId: "user",
  createdAt: "2026-11-12T00:00:00.000Z",
  eventIdFactory: () => `event-${++eventCount}`,
};
const NODES = [
  { id: "customer", nodeType: "user", label: "Customer", bounds: { x: 100, y: 100, width: 160, height: 92 } },
  { id: "api", nodeType: "api", label: "Orders API", bounds: { x: 420, y: 100, width: 180, height: 92 } },
];

function legacyBoard() {
  let state = createInitialBoardState("board");
  for (const node of NODES) {
    state = applyDiagramCommand(state, { type: "node.create", nodeId: node.id, nodeType: node.nodeType, label: node.label, bounds: node.bounds, source: "voice" }, context).state;
  }
  return applyDiagramCommand(state, { type: "nodes.connect", connectorId: "order", fromId: "customer", toId: "api", label: "order request" }, context).state;
}

function sceneBoard() {
  let state = createInitialBoardState("board");
  for (const node of NODES) {
    state = applyBoardEvent(state, {
      ...createEventEnvelope({ boardSessionId: "board", actorParticipantId: "participant" }),
      type: "element.created",
      element: createBoardSceneElement({
        id: node.id,
        boardId: "board",
        kind: "shape",
        shapeKind: node.nodeType,
        transform: { ...node.bounds, rotation: 0 },
        content: createRichTextDocument(node.label, `${node.id}:content`),
      }),
    });
  }
  return applyDiagramCommand(state, { type: "scene.connect", connectorId: "order", fromId: "customer", toId: "api", label: "order request" }, context).state;
}

function modelFree(effects) {
  return {
    nodeCountDelta: effects.nodeCountDelta,
    edgeCountDelta: effects.edgeCountDelta,
    finalNodes: effects.finalNodes,
    finalEdges: effects.finalEdges,
    deletedNodes: effects.deletedNodes,
    deletedEdges: effects.deletedEdges,
    spatialNodes: effects.spatialFacts.nodes,
    nodePairs: effects.spatialFacts.nodePairs,
    connectorNodeIntersections: effects.spatialFacts.connectorNodeIntersections,
  };
}

test("board effects are the same for a legacy diagram and its v2 twin", () => {
  const empty = createInitialBoardState("board");
  const legacy = deriveBoardEffects(empty, legacyBoard());
  const scene = deriveBoardEffects(empty, sceneBoard());
  assert.deepEqual(modelFree(scene), modelFree(legacy));
  assert.equal(legacy.nodeCountDelta, 2);
  assert.equal(legacy.edgeCountDelta, 1);
  assert.deepEqual(legacy.finalEdges.map(({ label, from, to, geometryAttached }) => ({ label, from: from?.label, to: to?.label, geometryAttached })), [
    { label: "order request", from: "Customer", to: "Orders API", geometryAttached: true },
  ]);
});

test("a mixed board counts a legacy node and a typed v2 node once each", () => {
  let state = createInitialBoardState("board");
  state = applyDiagramCommand(state, { type: "node.create", nodeId: "customer", nodeType: "user", label: "Customer", bounds: NODES[0].bounds, source: "voice" }, context).state;
  const before = state;
  state = applyBoardEvent(state, {
    ...createEventEnvelope({ boardSessionId: "board", actorParticipantId: "participant" }),
    type: "element.created",
    element: createBoardSceneElement({
      id: "api",
      boardId: "board",
      kind: "shape",
      shapeKind: "api",
      transform: { ...NODES[1].bounds, rotation: 0 },
      content: createRichTextDocument("Orders API", "api:content"),
    }),
  });
  state = applyDiagramCommand(state, { type: "scene.connect", connectorId: "order", fromId: "customer", toId: "api" }, context).state;
  const effects = deriveBoardEffects(before, state);
  assert.equal(effects.nodeCountDelta, 1, "the legacy node's scene mirror isn't counted");
  assert.equal(effects.edgeCountDelta, 1);
  assert.deepEqual(effects.finalNodes.map(({ label, nodeType }) => ({ label, nodeType })), [
    { label: "Customer", nodeType: "user" },
    { label: "Orders API", nodeType: "api" },
  ]);
  assert.equal(effects.finalEdges[0].from.label, "Customer");
  assert.equal(effects.finalEdges[0].geometryAttached, true);
});
