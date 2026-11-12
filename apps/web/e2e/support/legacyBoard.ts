import { applyLegacyDiagramFixture, createInitialBoardState, type BoardEvent } from "@airboard/core";
import type { Page } from "@playwright/test";
import { withHooks } from "./testHooks";

/**
 * Puts a diagram on the open board as the legacy annotation strokes Airo drew
 * before shape-merge phase 1 (as a live-session peer on an older client
 * would send them), for specs about behaviour only legacy content has, such
 * as repairing a line pulled off its shapes. Nothing in the app makes legacy
 * strokes any more.
 */
export async function seedLegacyDiagram(
  page: Page,
  diagram: {
    nodes: Array<{ id: string; label: string; center: { x: number; y: number }; nodeType?: "service" | "database" | "api" | "user" }>;
    edges?: Array<{ id: string; from: string; to: string; label?: string }>;
  },
): Promise<void> {
  const boardId = await withHooks(page, (hooks) => hooks.getCanonicalBoardState().boardId);
  let counter = 0;
  const context = {
    boardSessionId: boardId,
    actorParticipantId: "participant:older-client",
    userId: "user:older-client",
    createdAt: "2026-10-01T09:00:00.000Z",
    eventIdFactory: () => `event:legacy-seed:${Date.now()}:${++counter}`,
  };
  let state = createInitialBoardState(boardId);
  const events: BoardEvent[] = [];
  for (const node of diagram.nodes) {
    const result = applyLegacyDiagramFixture(state, {
      type: "node.create", nodeId: node.id, nodeType: node.nodeType ?? "service", label: node.label,
      center: node.center, source: "voice", style: { strokeColor: "#111827" },
    }, context);
    state = result.state;
    events.push(...result.events);
  }
  for (const edge of diagram.edges ?? []) {
    const result = applyLegacyDiagramFixture(state, {
      type: "nodes.connect", connectorId: edge.id, fromId: edge.from, toId: edge.to,
      ...(edge.label ? { label: edge.label } : {}), source: "voice",
    }, context);
    state = result.state;
    events.push(...result.events);
  }
  for (const event of events) {
    await withHooks(page, (hooks, item) => hooks.emitRemoteBoardEvent(item), event);
  }
}
