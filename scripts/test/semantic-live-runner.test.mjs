import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import test from "node:test";

const execFileAsync = promisify(execFile);
const ROOT = resolve(import.meta.dirname, "../..");

test("live semantic runner retries one transient failure and emits privacy-safe reports", async (t) => {
  let requests = 0;
  const server = createServer((request, response) => {
    if (request.method !== "POST" || request.url !== "/intent/resolve") {
      response.writeHead(404).end();
      return;
    }
    request.resume();
    request.on("end", () => {
      requests += 1;
      response.setHeader("Content-Type", "application/json");
      if (requests === 1) {
        response.writeHead(503).end(
          JSON.stringify({
            error: "SEMANTIC_INTENT_PROVIDER_UNAVAILABLE",
            message: "Transient provider failure.",
          }),
        );
        return;
      }
      response.writeHead(200).end(
        JSON.stringify({
          provider: "fake-live",
          model: "eval-model",
          plan: {
            version: "1.1",
            status: "resolved",
            issueCode: "none",
            clarificationQuestion: null,
            missingSlots: [],
            actions: [
              {
                type: "create",
                nodeType: "decision",
                label: "Decision",
                handle: "decision",
                placement: { kind: "auto" },
              },
            ],
          },
          metadata: {
            responseModel: "eval-model",
            providerProcessingMs: 12,
            totalLatencyMs: 18,
            usage: {
              inputTokens: 100,
              outputTokens: 20,
              totalTokens: 120,
            },
            providerRequestId: "must-not-be-reported",
            responseId: "must-not-be-reported",
            clientRequestId: "must-not-be-reported",
          },
        }),
      );
    });
  });
  try {
    await new Promise((resolveListen, rejectListen) => {
      server.once("error", rejectListen);
      server.listen(0, "127.0.0.1", () => {
        server.off("error", rejectListen);
        resolveListen();
      });
    });
  } catch (error) {
    if (error?.code === "EPERM") {
      t.skip("This sandbox does not permit loopback listeners.");
      return;
    }
    throw error;
  }
  t.after(() => server.close());
  const address = server.address();
  assert.notEqual(typeof address, "string");
  const outputRoot = await mkdtemp(join(tmpdir(), "airboard-semantic-eval-"));

  const { stdout } = await execFileAsync(
    process.execPath,
    [
      "scripts/eval-voice-intent.mjs",
      "--api-url",
      `http://127.0.0.1:${address.port}`,
      "--case",
      "create-condition-block",
    ],
    {
      cwd: ROOT,
      env: {
        ...process.env,
        AIRBOARD_EVAL_OUTPUT_DIR: outputRoot,
      },
      timeout: 10_000,
    },
  );

  assert.equal(requests, 2);
  assert.match(stdout, /1\/1 passed/u);
  const report = JSON.parse(
    await readFile(
      join(outputRoot, "semantic", "semantic-contract.json"),
      "utf8",
    ),
  );
  assert.equal(report.results[0].providerRetryCount, 1);
  assert.equal(report.summary.infrastructureFailures, 0);
  assert.equal(report.summary.coreAccuracy, 1);
  assert.equal(
    report.summary.semanticEndToActionP95Ms >=
      report.summary.semanticPlannerLatencyP95Ms,
    true,
  );
  assert.equal(report.versions.prompt, "2.7");
  assert.equal(report.results[0].groundingStatus, "applied");
  assert.equal(report.results[0].groundedCommands.length, 1);
  assert.equal(report.results[0].eventDelta.length, 2);
  assert.equal(report.results[0].effects.nodeCountDelta, 1);
  assert.equal(report.results[0].undo.roundTripPassed, true);
  assert.equal(report.results[0].metadata.providerRequestId, undefined);
  assert.equal(report.results[0].metadata.responseId, undefined);
  assert.equal(report.results[0].metadata.clientRequestId, undefined);
  assert.equal(
    JSON.stringify(report).includes("must-not-be-reported"),
    false,
  );
});
