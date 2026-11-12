import { expect, test, type Page } from "@playwright/test";
import { byLabel, standInForAiro } from "./support/airoStandIn";
import { boardFingerprint, type BoardFingerprint } from "./support/boardFingerprint";
import {
  boardToCanvas,
  canvasSize,
  carryFromDock,
  grabAndMove,
  pageNow,
} from "./support/handLandmarks";
import { signIn, type StandInControlPlane } from "./support/signedInApi";
import { withHooks } from "./support/testHooks";

/**
 * The golden journey: one realistic session on a saved board, driven through
 * every way the board changes today (typed commands, Airo's plan, undo/redo,
 * a spoken command, the hand, a live-session peer), with the diagram checked
 * after each stretch as a model-independent fingerprint (labels, kinds,
 * colours, connections, groups, rough layout order; no ids or coordinates).
 *
 * It guards the board-file split and the shape-model merge: a refactor that
 * claims "no behaviour change" must leave every fingerprint below identical.
 * After each stretch the board the API last saved must give the same
 * fingerprint, so persistence is checked along the way.
 *
 * To re-record after an intended behaviour change, run with
 * AIRBOARD_GOLDEN_PRINT=1 and review every changed line by hand.
 */

const PRINT = process.env.AIRBOARD_GOLDEN_PRINT === "1";
const UNDO = process.platform === "darwin" ? "Meta+z" : "Control+z";
const REDO = process.platform === "darwin" ? "Meta+Shift+z" : "Control+Shift+z";

test.beforeEach(async ({ context }) => {
  await context.addInitScript(() => window.localStorage.setItem("airboard.onboarding.v1", "done"));
});

async function run(page: Page, command: string) {
  await page.getByTestId("intent-command-input").fill(command);
  await page.getByTestId("intent-primary-action").click();
  await expect(page.locator(".intent-feedback")).toContainText("Applied:", { timeout: 15_000 });
}

async function liveFingerprint(page: Page): Promise<BoardFingerprint> {
  return boardFingerprint(await withHooks(page, (hooks) => hooks.getCanonicalBoardState()));
}

function savedFingerprint(api: StandInControlPlane): BoardFingerprint | null {
  const latest = api.saves.at(-1);
  return latest ? boardFingerprint(latest.state as Parameters<typeof boardFingerprint>[0]) : null;
}

/** The live board settles on `expected`, and the saved board catches up to it. */
async function checkpoint(page: Page, api: StandInControlPlane, name: string, expected: BoardFingerprint) {
  if (PRINT) {
    await page.waitForTimeout(2_000);
    const live = await liveFingerprint(page);
    console.log(`checkpoint ${name}: ${JSON.stringify(live)}`);
    expected = live;
  }
  await expect.poll(() => liveFingerprint(page), { message: `live board at ${name}`, timeout: 10_000 }).toEqual(expected);
  await expect
    .poll(() => savedFingerprint(api), { message: `saved board at ${name}`, timeout: 10_000 })
    .toEqual(expected);
}

const node = (label: string, kind: string, fill: string | null, group: string | null = null) => ({
  label,
  kind,
  fill,
  group,
});
const edge = (from: string, to: string, label = "") => ({ from, to, label });

test("golden journey: typed, Airo, undo/redo, voice, hand and peer edits give the recorded board", async ({
  page,
}) => {
  const api = await signIn(page, { boards: [{ title: "Golden journey", state: { elements: {} } }] });
  const airo = await standInForAiro(page);
  await page.goto(`/app/boards/${api.boardId("Golden journey")}`);
  await expect(page.getByTestId("share-board")).toBeVisible({ timeout: 30_000 });

  // 1. Typed commands create one shape of each kind.
  await run(page, "add a user named Shopper");
  await run(page, "add a service named Checkout right of selected");
  await run(page, "add a database named Orders right of selected");
  await run(page, "add a queue named Events below selected");
  await run(page, "add a decision named Paid below selected");
  await run(page, "add a sticky note saying Ship it");
  await run(page, "add a text saying Release plan");
  await checkpoint(page, api, "typed shapes", GOLDEN.typedShapes);

  // 2. Typed connect, rename, recolour and move.
  await run(page, "connect Shopper to Checkout");
  await run(page, "connect Checkout to Orders");
  await run(page, "rename Orders to Orders DB");
  await run(page, "make Checkout red");
  await run(page, "move Events right");
  await checkpoint(page, api, "typed edits", GOLDEN.typedEdits);

  // 3. Airo's plan: a new shape, a labelled connection, and a group.
  airo.nextPlan([
    { type: "create", nodeType: "database", label: "Ledger", handle: "db_1", placement: { kind: "auto" } },
    { type: "connect", from: byLabel("Orders DB"), to: { kind: "plan_handle", handle: "db_1" }, label: "writes to" },
    { type: "group", targets: [byLabel("Checkout"), byLabel("Orders DB")], label: "Backend", handle: "g_1" },
  ]);
  await run(page, "could you add a ledger the orders write to and box checkout and orders up as the backend");
  await checkpoint(page, api, "Airo plan", GOLDEN.airoPlan);

  // 4. Undo takes the whole plan back in one step; redo brings it back.
  await page.keyboard.press(UNDO);
  await checkpoint(page, api, "undo", GOLDEN.typedEdits);
  await page.keyboard.press(REDO);
  await checkpoint(page, api, "redo", GOLDEN.airoPlan);

  // 5. A spoken command, through the same routing a realtime session uses.
  const routed = await withHooks(page, (hooks) => hooks.emitFinalTranscript("Airo, rename Shopper to Buyer"));
  expect(routed).toMatchObject({ routed: true, wakeDetected: true });
  await checkpoint(page, api, "voice rename", GOLDEN.voiceRename);

  // 6. The hand: grab the decision and carry it left of everything...
  const canvas = await canvasSize(page);
  const paid = await shapeCentre(page, "Paid");
  const from = await boardToCanvas(page, paid);
  let t = await pageNow(page);
  t = await grabAndMove(page, canvas, from, { x: 60, y: from.y }, t);
  await checkpoint(page, api, "hand move", GOLDEN.handMove);

  // ...then carry a square out of the dock and name it.
  const placed = await carryFromDock(page, canvas, "Square", { x: canvas.width * 0.3, y: canvas.height * 0.2 }, t + 500);
  expect(placed).toBe(true);
  await run(page, "rename selected to Hand placed");
  await checkpoint(page, api, "hand placed", GOLDEN.handPlaced);

  // 7. A live-session peer recolours the sticky.
  await withHooks(page, (hooks) => {
    const state = hooks.getCanonicalBoardState();
    const sticky = Object.values(state.elements).find(
      (element) => element.kind === "sticky" && element.status === "active",
    )!;
    hooks.emitRemoteBoardEvent({
      id: "event:golden-peer-recolour",
      boardSessionId: state.boardId,
      actorParticipantId: "participant:golden-peer",
      createdAt: "2026-11-12T09:00:00.000Z",
      type: "element.patched",
      elementId: sticky.id,
      patches: [{ op: "field.set", path: ["color"], value: "#bbf7d0" }],
      baseRevision: sticky.revision,
    });
  });
  await checkpoint(page, api, "peer edit", GOLDEN.peerEdit);

  // 8. Delete, by typed command.
  await run(page, "delete Release plan");
  await checkpoint(page, api, "delete", GOLDEN.final);

  // Airo was asked exactly once, and every save went through in order.
  expect(airo.requests).toHaveLength(1);
  expect(airo.unplanned).toEqual([]);
  const versions = api.saves.map((save) => save.version);
  expect(versions).toEqual([...versions].sort((left, right) => left - right));
  expect(new Set(versions).size).toBe(versions.length);
});

/** Board-space centre of the shape whose label is `label`. */
async function shapeCentre(page: Page, label: string) {
  const summary = await withHooks(page, (hooks) => hooks.getBoardSummary());
  const index = summary.labels.indexOf(label);
  expect(index, `a shape labelled ${label}`).toBeGreaterThanOrEqual(0);
  return summary.positions[index]!;
}

// Recorded on 12 November 2026 at 3082af5. Airo's Ledger has its node type's
// default fill (#f8fafc) while typed shapes are white. The shape merge must
// not change these fingerprints.
const GOLDEN: Record<
  "typedShapes" | "typedEdits" | "airoPlan" | "voiceRename" | "handMove" | "handPlaced" | "peerEdit" | "final",
  BoardFingerprint
> = {
  typedShapes: {
    nodes: [
      node("Checkout", "service", "#ffffff"),
      node("Events", "queue", "#ffffff"),
      node("Orders", "database", "#ffffff"),
      node("Paid", "diamond", "#ffffff"),
      node("Release plan", "text", null),
      node("Ship it", "sticky", "#fde68a"),
      node("Shopper", "user", "#ffffff"),
    ],
    edges: [],
    looseConnectors: 0,
    groups: [],
    layout: {
      leftToRight: ["Release plan", "Shopper", "Ship it", "Checkout", "Events", "Orders", "Paid"],
      topToBottom: ["Ship it", "Checkout", "Orders", "Release plan", "Shopper", "Events", "Paid"],
    },
  },
  typedEdits: {
    nodes: [
      node("Checkout", "service", "#ef4444"),
      node("Events", "queue", "#ffffff"),
      node("Orders DB", "database", "#ffffff"),
      node("Paid", "diamond", "#ffffff"),
      node("Release plan", "text", null),
      node("Ship it", "sticky", "#fde68a"),
      node("Shopper", "user", "#ffffff"),
    ],
    edges: [
      edge("Checkout", "Orders DB"),
      edge("Shopper", "Checkout"),
    ],
    looseConnectors: 0,
    groups: [],
    layout: {
      leftToRight: ["Release plan", "Shopper", "Ship it", "Checkout", "Orders DB", "Paid", "Events"],
      topToBottom: ["Ship it", "Checkout", "Orders DB", "Release plan", "Shopper", "Events", "Paid"],
    },
  },
  airoPlan: {
    nodes: [
      node("Checkout", "service", "#ef4444", "Backend"),
      node("Events", "queue", "#ffffff"),
      node("Ledger", "database", "#f8fafc"),
      node("Orders DB", "database", "#ffffff", "Backend"),
      node("Paid", "diamond", "#ffffff"),
      node("Release plan", "text", null),
      node("Ship it", "sticky", "#fde68a"),
      node("Shopper", "user", "#ffffff"),
    ],
    edges: [
      edge("Checkout", "Orders DB"),
      edge("Orders DB", "Ledger", "writes to"),
      edge("Shopper", "Checkout"),
    ],
    looseConnectors: 0,
    groups: [
      { label: "Backend", members: ["Checkout", "Orders DB"] },
    ],
    layout: {
      leftToRight: ["Release plan", "Shopper", "Ship it", "Checkout", "Ledger", "Orders DB", "Paid", "Events"],
      topToBottom: ["Ship it", "Checkout", "Orders DB", "Release plan", "Shopper", "Events", "Ledger", "Paid"],
    },
  },
  voiceRename: {
    nodes: [
      node("Buyer", "user", "#ffffff"),
      node("Checkout", "service", "#ef4444", "Backend"),
      node("Events", "queue", "#ffffff"),
      node("Ledger", "database", "#f8fafc"),
      node("Orders DB", "database", "#ffffff", "Backend"),
      node("Paid", "diamond", "#ffffff"),
      node("Release plan", "text", null),
      node("Ship it", "sticky", "#fde68a"),
    ],
    edges: [
      edge("Buyer", "Checkout"),
      edge("Checkout", "Orders DB"),
      edge("Orders DB", "Ledger", "writes to"),
    ],
    looseConnectors: 0,
    groups: [
      { label: "Backend", members: ["Checkout", "Orders DB"] },
    ],
    layout: {
      leftToRight: ["Release plan", "Buyer", "Ship it", "Checkout", "Ledger", "Orders DB", "Paid", "Events"],
      topToBottom: ["Ship it", "Buyer", "Checkout", "Orders DB", "Release plan", "Events", "Ledger", "Paid"],
    },
  },
  handMove: {
    nodes: [
      node("Buyer", "user", "#ffffff"),
      node("Checkout", "service", "#ef4444", "Backend"),
      node("Events", "queue", "#ffffff"),
      node("Ledger", "database", "#f8fafc"),
      node("Orders DB", "database", "#ffffff", "Backend"),
      node("Paid", "diamond", "#ffffff"),
      node("Release plan", "text", null),
      node("Ship it", "sticky", "#fde68a"),
    ],
    edges: [
      edge("Buyer", "Checkout"),
      edge("Checkout", "Orders DB"),
      edge("Orders DB", "Ledger", "writes to"),
    ],
    looseConnectors: 0,
    groups: [
      { label: "Backend", members: ["Checkout", "Orders DB"] },
    ],
    layout: {
      leftToRight: ["Release plan", "Paid", "Buyer", "Ship it", "Checkout", "Ledger", "Orders DB", "Events"],
      topToBottom: ["Ship it", "Buyer", "Checkout", "Orders DB", "Release plan", "Events", "Ledger", "Paid"],
    },
  },
  handPlaced: {
    nodes: [
      node("Buyer", "user", "#ffffff"),
      node("Checkout", "service", "#ef4444", "Backend"),
      node("Events", "queue", "#ffffff"),
      node("Hand placed", "square", "#ffffff"),
      node("Ledger", "database", "#f8fafc"),
      node("Orders DB", "database", "#ffffff", "Backend"),
      node("Paid", "diamond", "#ffffff"),
      node("Release plan", "text", null),
      node("Ship it", "sticky", "#fde68a"),
    ],
    edges: [
      edge("Buyer", "Checkout"),
      edge("Checkout", "Orders DB"),
      edge("Orders DB", "Ledger", "writes to"),
    ],
    looseConnectors: 0,
    groups: [
      { label: "Backend", members: ["Checkout", "Orders DB"] },
    ],
    layout: {
      leftToRight: ["Release plan", "Paid", "Hand placed", "Buyer", "Ship it", "Checkout", "Ledger", "Orders DB", "Events"],
      topToBottom: ["Hand placed", "Ship it", "Buyer", "Checkout", "Orders DB", "Release plan", "Events", "Ledger", "Paid"],
    },
  },
  peerEdit: {
    nodes: [
      node("Buyer", "user", "#ffffff"),
      node("Checkout", "service", "#ef4444", "Backend"),
      node("Events", "queue", "#ffffff"),
      node("Hand placed", "square", "#ffffff"),
      node("Ledger", "database", "#f8fafc"),
      node("Orders DB", "database", "#ffffff", "Backend"),
      node("Paid", "diamond", "#ffffff"),
      node("Release plan", "text", null),
      node("Ship it", "sticky", "#bbf7d0"),
    ],
    edges: [
      edge("Buyer", "Checkout"),
      edge("Checkout", "Orders DB"),
      edge("Orders DB", "Ledger", "writes to"),
    ],
    looseConnectors: 0,
    groups: [
      { label: "Backend", members: ["Checkout", "Orders DB"] },
    ],
    layout: {
      leftToRight: ["Release plan", "Paid", "Hand placed", "Buyer", "Ship it", "Checkout", "Ledger", "Orders DB", "Events"],
      topToBottom: ["Hand placed", "Ship it", "Buyer", "Checkout", "Orders DB", "Release plan", "Events", "Ledger", "Paid"],
    },
  },
  final: {
    nodes: [
      node("Buyer", "user", "#ffffff"),
      node("Checkout", "service", "#ef4444", "Backend"),
      node("Events", "queue", "#ffffff"),
      node("Hand placed", "square", "#ffffff"),
      node("Ledger", "database", "#f8fafc"),
      node("Orders DB", "database", "#ffffff", "Backend"),
      node("Paid", "diamond", "#ffffff"),
      node("Ship it", "sticky", "#bbf7d0"),
    ],
    edges: [
      edge("Buyer", "Checkout"),
      edge("Checkout", "Orders DB"),
      edge("Orders DB", "Ledger", "writes to"),
    ],
    looseConnectors: 0,
    groups: [
      { label: "Backend", members: ["Checkout", "Orders DB"] },
    ],
    layout: {
      leftToRight: ["Paid", "Hand placed", "Buyer", "Ship it", "Checkout", "Ledger", "Orders DB", "Events"],
      topToBottom: ["Hand placed", "Ship it", "Buyer", "Checkout", "Orders DB", "Events", "Ledger", "Paid"],
    },
  },
};
