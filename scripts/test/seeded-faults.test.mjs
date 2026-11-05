import assert from "node:assert/strict";
import test from "node:test";
import {
  REQUIRED_SEEDED_FAULT_IDS,
  runSeededFaultTrials,
  validateProductionSeamEvidence,
} from "../eval-seeded-faults.mjs";

test("every required seeded fault traverses production and trips its intended evaluator gate", async () => {
  const results = await runSeededFaultTrials();
  assert.equal(results.length, 11);
  assert.deepEqual(
    results.map(({ id }) => id),
    REQUIRED_SEEDED_FAULT_IDS,
  );
  for (const result of results) {
    assert.equal(result.healthyPassed, true, `${result.id} healthy control`);
    assert.equal(result.faultDetected, true, `${result.id} seeded fault`);
    assert.equal(
      result.productionSeamInvoked,
      true,
      `${result.id} production evidence`,
    );
    assert.equal(
      result.evidenceProvenance.class,
      "seeded-production-fault",
    );
    assert.ok(
      result.evidenceProvenance.observedComponents.healthy.length > 0,
      `${result.id} healthy production components`,
    );
    assert.ok(
      result.evidenceProvenance.observedComponents.fault.length > 0,
      `${result.id} fault production components`,
    );
    assert.deepEqual(result.evidenceProvenance.missingComponents, {});
    assert.ok(result.failedChecks.includes(result.intendedCheck));
  }
});

test("seeded fault evidence fails closed when either phase skips a required production seam", () => {
  assert.deepEqual(
    validateProductionSeamEvidence(
      {
        healthy: ["VoiceCommandRouter", "commitCommandTurn"],
        fault: ["VoiceCommandRouter", "commitCommandTurn"],
      },
      {
        healthy: ["VoiceCommandRouter", "commitCommandTurn"],
        fault: ["VoiceCommandRouter"],
      },
    ),
    {
      valid: false,
      missingByPhase: {
        fault: ["commitCommandTurn"],
      },
    },
  );
});
