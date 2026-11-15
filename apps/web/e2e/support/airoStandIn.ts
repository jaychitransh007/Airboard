import type { SemanticPlanAction } from "@airboard/core";
import type { Page } from "@playwright/test";

/** A reference to a shape by its visible label, as Airo's plans use. */
export const byLabel = (label: string) => ({ kind: "visible_label" as const, label, occurrence: null });

export type AiroStandIn = {
  /** Queues the plan the next Airo request gets. */
  nextPlan(actions: SemanticPlanAction[]): void;
  /** Every request Airo was sent, in order: what was typed or said. */
  readonly requests: string[];
  /** Requests that arrived with no plan queued (each got "not a board command"). */
  readonly unplanned: string[];
};

/**
 * Stands in for the Airo model, so semantic plans run through the real
 * planner, executor and save path with no provider. Each request takes the
 * next queued plan; a request with none queued is refused as "not a board
 * command" and recorded, so a test can assert Airo was not asked by surprise.
 */
export async function standInForAiro(page: Page): Promise<AiroStandIn> {
  const queue: SemanticPlanAction[][] = [];
  const requests: string[] = [];
  const unplanned: string[] = [];
  const cors = { "access-control-allow-origin": "*" };
  await page.route("**/intent/config", (route) =>
    route.fulfill({
      status: 200,
      headers: cors,
      json: { available: true, provider: "test-provider", defaultModel: "test-model", allowedModels: ["test-model"] },
    }),
  );
  await page.route("**/intent/resolve", (route) => {
    const text = (route.request().postDataJSON() as { transcript?: string }).transcript ?? "";
    requests.push(text);
    const actions = queue.shift();
    if (!actions) unplanned.push(text);
    return route.fulfill({
      status: 200,
      headers: cors,
      json: {
        plan: actions
          ? { version: "1.1", status: "resolved", issueCode: "none", clarificationQuestion: null, missingSlots: [], actions }
          : {
              version: "1.1",
              status: "unsupported",
              issueCode: "not_board_command",
              clarificationQuestion: null,
              missingSlots: [],
              actions: [],
            },
        provider: "test-provider",
        model: "test-model",
        metadata: {
          responseId: "resp_e2e",
          responseModel: "test-model",
          providerRequestId: "req_e2e",
          clientRequestId: "airboard:e2e:client",
          providerProcessingMs: 5,
          totalLatencyMs: 10,
          usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
        },
      },
    });
  });
  return {
    nextPlan: (actions) => queue.push(actions),
    requests,
    unplanned,
  };
}
