import { readFile, readdir } from "node:fs/promises";
import { join, relative, resolve } from "node:path";

import {
  AIRBOARD_SEMANTIC_CAPABILITY_REGISTRY,
} from "../../packages/core/src/semanticCapabilities.ts";
import {
  AIRBOARD_SEMANTIC_PLAN_JSON_SCHEMA,
} from "../../packages/core/src/semanticPlan.ts";
import {
  GESTURE_FRAME_PRIORITY,
} from "../../apps/web/src/features/board/gestureFrameArbitration.ts";
import {
  AIRBOARD_SHIPPED_INPUT_CHANNELS,
} from "../../apps/web/src/features/board/inputCapabilities.ts";

export const CAPABILITY_COVERAGE_SCHEMA_VERSION = "capability-coverage.v2";
export const CAPABILITY_EVIDENCE_FACETS = Object.freeze([
  "positive",
  "negative",
  "grounding",
  "final_state",
]);
export const CAPABILITY_EVIDENCE_PROVENANCE = Object.freeze([
  "ambient-safety-runner",
  "interaction-eval-production-route",
  "interaction-eval-production-reducer",
  "interaction-eval-harness",
]);

const DETERMINISTIC_ACTIONS = new Map([
  ["create_node", "create"],
  ["connect", "connect"],
  ["rename_selection", "rename"],
  ["rename_object", "rename"],
  ["delete_selection", "delete"],
  ["duplicate_selection", "duplicate"],
  ["move_selection", "move"],
  ["align_selection", "align"],
  ["distribute_selection", "distribute"],
  ["layout_selection", "layout"],
  ["undo", "undo"],
  ["cancel", "cancel"],
  ["delete_connection", "delete_connection"],
  ["select_all", "select"],
]);

export async function loadCapabilityCoverage({
  root,
  manifestPath = "evals/capability-coverage/v2.json",
  release = false,
} = {}) {
  const repositoryRoot = resolve(root ?? process.cwd());
  const absoluteManifestPath = resolve(repositoryRoot, manifestPath);
  const manifest = JSON.parse(await readFile(absoluteManifestPath, "utf8"));
  const catalog = productionCapabilityCatalog(manifest);
  const indexed = await indexEvidence(repositoryRoot, manifest);
  const result = validateCapabilityCoverage({
    manifest,
    catalog,
    evidenceIndex: indexed.evidence,
    documents: indexed.documents,
    release,
  });
  return {
    ...result,
    manifestPath: relative(repositoryRoot, absoluteManifestPath),
    catalog,
    evidenceIndex: indexed.evidence,
  };
}

export function productionCapabilityCatalog(manifest) {
  const references = referenceKindsFromSchema(AIRBOARD_SEMANTIC_PLAN_JSON_SCHEMA);
  const dimensions = {
    node: AIRBOARD_SEMANTIC_CAPABILITY_REGISTRY.nodes.map(
      ({ nodeType }) => nodeType,
    ),
    action: AIRBOARD_SEMANTIC_CAPABILITY_REGISTRY.actions.map(
      ({ actionType }) => actionType,
    ),
    reference: references,
    channel: [...AIRBOARD_SHIPPED_INPUT_CHANNELS],
    gesture: staticValues(manifest, "gestures"),
    surface: staticValues(manifest, "surfaces"),
  };
  const capabilities = Object.entries(dimensions).flatMap(([dimension, values]) =>
    values.map((value) => `${dimension}:${value}`),
  );
  return {
    registryVersion: AIRBOARD_SEMANTIC_CAPABILITY_REGISTRY.version,
    gestureFrameOwners: [...GESTURE_FRAME_PRIORITY],
    dimensions,
    capabilities,
  };
}

export async function indexEvidence(root, manifest) {
  const evidence = new Map();
  const documents = new Map();
  for (const [index, source] of (manifest.corpora ?? []).entries()) {
    const path = source?.path;
    const namespace = source?.namespace;
    const collection = source?.collection;
    if (
      typeof path !== "string" ||
      typeof namespace !== "string" ||
      typeof collection !== "string"
    ) {
      throw new Error(`Invalid corpus descriptor at /corpora/${index}`);
    }
    const document = JSON.parse(await readFile(resolve(root, path), "utf8"));
    const entries = document[collection];
    if (!Array.isArray(entries)) {
      throw new Error(`${path} does not contain array ${collection}`);
    }
    documents.set(namespace, { path, document, entries });
    for (const [entryIndex, entry] of entries.entries()) {
      const id = entry?.id;
      if (typeof id !== "string" || !id) {
        throw new Error(`${path} ${collection}[${entryIndex}] has no stable id`);
      }
      addEvidence(evidence, `${namespace}:${id}`, {
        kind: "corpus",
        namespace,
        path,
        entry,
      });
    }
  }

  for (const [sourceIndex, source] of (manifest.testSources ?? []).entries()) {
    if (
      typeof source?.root !== "string" ||
      typeof source?.namespace !== "string" ||
      !Array.isArray(source?.suffixes)
    ) {
      throw new Error(`Invalid test source at /testSources/${sourceIndex}`);
    }
    const absoluteRoot = resolve(root, source.root);
    for (const path of await walk(absoluteRoot)) {
      if (!source.suffixes.some((suffix) => path.endsWith(suffix))) continue;
      const repositoryPath = relative(root, path);
      const titles = extractStaticTestTitles(await readFile(path, "utf8"));
      for (const title of titles) {
        addEvidence(
          evidence,
          `${source.namespace}:${repositoryPath}#${title}`,
          {
            kind: source.namespace === "browser" ? "browser" : "test",
            namespace: source.namespace,
            path: repositoryPath,
            title,
          },
        );
      }
    }
  }

  for (const [namespace, path] of [
    ["audio-manifest", manifest.physicalMedia?.audioManifest],
    ["gesture-manifest", manifest.physicalMedia?.gestureManifest],
    ["participant-manifest", manifest.physicalMedia?.participantManifest],
  ]) {
    if (typeof path !== "string") continue;
    const document = JSON.parse(await readFile(resolve(root, path), "utf8"));
    documents.set(namespace, { path, document });
    addEvidence(evidence, `declaration:${namespace}`, {
      kind: "declaration",
      namespace,
      path,
    });
  }

  for (const [dimension, capabilityConfig] of Object.entries(
    manifest.staticCapabilities ?? {},
  )) {
    const productionType = capabilityConfig?.productionTypeUnion;
    if (
      typeof productionType?.path !== "string" ||
      typeof productionType?.typeName !== "string"
    ) {
      continue;
    }
    const source = await readFile(resolve(root, productionType.path), "utf8");
    documents.set(`production-type:${dimension}`, {
      path: productionType.path,
      typeName: productionType.typeName,
      values: extractStringLiteralTypeUnion(source, productionType.typeName),
    });
  }

  return { evidence, documents };
}

export function validateCapabilityCoverage({
  manifest,
  catalog,
  evidenceIndex,
  documents,
  release = false,
}) {
  const errors = [];
  const warnings = [];
  const requiredFacets = Array.isArray(manifest?.requiredEvidence)
    ? manifest.requiredEvidence
    : [];
  validateManifest(manifest, catalog, requiredFacets, errors);

  const coverage = new Map(
    catalog.capabilities.map((capability) => [
      capability,
      new Map(requiredFacets.map((facet) => [facet, new Set()])),
    ]),
  );
  const provenance = new Map();
  validateStructuredRegistryReferences(documents, catalog, errors);
  validateStaticProductionSources(manifest, documents, catalog, errors);
  inferStructuredEvidence(
    coverage,
    provenance,
    documents,
    catalog,
    requiredFacets,
    errors,
  );

  for (const [index, grant] of (manifest?.staticEvidence ?? []).entries()) {
    const path = `/staticEvidence/${index}`;
    const evidenceId = grant?.evidenceId;
    if (typeof evidenceId !== "string" || !evidenceIndex.has(evidenceId)) {
      errors.push(
        issue(
          "evidence.stale-id",
          `${path}/evidenceId`,
          `Static evidence ID does not exist in checked-in corpora/tests: ${String(evidenceId)}`,
        ),
      );
      continue;
    }
    if (!["test", "browser"].includes(evidenceIndex.get(evidenceId)?.kind)) {
      errors.push(
        issue(
          "evidence.non-executable-cannot-cover",
          `${path}/evidenceId`,
          "Static behavioral evidence must resolve to an executable unit or browser test",
        ),
      );
      continue;
    }
    if (typeof grant.rationale !== "string" || !grant.rationale.trim()) {
      errors.push(
        issue(
          "evidence.missing-rationale",
          `${path}/rationale`,
          "Static behavioral evidence requires a capability-specific rationale",
        ),
      );
      continue;
    }
    const selectedCapabilities = [];
    for (const [selectorIndex, selector] of (grant.capabilities ?? []).entries()) {
      if (typeof selector === "string" && selector.endsWith(":*")) {
        errors.push(
          issue(
            "evidence.wildcard-forbidden",
            `${path}/capabilities/${selectorIndex}`,
            "Behavioral evidence must name exact capabilities; wildcard credit is not allowed",
          ),
        );
        continue;
      }
      const matches = expandSelector(selector, catalog.capabilities);
      if (matches.length === 0) {
        errors.push(
          issue(
            "evidence.stale-capability",
            `${path}/capabilities/${selectorIndex}`,
            `Static evidence selector does not match the production catalog: ${String(selector)}`,
          ),
        );
      }
      selectedCapabilities.push(...matches);
    }
    for (const [facetIndex, facet] of (grant.facets ?? []).entries()) {
      if (!requiredFacets.includes(facet)) {
        errors.push(
          issue(
            "evidence.unknown-facet",
            `${path}/facets/${facetIndex}`,
            `Unknown evidence facet: ${String(facet)}`,
          ),
        );
        continue;
      }
      for (const capability of selectedCapabilities) {
        grantEvidence(coverage, provenance, {
          capability,
          facet,
          evidenceId,
          provenance: {
            claimKind: "static-manifest",
            sourceKind: evidenceIndex.get(evidenceId)?.kind ?? "unknown",
            sourcePath: evidenceIndex.get(evidenceId)?.path ?? null,
            rationale:
              typeof grant.rationale === "string" ? grant.rationale : null,
          },
        });
      }
    }
  }

  for (const [capability, facets] of coverage) {
    for (const facet of requiredFacets) {
      if ((facets.get(facet)?.size ?? 0) === 0) {
        errors.push(
          issue(
            "coverage.missing-evidence",
            `/coverage/${capability}/${facet}`,
            `${capability} has no ${facet} evidence`,
          ),
        );
      }
    }
  }

  const physicalMedia = validatePhysicalMedia(documents, catalog, release);
  errors.push(...physicalMedia.errors);
  warnings.push(...physicalMedia.warnings);

  const rows = [...coverage].map(([capability, facets]) => ({
    capability,
    dimension: capability.slice(0, capability.indexOf(":")),
    evidence: Object.fromEntries(
      requiredFacets.map((facet) => [facet, [...(facets.get(facet) ?? [])].sort()]),
    ),
    provenance: Object.fromEntries(
      requiredFacets.map((facet) => [
        facet,
        [...(facets.get(facet) ?? [])]
          .sort()
          .map((evidenceId) => ({
            evidenceId,
            ...(provenance.get(provenanceKey(capability, facet, evidenceId)) ?? {
              claimKind: "structured-inference",
            }),
          })),
      ]),
    ),
    complete: requiredFacets.every((facet) => (facets.get(facet)?.size ?? 0) > 0),
  }));
  const dimensionSummary = Object.fromEntries(
    Object.keys(catalog.dimensions).map((dimension) => {
      const dimensionRows = rows.filter((row) => row.dimension === dimension);
      return [
        dimension,
        {
          total: dimensionRows.length,
          complete: dimensionRows.filter((row) => row.complete).length,
        },
      ];
    }),
  );

  return {
    valid: errors.length === 0,
    mode: release ? "release" : "pr",
    errors,
    warnings,
    summary: {
      capabilityCount: rows.length,
      completeCapabilityCount: rows.filter((row) => row.complete).length,
      indexedEvidenceCount: evidenceIndex.size,
      dimensions: dimensionSummary,
    },
    coverage: rows,
    physicalMedia: physicalMedia.summary,
  };
}

function validateStaticProductionSources(manifest, documents, catalog, errors) {
  for (const [dimension, capabilityConfig] of Object.entries(
    manifest.staticCapabilities ?? {},
  )) {
    if (!capabilityConfig?.productionTypeUnion) continue;
    const source = documents.get(`production-type:${dimension}`);
    if (!source || source.values.length === 0) {
      errors.push(
        issue(
          "registry.production-type-unreadable",
          `/staticCapabilities/${dimension}/productionTypeUnion`,
          `Could not read production type union ${String(
            capabilityConfig.productionTypeUnion.typeName,
          )}`,
        ),
      );
      continue;
    }
    const catalogDimension = {
      inputChannels: "channel",
      gestures: "gesture",
      surfaces: "surface",
    }[dimension] ?? dimension;
    const expected = catalog.dimensions[catalogDimension];
    if (!Array.isArray(expected) || !sameSet(source.values, expected)) {
      errors.push(
        issue(
          "registry.static-dimension-drift",
          `/staticCapabilities/${dimension}/values`,
          `${dimension} manifest values (${(expected ?? []).join(
            ", ",
          )}) differ from production ${source.typeName} (${source.values.join(", ")})`,
        ),
      );
    }
  }
}

function validateStructuredRegistryReferences(documents, catalog, errors) {
  const knownNodes = new Set(catalog.dimensions.node);
  const knownActions = new Set(catalog.dimensions.action);
  const knownCapabilities = new Set(catalog.capabilities);
  const validateNode = (node, path) => {
    if (typeof node === "string" && !knownNodes.has(node)) {
      errors.push(
        issue(
          "registry.stale-corpus-node",
          path,
          `Corpus references node absent from the production registry: ${node}`,
        ),
      );
    }
  };
  const validateAction = (action, path) => {
    if (typeof action === "string" && !knownActions.has(action)) {
      errors.push(
        issue(
          "registry.stale-corpus-action",
          path,
          `Corpus references action absent from the production registry: ${action}`,
        ),
      );
    }
  };

  for (const [index, entry] of (
    documents.get("deterministic")?.entries ?? []
  ).entries()) {
    validateNode(
      entry.expected?.nodeType,
      `/corpora/deterministic/${index}/expected/nodeType`,
    );
    const action = DETERMINISTIC_ACTIONS.get(entry.expected?.kind);
    if (action) {
      validateAction(
        action,
        `/corpora/deterministic/${index}/expected/kind`,
      );
    }
  }
  for (const [index, entry] of (
    documents.get("semantic")?.entries ?? []
  ).entries()) {
    for (const action of Object.keys(entry.expected?.actionTypeCounts ?? {})) {
      validateAction(
        action,
        `/corpora/semantic/${index}/expected/actionTypeCounts/${action}`,
      );
    }
    for (const [nodeIndex, node] of (
      entry.expected?.createdNodeTypes ?? []
    ).entries()) {
      validateNode(
        node,
        `/corpora/semantic/${index}/expected/createdNodeTypes/${nodeIndex}`,
      );
    }
    for (const [objectIndex, object] of (
      entry.context?.objects ?? []
    ).entries()) {
      validateNode(
        object?.nodeType,
        `/corpora/semantic/${index}/context/objects/${objectIndex}/nodeType`,
      );
    }
  }
  for (const [index, entry] of (
    documents.get("interaction")?.entries ?? []
  ).entries()) {
    for (const [capabilityIndex, capability] of (
      entry.capabilities ?? []
    ).entries()) {
      if (
        typeof capability === "string" &&
        (capability.startsWith("node:") ||
          capability.startsWith("action:")) &&
        !knownCapabilities.has(capability)
      ) {
        errors.push(
          issue(
            "registry.stale-corpus-capability",
            `/corpora/interaction/${index}/capabilities/${capabilityIndex}`,
            `Interaction corpus references a capability absent from production: ${capability}`,
          ),
        );
      }
    }
  }
}

function validateManifest(manifest, catalog, requiredFacets, errors) {
  if (!isRecord(manifest)) {
    errors.push(issue("manifest.type", "/", "Coverage manifest must be an object"));
    return;
  }
  if (manifest.schemaVersion !== CAPABILITY_COVERAGE_SCHEMA_VERSION) {
    errors.push(
      issue(
        "manifest.schema-version",
        "/schemaVersion",
        `Expected ${CAPABILITY_COVERAGE_SCHEMA_VERSION}`,
      ),
    );
  }
  if (manifest.capabilityRegistryVersion !== catalog.registryVersion) {
    errors.push(
      issue(
        "registry.drift",
        "/capabilityRegistryVersion",
        `Manifest targets semantic registry ${String(manifest.capabilityRegistryVersion)}; production is ${catalog.registryVersion}`,
      ),
    );
  }
  if (!sameSet(requiredFacets, CAPABILITY_EVIDENCE_FACETS)) {
    errors.push(
      issue(
        "manifest.required-evidence",
        "/requiredEvidence",
        `Required evidence must be exactly ${CAPABILITY_EVIDENCE_FACETS.join(", ")}`,
      ),
    );
  }
  for (const [dimension, values] of Object.entries(catalog.dimensions)) {
    if (values.length === 0 || new Set(values).size !== values.length) {
      errors.push(
        issue(
          "registry.invalid-dimension",
          `/catalog/${dimension}`,
          `${dimension} production values must be non-empty and unique`,
        ),
      );
    }
  }

  const ownerMap = manifest.staticCapabilities?.gestures?.productionOwnerByValue;
  const gestureValues = catalog.dimensions.gesture;
  if (!isRecord(ownerMap)) {
    errors.push(
      issue(
        "registry.gesture-owner-map",
        "/staticCapabilities/gestures/productionOwnerByValue",
        "Every static gesture needs a production frame-owner mapping",
      ),
    );
  } else {
    for (const gesture of gestureValues) {
      if (!catalog.gestureFrameOwners.includes(ownerMap[gesture])) {
        errors.push(
          issue(
            "registry.gesture-owner-drift",
            `/staticCapabilities/gestures/productionOwnerByValue/${gesture}`,
            `${gesture} maps to missing production frame owner ${String(ownerMap[gesture])}`,
          ),
        );
      }
    }
    for (const owner of catalog.gestureFrameOwners) {
      if (!gestureValues.some((gesture) => ownerMap[gesture] === owner)) {
        errors.push(
          issue(
            "registry.uncovered-gesture-owner",
            "/staticCapabilities/gestures/productionOwnerByValue",
            `Production gesture frame owner ${owner} has no shipped gesture mapping`,
          ),
        );
      }
    }
    for (const gesture of Object.keys(ownerMap)) {
      if (!gestureValues.includes(gesture)) {
        errors.push(
          issue(
            "registry.stale-gesture-owner",
            `/staticCapabilities/gestures/productionOwnerByValue/${gesture}`,
            `Gesture owner mapping is stale: ${gesture}`,
          ),
        );
      }
    }
  }
}

function inferStructuredEvidence(
  coverage,
  provenance,
  documents,
  catalog,
  requiredFacets,
  errors,
) {
  const grant = (capability, facets, evidenceId, metadata = {}) => {
    if (!coverage.has(capability)) return;
    for (const facet of facets) {
      grantEvidence(coverage, provenance, {
        capability,
        facet,
        evidenceId,
        provenance: {
          claimKind: "structured-observation",
          ...metadata,
        },
      });
    }
  };

  for (const entry of documents.get("deterministic")?.entries ?? []) {
    const id = `deterministic:${entry.id}`;
    const action = DETERMINISTIC_ACTIONS.get(entry.expected?.kind);
    if (action) {
      grant(`action:${action}`, ["positive"], id, {
        sourceKind: "corpus",
        assertionPaths: ["/expected/kind"],
      });
    }
    if (typeof entry.expected?.nodeType === "string") {
      grant(`node:${entry.expected.nodeType}`, ["positive"], id, {
        sourceKind: "corpus",
        assertionPaths: ["/expected/nodeType"],
      });
    }
  }

  for (const entry of documents.get("negative")?.entries ?? []) {
    const id = `negative:${entry.id}`;
    applyDeclaredCapabilityEvidence({
      entry,
      evidenceId: id,
      namespace: "negative",
      coverage,
      provenance,
      catalog,
      requiredFacets,
      errors,
    });
    grant("channel:voice", ["negative"], id, {
      sourceKind: "corpus",
      observation: "ambient utterance exercises the voice safety route",
      assertionPaths: ["/text"],
    });
  }

  for (const entry of documents.get("semantic")?.entries ?? []) {
    const id = `semantic:${entry.id}`;
    const status = entry.expected?.status;
    for (const [action, count] of Object.entries(
      entry.expected?.actionTypeCounts ?? {},
    )) {
      if (Number(count) > 0) {
        grant(`action:${action}`, ["positive", "grounding"], id, {
          sourceKind: "corpus",
          assertionPaths: [
            `/expected/actionTypeCounts/${escapeJsonPointerToken(action)}`,
          ],
        });
      }
    }
    for (const node of entry.expected?.createdNodeTypes ?? []) {
      grant(`node:${node}`, ["positive", "grounding"], id, {
        sourceKind: "corpus",
        assertionPaths: ["/expected/createdNodeTypes"],
      });
    }
    for (const referenceKind of collectReferenceKinds(
      entry.expected?.actionDetails,
      catalog.dimensions.reference,
    )) {
      grant(`reference:${referenceKind}`, ["grounding"], id, {
        sourceKind: "corpus",
        assertionPaths: ["/expected/actionDetails"],
      });
    }
    if (status === "clarification" || status === "unsupported") {
      grant("channel:voice", ["negative", "grounding", "final_state"], id, {
        sourceKind: "corpus",
        assertionPaths: ["/expected/status"],
      });
    }
  }

  for (const entry of documents.get("provider")?.entries ?? []) {
    const id = `provider:${entry.id}`;
    const actions = entry.expected?.commandKinds ?? [];
    if (actions.length > 0) {
      grant("channel:voice", ["positive", "grounding", "final_state"], id, {
        sourceKind: "corpus",
        assertionPaths: ["/expected/commandKinds"],
      });
    } else {
      grant("channel:voice", ["negative", "final_state"], id, {
        sourceKind: "corpus",
        assertionPaths: ["/expected/commandKinds"],
      });
    }
    for (const kind of actions) {
      const action = DETERMINISTIC_ACTIONS.get(kind) ?? kind;
      grant(`action:${action}`, ["positive"], id, {
        sourceKind: "corpus",
        assertionPaths: ["/expected/commandKinds"],
      });
    }
  }

  for (const entry of documents.get("interaction")?.entries ?? []) {
    const id = `interaction:${entry.id}`;
    applyDeclaredCapabilityEvidence({
      entry,
      evidenceId: id,
      namespace: "interaction",
      coverage,
      provenance,
      catalog,
      requiredFacets,
      errors,
    });
  }

  for (const entry of documents.get("audio")?.entries ?? []) {
    const id = `audio:${entry.id}`;
    const actions = entry.oracle?.expectedActions ?? [];
    const facets =
      actions.length > 0
        ? ["positive", "grounding", "final_state"]
        : ["negative", "grounding", "final_state"];
    grant("channel:voice", facets, id, {
      sourceKind: "corpus",
      assertionPaths: ["/oracle/expectedActions"],
    });
    for (const kind of actions) {
      const action = DETERMINISTIC_ACTIONS.get(kind) ?? kind;
      grant(`action:${action}`, ["positive"], id, {
        sourceKind: "corpus",
        assertionPaths: ["/oracle/expectedActions"],
      });
    }
  }
}

function applyDeclaredCapabilityEvidence({
  entry,
  evidenceId,
  namespace,
  coverage,
  provenance,
  catalog,
  requiredFacets,
  errors,
}) {
  const declaration = entry.capabilityEvidence;
  if (declaration === undefined) return;
  const claims =
    namespace === "negative" &&
    isRecord(declaration) &&
    Array.isArray(declaration.negative)
      ? declaration.negative.map((capability) => ({
          capability,
          provenance: declaration.provenance,
          facets: {
            negative: [
              typeof declaration.assertion === "string"
                ? declaration.assertion
                : "/text",
            ],
          },
        }))
      : declaration;
  if (!Array.isArray(claims)) {
    errors.push(
      issue(
        "evidence.claims-type",
        `/${evidenceId}/capabilityEvidence`,
        "Capability evidence claims must be an array",
      ),
    );
    return;
  }
  for (const [claimIndex, claim] of claims.entries()) {
    const path = `/${evidenceId}/capabilityEvidence/${claimIndex}`;
    if (!isRecord(claim)) {
      errors.push(
        issue("evidence.claim-type", path, "Capability evidence claim must be an object"),
      );
      continue;
    }
    const capability = claim.capability;
    if (
      typeof capability !== "string" ||
      capability.endsWith(":*") ||
      !catalog.capabilities.includes(capability)
    ) {
      errors.push(
        issue(
          "evidence.claim-capability",
          `${path}/capability`,
          `Claim must name one exact production capability: ${String(capability)}`,
        ),
      );
      continue;
    }
    if (!CAPABILITY_EVIDENCE_PROVENANCE.includes(claim.provenance)) {
      errors.push(
        issue(
          "evidence.claim-provenance",
          `${path}/provenance`,
          `Claim provenance must be one of ${CAPABILITY_EVIDENCE_PROVENANCE.join(", ")}`,
        ),
      );
      continue;
    }
    if (
      namespace === "negative" &&
      claim.provenance !== "ambient-safety-runner"
    ) {
      errors.push(
        issue(
          "evidence.claim-provenance",
          `${path}/provenance`,
          "Meeting negatives must use ambient-safety-runner provenance",
        ),
      );
      continue;
    }
    if (!isRecord(claim.facets) || Object.keys(claim.facets).length === 0) {
      errors.push(
        issue(
          "evidence.claim-facets",
          `${path}/facets`,
          "Claim must declare at least one facet with assertion pointers",
        ),
      );
      continue;
    }
    for (const [facet, assertionPaths] of Object.entries(claim.facets)) {
      const facetPath = `${path}/facets/${facet}`;
      if (!requiredFacets.includes(facet)) {
        errors.push(
          issue(
            "evidence.unknown-facet",
            facetPath,
            `Unknown evidence facet: ${facet}`,
          ),
        );
        continue;
      }
      if (
        namespace === "negative" &&
        (facet !== "negative" ||
          !isAmbientCapabilityMention(entry.text, capability, catalog))
      ) {
        errors.push(
          issue(
            "evidence.claim-not-capability-specific",
            facetPath,
            facet !== "negative"
              ? "Meeting-talk claims may satisfy only the negative facet"
              : `${capability} is not mentioned by a production term in this utterance`,
          ),
        );
        continue;
      }
      if (
        !Array.isArray(assertionPaths) ||
        assertionPaths.length === 0 ||
        assertionPaths.some((pointer) => typeof pointer !== "string")
      ) {
        errors.push(
          issue(
            "evidence.claim-assertions",
            facetPath,
            "Every claimed facet needs one or more JSON Pointer assertions",
          ),
        );
        continue;
      }
      const resolvedAssertions = [];
      let assertionsValid = true;
      for (const [assertionIndex, pointer] of assertionPaths.entries()) {
        const assertionPath = `${facetPath}/${assertionIndex}`;
        if (isSelfDeclaredEvidencePointer(pointer)) {
          errors.push(
            issue(
              "evidence.claim-self-reference",
              assertionPath,
              `Evidence cannot be established from declaration-only field ${pointer}`,
            ),
          );
          assertionsValid = false;
          continue;
        }
        const resolved = resolveJsonPointer(entry, pointer);
        if (!resolved.found) {
          errors.push(
            issue(
              "evidence.claim-stale-assertion",
              assertionPath,
              `Assertion pointer does not resolve in ${evidenceId}: ${pointer}`,
            ),
          );
          assertionsValid = false;
          continue;
        }
        resolvedAssertions.push({ pointer, value: resolved.value });
      }
      if (!assertionsValid) continue;
      const observationError = validateClaimObservation({
        namespace,
        entry,
        capability,
        facet,
        resolvedAssertions,
      });
      if (observationError) {
        errors.push(
          issue(
            "evidence.claim-unobserved",
            facetPath,
            observationError,
          ),
        );
        continue;
      }
      grantEvidence(coverage, provenance, {
        capability,
        facet,
        evidenceId,
        provenance: {
          claimKind: "declared-observation",
          sourceKind: "corpus",
          namespace,
          declaredProvenance: claim.provenance,
          assertionPaths: [...assertionPaths],
        },
      });
    }
  }
}

function validatePhysicalMedia(documents, catalog, release) {
  const errors = [];
  const warnings = [];
  const audio = documents.get("audio-manifest")?.document ?? {};
  const gesture = documents.get("gesture-manifest")?.document ?? {};
  const participants = documents.get("participant-manifest")?.document
    ?.participants ?? [];
  const audioAssets = audio.assets ?? [];
  const gestureAssets = gesture.assets ?? [];
  const humanAudioAssets = audioAssets.filter((asset) => asset?.participantId);
  const humanGestureAssets = gestureAssets.filter((asset) => asset?.participantId);
  const declaredGestures = gesture.requiredSlices?.shippedGestures ?? [];
  const declaredSurfaces = audio.requiredSlices?.surfaces ?? [];

  if (!sameSet(declaredGestures, catalog.dimensions.gesture)) {
    errors.push(
      issue(
        "physical.gesture-registry-drift",
        "/physicalMedia/gestureManifest",
        "Gesture release slices do not match the shipped gesture catalog",
      ),
    );
  }
  if (!sameSet(declaredSurfaces, catalog.dimensions.surface)) {
    errors.push(
      issue(
        "physical.surface-registry-drift",
        "/physicalMedia/audioManifest",
        "Audio release surfaces do not match the production surface catalog",
      ),
    );
  }

  const requiredAudioSpeakers = Number(audio.requiredSlices?.minimumSpeakers ?? 0);
  const audioSpeakers = new Set(
    humanAudioAssets.map((asset) => asset.participantId),
  ).size;
  const requiredGestureParticipants = Number(
    gesture.requiredSlices?.minimumParticipants ?? 0,
  );
  const gestureParticipants = new Set(
    humanGestureAssets.map((asset) => asset.participantId),
  ).size;
  const splitNames = new Set(participants.map((entry) => entry?.split));
  const releaseGaps = [];
  if (audioSpeakers < requiredAudioSpeakers) {
    releaseGaps.push(
      `audio speakers ${audioSpeakers}/${requiredAudioSpeakers}`,
    );
  }
  if (gestureParticipants < requiredGestureParticipants) {
    releaseGaps.push(
      `gesture participants ${gestureParticipants}/${requiredGestureParticipants}`,
    );
  }
  for (const split of ["development", "regression", "holdout"]) {
    if (!splitNames.has(split)) releaseGaps.push(`participant split ${split} is empty`);
  }

  if (releaseGaps.length > 0) {
    const message =
      `Physical media remains release-only and incomplete: ${releaseGaps.join("; ")}. ` +
      "PR evidence is declarative/synthetic and is not participant evidence.";
    if (release) {
      errors.push(issue("physical.release-gap", "/physicalMedia", message));
    } else {
      warnings.push(issue("physical.pr-declarative-only", "/physicalMedia", message));
    }
  }

  return {
    errors,
    warnings,
    summary: {
      policy: release ? "release_required" : "pr_declarative_only",
      releaseReady: releaseGaps.length === 0,
      releaseGaps,
      audio: {
        declaredAssets: audioAssets.length,
        participantSpeakers: audioSpeakers,
        requiredSpeakers: requiredAudioSpeakers,
      },
      gesture: {
        declaredAssets: gestureAssets.length,
        participantCount: gestureParticipants,
        requiredParticipants: requiredGestureParticipants,
      },
      participantCount: participants.length,
    },
  };
}

function referenceKindsFromSchema(schema) {
  const objectKinds = (schema?.$defs?.objectReference?.anyOf ?? []).flatMap(
    (variant) => variant?.properties?.kind?.enum ?? [],
  );
  const connectionKinds =
    schema?.$defs?.connectionReference?.properties?.kind?.enum ?? [];
  return [...new Set([...objectKinds, ...connectionKinds])];
}

function staticValues(manifest, key) {
  const values = manifest?.staticCapabilities?.[key]?.values;
  return Array.isArray(values) ? [...values] : [];
}

function grantEvidence(
  coverage,
  provenance,
  { capability, facet, evidenceId, provenance: metadata },
) {
  const facetEvidence = coverage.get(capability)?.get(facet);
  if (!facetEvidence) return;
  facetEvidence.add(evidenceId);
  provenance.set(
    provenanceKey(capability, facet, evidenceId),
    structuredClone(metadata ?? {}),
  );
}

function provenanceKey(capability, facet, evidenceId) {
  return `${capability}\u0000${facet}\u0000${evidenceId}`;
}

function isAmbientCapabilityMention(text, capability, catalog) {
  if (typeof text !== "string") return false;
  const [dimension, value] = capability.split(":", 2);
  const source =
    dimension === "action"
      ? AIRBOARD_SEMANTIC_CAPABILITY_REGISTRY.actions.find(
          ({ actionType }) => actionType === value,
        )
      : dimension === "node"
        ? AIRBOARD_SEMANTIC_CAPABILITY_REGISTRY.nodes.find(
            ({ nodeType }) => nodeType === value,
          )
        : null;
  if (!source || !catalog.dimensions[dimension]?.includes(value)) return false;
  const normalized = normalizeEvidenceText(text);
  return source.terms.some((term) =>
    containsWholePhrase(normalized, normalizeEvidenceText(term)),
  );
}

function normalizeEvidenceText(value) {
  return String(value)
    .normalize("NFKC")
    .toLocaleLowerCase("en-US")
    .replace(/[^\p{Letter}\p{Number}]+/gu, " ")
    .trim();
}

function containsWholePhrase(text, phrase) {
  if (!text || !phrase) return false;
  return ` ${text} `.includes(` ${phrase} `);
}

function validateClaimObservation({
  namespace,
  entry,
  capability,
  facet,
  resolvedAssertions,
}) {
  if (namespace === "negative") {
    return resolvedAssertions.some(
      ({ pointer, value }) =>
        pointer === "/text" && typeof value === "string" && value.length > 0,
    )
      ? null
      : "Ambient safety evidence must assert the tested /text input";
  }

  const [dimension, value] = capability.split(":", 2);
  const values = resolvedAssertions.map(({ value: assertion }) => assertion);
  const capabilityObserved =
    dimension === "channel"
      ? resolvedAssertions.some(
          ({ pointer, value: assertion }) =>
            pointer === "/interaction/channel" && assertion === value,
        )
      : dimension === "surface"
        ? resolvedAssertions.some(
            ({ pointer, value: assertion }) =>
              pointer === "/surface" && assertion === value,
          )
        : dimension === "node"
          ? values.some((assertion) => containsKeyValue(assertion, "nodeType", value))
          : dimension === "action"
            ? values.some((assertion) =>
                containsActionObservation(assertion, value),
              )
            : dimension === "reference"
              ? values.some((assertion) =>
                  containsKeyValue(assertion, "kind", value),
                )
              : dimension === "gesture"
                ? values.some((assertion) =>
                    containsScalar(assertion, value),
                  )
                : false;
  if (!capabilityObserved) {
    return `${capability} is not identified by any asserted production input or oracle value`;
  }

  if (facet === "positive") {
    return resolvedAssertions.some(
      ({ pointer, value: assertion }) =>
        pointer === "/expected/outcome" && assertion === "applied",
    )
      ? null
      : "Positive evidence must assert /expected/outcome = applied";
  }
  if (facet === "negative") {
    const nonApplied = resolvedAssertions.some(
      ({ pointer, value: assertion }) =>
        pointer === "/expected/outcome" &&
        ["clarification", "error", "no-op", "rejected"].includes(assertion),
    );
    const forbidden = resolvedAssertions.some(
      ({ pointer }) =>
        pointer.startsWith("/expected/forbiddenActions") ||
        pointer.startsWith("/expected/forbiddenMutations"),
    );
    return nonApplied && forbidden
      ? null
      : "Negative evidence must assert a non-applied outcome and an explicit forbidden action or mutation";
  }
  if (facet === "grounding") {
    const observesGrounding = resolvedAssertions.some(
      ({ pointer, value: assertion }) =>
        pointer === "/expected/processingPath" &&
        Array.isArray(assertion) &&
        assertion.some((stage) =>
          [
            "grounding",
            "gesture_frame",
            "pointer_event",
            "keyboard_event",
            "catalog_event",
            "board_event",
            "reducer",
          ].includes(stage),
        ),
    );
    return observesGrounding
      ? null
      : "Grounding evidence must assert a production processing-path grounding or reducer stage";
  }
  if (facet === "final_state") {
    const observesFinalState = resolvedAssertions.some(
      ({ pointer }) =>
        pointer === "/expected/finalBoardState" ||
        pointer.startsWith("/expected/finalBoardState/") ||
        pointer === "/expected/finalNonBoardState" ||
        pointer.startsWith("/expected/finalNonBoardState/") ||
        pointer === "/expected/forbiddenMutations" ||
        pointer.startsWith("/expected/forbiddenMutations/"),
    );
    return observesFinalState
      ? null
      : "Final-state evidence must assert a canonical final state or forbidden-mutation oracle";
  }
  return `Unsupported evidence facet ${facet}`;
}

function containsActionObservation(value, action) {
  const commandTypes = {
    create: ["node.create"],
    connect: ["nodes.connect"],
    reverse_connection: ["connection.reverse"],
    delete_connection: ["connection.delete"],
    branch: ["nodes.branch"],
    rename: ["object.rename"],
    delete: ["objects.delete"],
    duplicate: ["objects.duplicate"],
    move: ["objects.move"],
    align: ["objects.align"],
    distribute: ["objects.distribute"],
    layout: ["objects.layout"],
    group: ["objects.group"],
    select: ["selection.change"],
    undo: ["undo"],
    cancel: ["cancel"],
  }[action] ?? [];
  return (
    containsKeyValue(value, "type", action) ||
    commandTypes.some((type) => containsKeyValue(value, "type", type))
  );
}

function containsKeyValue(value, key, expected) {
  if (Array.isArray(value)) {
    return value.some((item) => containsKeyValue(item, key, expected));
  }
  if (!isRecord(value)) return false;
  if (value[key] === expected) return true;
  return Object.values(value).some((item) =>
    containsKeyValue(item, key, expected),
  );
}

function containsScalar(value, expected) {
  if (value === expected) return true;
  if (Array.isArray(value)) {
    return value.some((item) => containsScalar(item, expected));
  }
  if (!isRecord(value)) return false;
  return Object.values(value).some((item) => containsScalar(item, expected));
}

function collectReferenceKinds(value, knownKinds, collected = new Set()) {
  if (Array.isArray(value)) {
    for (const item of value) collectReferenceKinds(item, knownKinds, collected);
    return collected;
  }
  if (!isRecord(value)) return collected;
  if (typeof value.kind === "string" && knownKinds.includes(value.kind)) {
    collected.add(value.kind);
  }
  for (const item of Object.values(value)) {
    collectReferenceKinds(item, knownKinds, collected);
  }
  return collected;
}

function isSelfDeclaredEvidencePointer(pointer) {
  return (
    typeof pointer !== "string" ||
    pointer === "" ||
    pointer === "/capabilities" ||
    pointer.startsWith("/capabilities/") ||
    pointer === "/tags" ||
    pointer.startsWith("/tags/") ||
    pointer === "/capabilityEvidence" ||
    pointer.startsWith("/capabilityEvidence/") ||
    pointer === "/title" ||
    pointer === "/description"
  );
}

function resolveJsonPointer(value, pointer) {
  if (typeof pointer !== "string" || !pointer.startsWith("/")) {
    return { found: false };
  }
  let current = value;
  for (const encodedToken of pointer.slice(1).split("/")) {
    const token = encodedToken.replaceAll("~1", "/").replaceAll("~0", "~");
    if (
      (Array.isArray(current) &&
        /^(?:0|[1-9]\d*)$/u.test(token) &&
        Number(token) < current.length) ||
      (isRecord(current) && Object.prototype.hasOwnProperty.call(current, token))
    ) {
      current = current[token];
      continue;
    }
    return { found: false };
  }
  return { found: true, value: current };
}

function escapeJsonPointerToken(value) {
  return String(value).replaceAll("~", "~0").replaceAll("/", "~1");
}

function expandSelector(selector, capabilities) {
  if (typeof selector !== "string") return [];
  if (selector.endsWith(":*")) {
    const prefix = selector.slice(0, -1);
    return capabilities.filter((capability) => capability.startsWith(prefix));
  }
  return capabilities.includes(selector) ? [selector] : [];
}

function extractStaticTestTitles(source) {
  const titles = [];
  const patterns = [
    /\b(?:test|it)(?:\.(?:only|skip|fixme|todo))?\s*\(\s*"((?:\\.|[^"\\])*)"/gu,
    /\b(?:test|it)(?:\.(?:only|skip|fixme|todo))?\s*\(\s*'((?:\\.|[^'\\])*)'/gu,
    /\b(?:test|it)(?:\.(?:only|skip|fixme|todo))?\s*\(\s*`([^`$]*)`/gu,
  ];
  for (const [patternIndex, pattern] of patterns.entries()) {
    for (const match of source.matchAll(pattern)) {
      const raw = match[1];
      if (patternIndex === 0) {
        titles.push(JSON.parse(`"${raw}"`));
      } else if (patternIndex === 1) {
        titles.push(raw.replaceAll("\\'", "'").replaceAll("\\\\", "\\"));
      } else {
        titles.push(raw.replaceAll("\\`", "`").replaceAll("\\\\", "\\"));
      }
    }
  }
  return [...new Set(titles)];
}

function extractStringLiteralTypeUnion(source, typeName) {
  const escapedName = typeName.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  const declaration = source.match(
    new RegExp(`\\btype\\s+${escapedName}\\s*=\\s*([^;]+);`, "u"),
  )?.[1];
  if (!declaration) return [];
  const directValues = [
    ...declaration.matchAll(/"([^"\r\n]+)"/gu),
    ...declaration.matchAll(/'([^'\r\n]+)'/gu),
  ].map((match) => match[1]);
  if (directValues.length > 0) return directValues;

  const tupleName = declaration.match(
    /\(\s*typeof\s+([A-Za-z_$][\w$]*)\s*\)\s*\[\s*number\s*\]/u,
  )?.[1];
  if (!tupleName) return [];
  const escapedTupleName = tupleName.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  const tupleBody = source.match(
    new RegExp(
      `\\bconst\\s+${escapedTupleName}\\s*=\\s*\\[([\\s\\S]*?)\\]\\s*as\\s+const`,
      "u",
    ),
  )?.[1];
  if (!tupleBody) return [];
  return [
    ...tupleBody.matchAll(/"([^"\r\n]+)"/gu),
    ...tupleBody.matchAll(/'([^'\r\n]+)'/gu),
  ].map((match) => match[1]);
}

async function walk(directory) {
  const paths = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      paths.push(...(await walk(path)));
    } else if (entry.isFile()) {
      paths.push(path);
    }
  }
  return paths.sort();
}

function addEvidence(evidence, id, metadata) {
  if (evidence.has(id)) throw new Error(`Duplicate evidence ID: ${id}`);
  evidence.set(id, metadata);
}

function sameSet(left, right) {
  return (
    Array.isArray(left) &&
    Array.isArray(right) &&
    left.length === right.length &&
    new Set(left).size === left.length &&
    left.every((value) => right.includes(value))
  );
}

function issue(code, path, message) {
  return { code, path, message };
}

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
