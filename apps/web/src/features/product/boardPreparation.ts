import { AirboardApiError } from "../../platform/api.ts";

export type BoardPreparation = {
  /** Calls the Airboard API as the signed-in person. */
  api: <T>(path: string, init?: { method?: string; body?: string }) => Promise<T>;
  /** The account once its first load settles (null if it failed). */
  accountReady: () => Promise<{ trial: { status: string } | null } | null>;
  refreshAccount: () => Promise<void>;
};

/**
 * Loads the saved board the canvas opens, or creates a new one. A saved board
 * loads alongside the account rather than after it. Only a workspace whose
 * trial has never started activates it, and a new board waits for that,
 * since creating one needs an active pilot.
 */
export async function prepareDurableBoard<Board extends { id: string }>(
  boardId: string | undefined,
  { api, accountReady, refreshAccount }: BoardPreparation,
): Promise<{ board: Board; created: boolean }> {
  const activation = startTrialIfEligible(api, accountReady, refreshAccount);
  if (boardId) {
    const [loaded] = await Promise.all([api<{ board: Board }>(`/boards/${boardId}`), activation]);
    return { board: loaded.board, created: false };
  }
  await activation;
  const created = await api<{ board: Board }>("/boards", {
    method: "POST",
    body: JSON.stringify({ title: "Untitled Airboard" }),
  });
  const loaded = await api<{ board: Board }>(`/boards/${created.board.id}`);
  return { board: loaded.board, created: true };
}

async function startTrialIfEligible(
  api: BoardPreparation["api"],
  accountReady: BoardPreparation["accountReady"],
  refreshAccount: BoardPreparation["refreshAccount"],
): Promise<void> {
  // A standalone board preflight proves the canvas can render. Activation is
  // idempotent and begins here rather than at account creation.
  const preflight = api<{ passed: boolean }>("/integrations/preflight", {
    method: "POST",
    body: JSON.stringify({
      platform: "standalone",
      checks: { canvas: true, firstAction: true },
      activateTrial: true,
      eventId: crypto.randomUUID(),
    }),
  });
  // Checked below only when activation needs it.
  preflight.catch(() => undefined);
  const account = await accountReady();
  if (account?.trial?.status !== "eligible") {
    // Started, ended or not offered: activation would change nothing, so the
    // preflight is only a record and the board need not wait on it.
    return;
  }
  if (!(await preflight).passed) throw new Error("STANDALONE_PREFLIGHT_FAILED");
  try {
    await api("/trial/activate", {
      method: "POST",
      body: JSON.stringify({ source: "standalone_preflight" }),
    });
  } catch (caught) {
    // Losing an activation race still leaves the trial active.
    if (!(caught instanceof AirboardApiError && caught.code === "TRIAL_ALREADY_ACTIVATED")) throw caught;
  }
  await refreshAccount();
}
