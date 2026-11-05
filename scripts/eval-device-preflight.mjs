#!/usr/bin/env node

import { validateDeviceEvalContract } from "./lib/device-eval-contract.mjs";

const result = validateDeviceEvalContract();
console.log(
  `Airboard device preflight: ${result.valid ? "PASS" : "FAIL"}`,
);
for (const failure of result.failures) console.log(`  - ${failure}`);
if (result.attestation) {
  console.log(
    "  - fresh station-bound Meet sender and independent receiver evidence verified",
  );
}
if (!result.valid) process.exitCode = 1;
