import assert from "node:assert/strict";
import test from "node:test";

import { prepareDurableBoard } from "../src/features/product/boardPreparation.ts";
import { AirboardApiError } from "../src/platform/api.ts";

const BOARD = { id: "board-1", latest_version: 4 };

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}

/** Records each call as it starts; `respond` decides each answer. */
function fakeApi(respond) {
  const calls = [];
  const api = (path, init = {}) => {
    calls.push(`${init.method ?? "GET"} ${path}`);
    return respond(path, init);
  };
  return { api, calls };
}

test("a saved board loads alongside the account and skips activation once the trial has started", async () => {
  const account = deferred();
  let refreshed = 0;
  // The preflight never answers: the board must not wait on a record.
  const { api, calls } = fakeApi((path) => (path === `/boards/${BOARD.id}` ? Promise.resolve({ board: BOARD }) : new Promise(() => {})));

  const preparing = prepareDurableBoard(BOARD.id, {
    api,
    accountReady: () => account.promise,
    refreshAccount: async () => { refreshed += 1; },
  });
  await Promise.resolve();
  assert.deepEqual(calls, ["POST /integrations/preflight", `GET /boards/${BOARD.id}`], "both go out before the account arrives");

  account.resolve({ trial: { status: "activated" } });
  assert.deepEqual(await preparing, { board: BOARD, created: false });
  assert.equal(calls.includes("POST /trial/activate"), false);
  assert.equal(refreshed, 0, "the account is not fetched a second time");
});

test("a failed preflight record does not block a saved board", async () => {
  const { api } = fakeApi((path) => (path === "/integrations/preflight"
    ? Promise.reject(new AirboardApiError("NETWORK_UNAVAILABLE", 0))
    : Promise.resolve({ board: BOARD })));
  const prepared = await prepareDurableBoard(BOARD.id, {
    api,
    accountReady: async () => ({ trial: null }),
    refreshAccount: async () => {},
  });
  assert.equal(prepared.board, BOARD);
});

test("an eligible trial starts before the board opens, and the account is refreshed after", async () => {
  const order = [];
  const { api } = fakeApi(async (path) => {
    order.push(path);
    if (path === "/integrations/preflight") return { passed: true };
    if (path === "/trial/activate") throw new AirboardApiError("TRIAL_ALREADY_ACTIVATED", 409);
    return { board: BOARD };
  });
  const prepared = await prepareDurableBoard(BOARD.id, {
    api,
    accountReady: async () => ({ trial: { status: "eligible" } }),
    refreshAccount: async () => { order.push("refresh"); },
  });
  assert.equal(prepared.board, BOARD);
  assert.deepEqual(order.slice(-2), ["/trial/activate", "refresh"]);
});

test("a new board is created only after the trial has started", async () => {
  const order = [];
  const { api } = fakeApi(async (path, init) => {
    order.push(`${init.method ?? "GET"} ${path}`);
    if (path === "/integrations/preflight") return { passed: true };
    if (path === "/trial/activate") return { status: "trialing" };
    return { board: { id: "new-board" } };
  });
  const prepared = await prepareDurableBoard(undefined, {
    api,
    accountReady: async () => ({ trial: { status: "eligible" } }),
    refreshAccount: async () => { order.push("refresh"); },
  });
  assert.deepEqual(prepared, { board: { id: "new-board" }, created: true });
  assert.deepEqual(order, [
    "POST /integrations/preflight",
    "POST /trial/activate",
    "refresh",
    "POST /boards",
    "GET /boards/new-board",
  ]);
});

test("a failed activation still stops the board from opening", async () => {
  const { api } = fakeApi(async (path) => {
    if (path === "/integrations/preflight") return { passed: true };
    if (path === "/trial/activate") throw new AirboardApiError("TRIAL_ACTIVATION_FAILED", 500);
    return { board: BOARD };
  });
  await assert.rejects(
    prepareDurableBoard(BOARD.id, {
      api,
      accountReady: async () => ({ trial: { status: "eligible" } }),
      refreshAccount: async () => {},
    }),
    /TRIAL_ACTIVATION_FAILED/,
  );
});
