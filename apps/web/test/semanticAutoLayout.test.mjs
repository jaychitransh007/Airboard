import assert from "node:assert/strict";
import test from "node:test";

import {
  applyDiagramCommand,
  createInitialBoardState,
  nodeVisualDefaultSize,
} from "@airboard/core";
import {
  computeSemanticAutoLayout,
  SEMANTIC_AUTO_LAYOUT_GAP,
} from "../src/features/board/semanticAutoLayout.ts";

const BOARD_ID = "semantic-layout-test";
const handle = (value) => ({ kind: "plan_handle", handle: value });
const autoCreate = (handleValue, nodeType, label = handleValue) => ({
  type: "create",
  nodeType,
  label,
  handle: handleValue,
  placement: { kind: "auto" },
});

function boundsFor(centers, handleValue, nodeType) {
  const center = centers.get(handleValue);
  assert.ok(center, `missing center for ${handleValue}`);
  const size = nodeVisualDefaultSize(nodeType);
  return {
    x: center.x - size.width / 2,
    y: center.y - size.height / 2,
    width: size.width,
    height: size.height,
  };
}

function unionBounds(bounds) {
  const left = Math.min(...bounds.map((value) => value.x));
  const top = Math.min(...bounds.map((value) => value.y));
  const right = Math.max(
    ...bounds.map((value) => value.x + value.width),
  );
  const bottom = Math.max(
    ...bounds.map((value) => value.y + value.height),
  );
  return { x: left, y: top, width: right - left, height: bottom - top };
}

test("condenses the authentication round trip and ranks its branch downstream", () => {
  const actions = [
    autoCreate("user", "user", "User"),
    autoCreate(
      "authentication",
      "service",
      "Airboard Authentication Service",
    ),
    autoCreate("airboard", "custom", "Airboard"),
    {
      type: "branch",
      from: handle("user"),
      branches: [
        { to: handle("authentication"), label: "request" },
        { to: handle("airboard"), label: "lands on" },
      ],
    },
    {
      type: "connect",
      from: handle("authentication"),
      to: handle("user"),
      label: "authenticates",
    },
  ];

  const centers = computeSemanticAutoLayout({
    actions,
    boardState: createInitialBoardState(BOARD_ID),
    canvasWidth: 900,
    canvasHeight: 600,
  });
  const user = centers.get("user");
  const authentication = centers.get("authentication");
  const airboard = centers.get("airboard");
  assert.ok(user && authentication && airboard);

  assert.equal(
    user.x,
    authentication.x,
    "the reciprocal pair belongs to one SCC/rank",
  );
  assert.ok(
    airboard.x > user.x,
    "the downstream branch advances left-to-right",
  );

  const userBounds = boundsFor(centers, "user", "user");
  const authenticationBounds = boundsFor(
    centers,
    "authentication",
    "service",
  );
  assert.equal(
    authenticationBounds.y -
      (userBounds.y + userBounds.height),
    SEMANTIC_AUTO_LAYOUT_GAP,
    "same-rank nodes retain the declared vertical clear space",
  );

  const diagramBounds = unionBounds([
    userBounds,
    authenticationBounds,
    boundsFor(centers, "airboard", "custom"),
  ]);
  assert.equal(
    diagramBounds.x + diagramBounds.width / 2,
    450,
    "the complete graph, rather than individual nodes, is centered",
  );
  assert.equal(diagramBounds.y + diagramBounds.height / 2, 300);
});

test("lays a four-step narrative out in stable left-to-right ranks", () => {
  const actions = [
    autoCreate("user", "user", "User"),
    autoCreate("airboard", "service", "Airboard"),
    autoCreate("authentication", "service", "Authentication Service"),
    autoCreate("page", "custom", "Airboard Page"),
    {
      type: "connect",
      from: handle("user"),
      to: handle("airboard"),
      label: "request",
    },
    {
      type: "connect",
      from: handle("airboard"),
      to: handle("authentication"),
      label: "triggers",
    },
    {
      type: "connect",
      from: handle("authentication"),
      to: handle("page"),
      label: "redirects",
    },
  ];

  const centers = computeSemanticAutoLayout({
    actions,
    boardState: createInitialBoardState(BOARD_ID),
    canvasWidth: 1_200,
    canvasHeight: 800,
    viewOrigin: { x: 100, y: 50 },
  });
  const ordered = [
    ["user", "user"],
    ["airboard", "service"],
    ["authentication", "service"],
    ["page", "custom"],
  ];
  const bounds = ordered.map(([handleValue, nodeType]) =>
    boundsFor(centers, handleValue, nodeType),
  );

  for (let index = 1; index < bounds.length; index += 1) {
    const previous = bounds[index - 1];
    const current = bounds[index];
    assert.ok(previous && current);
    assert.equal(
      current.x - (previous.x + previous.width),
      SEMANTIC_AUTO_LAYOUT_GAP,
      `rank ${index + 1} has a size-aware horizontal gap`,
    );
    assert.equal(
      centers.get(ordered[index - 1][0]).y,
      centers.get(ordered[index][0]).y,
      "single-node ranks share one center line",
    );
  }

  const diagramBounds = unionBounds(bounds);
  assert.equal(
    diagramBounds.x + diagramBounds.width / 2,
    700,
    "viewOrigin participates in whole-layout centering",
  );
  assert.equal(diagramBounds.y + diagramBounds.height / 2, 450);
});

test("shifts the complete block away from an existing node without distortion", () => {
  let boardState = createInitialBoardState(BOARD_ID);
  boardState = applyDiagramCommand(
    boardState,
    {
      type: "node.create",
      nodeId: "existing",
      nodeType: "note",
      label: "Existing",
      center: { x: 450, y: 300 },
    },
    {
      boardSessionId: BOARD_ID,
      actorParticipantId: "participant",
      userId: "user",
      createdAt: "2026-07-30T00:00:00.000Z",
    },
  ).state;
  const actions = [
    autoCreate("user", "user"),
    autoCreate("service", "service"),
    {
      type: "connect",
      from: handle("user"),
      to: handle("service"),
      label: null,
    },
  ];

  const centers = computeSemanticAutoLayout({
    actions,
    boardState,
    canvasWidth: 900,
    canvasHeight: 600,
  });
  const block = unionBounds([
    boundsFor(centers, "user", "user"),
    boundsFor(centers, "service", "service"),
  ]);
  const existing = boardState.strokes.existing.annotation.bounds;
  assert.ok(existing);
  const horizontallyClear =
    block.x + block.width <= existing.x - SEMANTIC_AUTO_LAYOUT_GAP ||
    block.x >= existing.x + existing.width + SEMANTIC_AUTO_LAYOUT_GAP;
  const verticallyClear =
    block.y + block.height <= existing.y - SEMANTIC_AUTO_LAYOUT_GAP ||
    block.y >= existing.y + existing.height + SEMANTIC_AUTO_LAYOUT_GAP;
  assert.ok(
    horizontallyClear || verticallyClear,
    "the whole auto-layout block clears existing node bounds",
  );
  assert.equal(
    centers.get("service").x - centers.get("user").x,
    nodeVisualDefaultSize("user").width / 2 +
      SEMANTIC_AUTO_LAYOUT_GAP +
      nodeVisualDefaultSize("service").width / 2,
    "obstacle avoidance translates rather than distorts the layout",
  );
});
