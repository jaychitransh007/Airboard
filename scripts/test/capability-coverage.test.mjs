import assert from "node:assert/strict";
import { test } from "node:test";
import { resolve } from "node:path";

import {
  CAPABILITY_EVIDENCE_FACETS,
  loadCapabilityCoverage,
  validateCapabilityCoverage,
} from "../lib/capability-coverage.mjs";

const ROOT = resolve(import.meta.dirname, "../..");

test("production registry and every requested evidence facet are covered", async () => {
  const result = await loadCapabilityCoverage({ root: ROOT });

  assert.equal(result.valid, true, formatIssues(result.errors));
  assert.equal(
    result.summary.completeCapabilityCount,
    result.summary.capabilityCount,
  );
  assert.deepEqual(
    Object.keys(result.coverage[0].evidence),
    CAPABILITY_EVIDENCE_FACETS,
  );
  assert.deepEqual(result.catalog.dimensions.reference, [
    "current_selection",
    "pointer",
    "visible_label",
    "type_ordinal",
    "plan_handle",
    "connection",
  ]);
  assert.equal(result.physicalMedia.releaseReady, false);
  assert.ok(
    result.warnings.some(
      ({ code }) => code === "physical.pr-declarative-only",
    ),
  );
});

test("stale test IDs fail instead of silently counting deleted evidence", async () => {
  const loaded = await loadCapabilityCoverage({ root: ROOT });
  const manifest = structuredClone(
    JSON.parse(
      await (
        await import("node:fs/promises")
      ).readFile(resolve(ROOT, "evals/capability-coverage/v2.json"), "utf8"),
    ),
  );
  manifest.staticEvidence[0].evidenceId =
    "test:packages/core/test/nodeVisuals.test.mjs#deleted title";

  const result = validateCapabilityCoverage({
    manifest,
    catalog: loaded.catalog,
    evidenceIndex: loaded.evidenceIndex,
    documents: await indexedDocuments(manifest),
  });

  assert.equal(result.valid, false);
  assert.ok(result.errors.some(({ code }) => code === "evidence.stale-id"));
});

test("registry drift and stale capability selectors fail closed", async () => {
  const loaded = await loadCapabilityCoverage({ root: ROOT });
  const manifest = await readManifest();
  manifest.capabilityRegistryVersion = "0.0";
  manifest.staticEvidence.push({
    evidenceId:
      "test:packages/core/test/nodeVisuals.test.mjs#every semantic node has one canonical visual and default size",
    capabilities: ["action:removed-production-action"],
    facets: ["positive"],
    rationale: "Deliberately stale selector used to prove fail-closed validation.",
  });

  const result = validateCapabilityCoverage({
    manifest,
    catalog: loaded.catalog,
    evidenceIndex: loaded.evidenceIndex,
    documents: await indexedDocuments(manifest),
  });

  assert.equal(result.valid, false);
  assert.ok(result.errors.some(({ code }) => code === "registry.drift"));
  assert.ok(
    result.errors.some(({ code }) => code === "evidence.stale-capability"),
  );
});

test("removing one facet grant exposes the precise capability gap", async () => {
  const loaded = await loadCapabilityCoverage({ root: ROOT });
  const manifest = await readManifest();
  manifest.staticEvidence = manifest.staticEvidence.filter(
    ({ evidenceId }) =>
      evidenceId !==
      "test:apps/web/test/capabilityCoverageEvidence.test.mjs#grounds ordinal decision branches and applies their final graph",
  );

  const result = validateCapabilityCoverage({
    manifest,
    catalog: loaded.catalog,
    evidenceIndex: loaded.evidenceIndex,
    documents: await indexedDocuments(manifest),
  });

  assert.equal(result.valid, false);
  assert.ok(
    result.errors.some(
      ({ code, path }) =>
        code === "coverage.missing-evidence" &&
        path === "/coverage/reference:type_ordinal/final_state",
    ),
  );
});

test("release mode never promotes declarative media to participant evidence", async () => {
  const result = await loadCapabilityCoverage({ root: ROOT, release: true });

  assert.equal(result.valid, false);
  assert.ok(result.errors.some(({ code }) => code === "physical.release-gap"));
  assert.equal(result.physicalMedia.audio.participantSpeakers, 0);
  assert.equal(result.physicalMedia.gesture.participantCount, 0);
});

test("one unannotated meeting negative cannot blanket-credit every node and action", async () => {
  const loaded = await loadCapabilityCoverage({ root: ROOT });
  const manifest = await readManifest();
  const documents = await indexedDocuments(manifest);
  documents.set("negative", {
    path: "inline",
    document: {
      schemaVersion: "1.0",
      utterances: [
        { id: "blanket-meeting-talk", text: "add a service to the agenda" },
      ],
    },
    entries: [
      { id: "blanket-meeting-talk", text: "add a service to the agenda" },
    ],
  });

  const result = validateCapabilityCoverage({
    manifest,
    catalog: loaded.catalog,
    evidenceIndex: loaded.evidenceIndex,
    documents,
  });

  assert.equal(result.valid, false);
  assert.ok(
    result.errors.some(
      ({ code, path }) =>
        code === "coverage.missing-evidence" &&
        path === "/coverage/action:create/negative",
    ),
  );
  assert.deepEqual(
    result.coverage.find(({ capability }) => capability === "node:service")
      .evidence.negative,
    [],
  );
});

test("interaction capability tags do not imply observed coverage facets", async () => {
  const loaded = await loadCapabilityCoverage({ root: ROOT });
  const manifest = await readManifest();
  manifest.staticEvidence = manifest.staticEvidence.filter(
    ({ evidenceId }) =>
      evidenceId !==
      "browser:apps/web/e2e/directInputChannels.spec.ts#pointer, touchpad, and stylus streams ground to attributed final state",
  );

  const result = validateCapabilityCoverage({
    manifest,
    catalog: loaded.catalog,
    evidenceIndex: loaded.evidenceIndex,
    documents: await indexedDocuments(manifest),
  });

  assert.equal(result.valid, false);
  assert.ok(
    result.errors.some(
      ({ code, path }) =>
        code === "coverage.missing-evidence" &&
        path === "/coverage/channel:touchpad/positive",
    ),
  );
  const touchpad = result.coverage.find(
    ({ capability }) => capability === "channel:touchpad",
  );
  assert.equal(
    touchpad.evidence.positive.some((id) =>
      id.startsWith("interaction:touchpad-delete-cascades-once"),
    ),
    false,
  );
});

test("declared corpus evidence rejects wildcards, self-reference, and lexical overclaim", async () => {
  const loaded = await loadCapabilityCoverage({ root: ROOT });
  const manifest = await readManifest();
  const documents = await indexedDocuments(manifest);
  documents.set("negative", {
    path: "inline",
    document: { schemaVersion: "1.0" },
    entries: [
      {
        id: "bad-claims",
        text: "the service review is after lunch",
        capabilityEvidence: [
          {
            capability: "action:*",
            provenance: "ambient-safety-runner",
            facets: { negative: ["/text"] },
          },
          {
            capability: "node:service",
            provenance: "ambient-safety-runner",
            facets: { negative: ["/capabilityEvidence/1"] },
          },
          {
            capability: "action:delete",
            provenance: "ambient-safety-runner",
            facets: { negative: ["/text"] },
          },
        ],
      },
    ],
  });

  const result = validateCapabilityCoverage({
    manifest,
    catalog: loaded.catalog,
    evidenceIndex: loaded.evidenceIndex,
    documents,
  });

  assert.equal(result.valid, false);
  assert.ok(
    result.errors.some(({ code }) => code === "evidence.claim-capability"),
  );
  assert.ok(
    result.errors.some(({ code }) => code === "evidence.claim-self-reference"),
  );
  assert.ok(
    result.errors.some(
      ({ code }) => code === "evidence.claim-not-capability-specific",
    ),
  );
});

test("static executable evidence cannot use wildcard capability credit", async () => {
  const loaded = await loadCapabilityCoverage({ root: ROOT });
  const manifest = await readManifest();
  manifest.staticEvidence[0].capabilities = ["node:*"];

  const result = validateCapabilityCoverage({
    manifest,
    catalog: loaded.catalog,
    evidenceIndex: loaded.evidenceIndex,
    documents: await indexedDocuments(manifest),
  });

  assert.equal(result.valid, false);
  assert.ok(
    result.errors.some(({ code }) => code === "evidence.wildcard-forbidden"),
  );
  assert.ok(
    result.errors.some(
      ({ code, path }) =>
        code === "coverage.missing-evidence" &&
        path === "/coverage/node:process/grounding",
    ),
  );
});

async function readManifest() {
  const { readFile } = await import("node:fs/promises");
  return JSON.parse(
    await readFile(
      resolve(ROOT, "evals/capability-coverage/v2.json"),
      "utf8",
    ),
  );
}

async function indexedDocuments(manifest) {
  const { indexEvidence } = await import("../lib/capability-coverage.mjs");
  return (await indexEvidence(ROOT, manifest)).documents;
}

function formatIssues(issues) {
  return issues
    .map(({ code, path, message }) => `${code} ${path}: ${message}`)
    .join("\n");
}
