import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  CHROME_ORIGIN_GATED_API_SURFACES,
  evaluateChromeCorsPreflightProbe,
  evaluateChromeHttpOriginProbe,
  extractChromeExtensionDeploymentTargets,
  normalizeChromeWebStoreUrlForExtension,
  validateChromePackageVersionBindings,
  validateChromeDeploymentCompatibility,
  validateChromeDeploymentTargets,
} from "../lib/chrome-deployment-compatibility.mjs";

const extensionId = "abcdefghijklmnopabcdefghijklmnop";
const compatible = {
  bridge: "airboard-media-bridge",
  protocolVersion: 1,
  extensionVersion: "0.8.0",
  compatibleExtensionVersions: ["0.8.0"],
  chromeWebStoreUrl: null,
};
const appUrl = "https://airboard-pilot-web-634900453473.asia-south1.run.app";
const apiUrl = "https://airboard-pilot-api-634900453473.asia-south1.run.app";
const matchingTargets = {
  configuredAppUrl: appUrl,
  configuredApiUrl: apiUrl,
  extensionAppUrl: appUrl,
  extensionApiUrl: apiUrl,
  allowedOrigins: [appUrl],
};
const originProbeResults = CHROME_ORIGIN_GATED_API_SURFACES.map(({ id }) => ({ id, ok: true }));

test("deployment compatibility requires matching web, API, switch, and exact extension ID", () => {
  assert.deepEqual(validateChromeDeploymentCompatibility({
    extensionVersion: "0.8.0",
    extensionId,
    ...matchingTargets,
    originProbeResults,
    web: { ...compatible, trustedExtensionId: extensionId },
    api: { ...compatible, extensionId, enabled: true },
  }), { ok: true, failures: [] });
});

test("version skew, broad trust, and a disabled API all block packaging", () => {
  const result = validateChromeDeploymentCompatibility({
    extensionVersion: "0.8.0",
    extensionId,
    ...matchingTargets,
    originProbeResults,
    web: { ...compatible, extensionVersion: "0.7.0", trustedExtensionId: null },
    api: { ...compatible, extensionId, enabled: false },
  });
  assert.equal(result.ok, false);
  assert.equal(result.failures.length, 3);
  assert.match(result.failures.join("\n"), /web current version is outside/);
  assert.match(result.failures.join("\n"), /does not trust/);
  assert.match(result.failures.join("\n"), /not enabled/);
});

test("an API configured for another extension package blocks release", () => {
  const result = validateChromeDeploymentCompatibility({
    extensionVersion: "0.8.0",
    extensionId,
    ...matchingTargets,
    originProbeResults,
    web: { ...compatible, trustedExtensionId: extensionId },
    api: {
      ...compatible,
      extensionId: "ponmlkjihgfedcbaponmlkjihgfedcba",
      enabled: true,
    },
  });
  assert.equal(result.ok, false);
  assert.deepEqual(result.failures, [
    "The deployed API does not restrict credentials to the release extension ID.",
  ]);
});

test("the release listing is bound to the exact trusted extension package", () => {
  const listing =
    `https://chromewebstore.google.com/detail/airboard/${extensionId}`;
  assert.equal(
    normalizeChromeWebStoreUrlForExtension(listing, extensionId),
    listing,
  );
  assert.equal(
    normalizeChromeWebStoreUrlForExtension(
      "https://chromewebstore.google.com/detail/airboard/ponmlkjihgfedcbaponmlkjihgfedcba",
      extensionId,
    ),
    null,
  );

  assert.deepEqual(validateChromeDeploymentCompatibility({
    extensionVersion: "0.8.0",
    extensionId,
    chromeWebStoreUrl: listing,
    ...matchingTargets,
    originProbeResults,
    web: { ...compatible, chromeWebStoreUrl: listing, trustedExtensionId: extensionId },
    api: { ...compatible, extensionId, enabled: true },
  }), { ok: true, failures: [] });

  const mismatchedListing = validateChromeDeploymentCompatibility({
    extensionVersion: "0.8.0",
    extensionId,
    chromeWebStoreUrl:
      "https://chromewebstore.google.com/detail/other/ponmlkjihgfedcbaponmlkjihgfedcba",
    ...matchingTargets,
    originProbeResults,
    web: { ...compatible, trustedExtensionId: extensionId },
    api: { ...compatible, extensionId, enabled: true },
  });
  assert.match(
    mismatchedListing.failures.join("\n"),
    /not the detail page for the configured release extension ID/,
  );

  const staleDeployment = validateChromeDeploymentCompatibility({
    extensionVersion: "0.8.0",
    extensionId,
    chromeWebStoreUrl: listing,
    ...matchingTargets,
    originProbeResults,
    web: { ...compatible, trustedExtensionId: extensionId },
    api: { ...compatible, extensionId, enabled: true },
  });
  assert.match(
    staleDeployment.failures.join("\n"),
    /deployed renderer Chrome Web Store listing does not match/,
  );
});

test("perfect compatibility responses cannot validate unrelated deployment URLs", () => {
  const result = validateChromeDeploymentCompatibility({
    extensionVersion: "0.8.0",
    extensionId,
    configuredAppUrl: "https://unrelated-web.example",
    configuredApiUrl: "https://unrelated-api.example",
    extensionAppUrl: appUrl,
    extensionApiUrl: apiUrl,
    allowedOrigins: ["https://unrelated-web.example"],
    originProbeResults,
    web: { ...compatible, trustedExtensionId: extensionId },
    api: { ...compatible, extensionId, enabled: true },
  });
  assert.equal(result.ok, false);
  assert.equal(result.failures.length, 2);
  assert.match(result.failures[0], /AIRBOARD_APP_URL targets https:\/\/unrelated-web\.example/);
  assert.match(result.failures[1], /NEXT_PUBLIC_AIRBOARD_API_URL targets/);
});

test("reads the exact production destinations shipped by the extension", async () => {
  const [backgroundSource, engineRelaySource] = await Promise.all([
    readFile(new URL("../../extensions/chrome-meet-bridge/background.js", import.meta.url), "utf8"),
    readFile(new URL("../../extensions/chrome-meet-bridge/engine-relay.js", import.meta.url), "utf8"),
  ]);
  const targets = extractChromeExtensionDeploymentTargets({
    backgroundSource,
    engineRelaySource,
  });
  assert.deepEqual(targets, { appUrl, apiUrl });
  assert.deepEqual(validateChromeDeploymentTargets({
    configuredAppUrl: appUrl,
    configuredApiUrl: apiUrl,
    extensionAppUrl: targets.appUrl,
    extensionApiUrl: targets.apiUrl,
    allowedOrigins: [appUrl],
  }), { ok: true, failures: [] });
});

test("rolling release passes when both deployments explicitly overlap the package version", () => {
  assert.deepEqual(validateChromeDeploymentCompatibility({
    extensionVersion: "0.8.0",
    extensionId,
    ...matchingTargets,
    originProbeResults,
    web: {
      ...compatible,
      extensionVersion: "0.9.0",
      compatibleExtensionVersions: ["0.8.0", "0.9.0"],
      trustedExtensionId: extensionId,
    },
    api: {
      ...compatible,
      extensionVersion: "0.9.0",
      compatibleExtensionVersions: ["0.8.0", "0.9.0"],
      extensionId,
      enabled: true,
    },
  }), { ok: true, failures: [] });
});

test("missing compatibility sets, renderer CORS, or an origin-gated surface fail closed", () => {
  const missingSets = validateChromeDeploymentCompatibility({
    extensionVersion: "0.8.0",
    extensionId,
    ...matchingTargets,
    originProbeResults,
    web: { bridge: compatible.bridge, protocolVersion: 1, extensionVersion: "0.8.0", trustedExtensionId: extensionId },
    api: { bridge: compatible.bridge, protocolVersion: 1, extensionVersion: "0.8.0", extensionId, enabled: true },
  });
  assert.match(missingSets.failures.join("\n"), /compatibleExtensionVersions/);

  const missingOrigin = validateChromeDeploymentTargets({
    ...matchingTargets,
    allowedOrigins: ["https://other.example"],
  });
  assert.match(missingOrigin.failures.join("\n"), /AIRBOARD_ALLOWED_ORIGINS/);

  const failedProbe = validateChromeDeploymentCompatibility({
    extensionVersion: "0.8.0",
    extensionId,
    ...matchingTargets,
    originProbeResults: originProbeResults.map((probe) =>
      probe.id === "transcription-websocket"
        ? { ...probe, ok: false, detail: "Origin is not allowed" }
        : probe),
    web: { ...compatible, trustedExtensionId: extensionId },
    api: { ...compatible, extensionId, enabled: true },
  });
  assert.match(failedProbe.failures.join("\n"), /transcription\/ws.*Origin is not allowed/);
});

test("deployment compatibility rejects unbounded or inconsistent overlap windows", () => {
  const oversized = Array.from({ length: 9 }, (_, index) => `0.${index}.0`);
  const oversizedResult = validateChromeDeploymentCompatibility({
    extensionVersion: "0.8.0",
    extensionId,
    ...matchingTargets,
    originProbeResults,
    web: {
      ...compatible,
      compatibleExtensionVersions: oversized,
      trustedExtensionId: extensionId,
    },
    api: {
      ...compatible,
      compatibleExtensionVersions: oversized,
      extensionId,
      enabled: true,
    },
  });
  assert.match(oversizedResult.failures.join("\n"), /valid finite compatibleExtensionVersions/);

  const inconsistentResult = validateChromeDeploymentCompatibility({
    extensionVersion: "0.8.0",
    extensionId,
    ...matchingTargets,
    originProbeResults,
    web: {
      ...compatible,
      compatibleExtensionVersions: ["0.7.9", "0.8.0"],
      trustedExtensionId: extensionId,
    },
    api: { ...compatible, extensionId, enabled: true },
  });
  assert.match(inconsistentResult.failures.join("\n"), /sets do not match/);
});

test("HTTP Origin probes require browser-visible CORS as well as the auth boundary", () => {
  assert.deepEqual(evaluateChromeHttpOriginProbe({
    rendererOrigin: appUrl,
    status: 401,
    error: "AUTH_REQUIRED",
    accessControlAllowOrigin: appUrl,
  }), { ok: true, detail: "allowed origin reached authentication" });
  for (const accessControlAllowOrigin of [null, "https://other.example", "*"]) {
    const result = evaluateChromeHttpOriginProbe({
      rendererOrigin: appUrl,
      status: 401,
      error: "AUTH_REQUIRED",
      accessControlAllowOrigin,
    });
    assert.equal(result.ok, false);
    assert.match(result.detail, /Access-Control-Allow-Origin/);
  }
});

test("JSON POST Origin probes require a browser-usable CORS preflight", () => {
  assert.deepEqual(evaluateChromeCorsPreflightProbe({
    rendererOrigin: appUrl,
    status: 204,
    accessControlAllowOrigin: appUrl,
    accessControlAllowMethods: "GET, HEAD, POST",
    accessControlAllowHeaders: "Content-Type",
  }), { ok: true, detail: "CORS preflight accepted" });

  for (const input of [
    { status: 403, accessControlAllowOrigin: appUrl, accessControlAllowMethods: "POST", accessControlAllowHeaders: "content-type" },
    { status: 204, accessControlAllowOrigin: null, accessControlAllowMethods: "POST", accessControlAllowHeaders: "content-type" },
    { status: 204, accessControlAllowOrigin: appUrl, accessControlAllowMethods: "GET", accessControlAllowHeaders: "content-type" },
    { status: 204, accessControlAllowOrigin: appUrl, accessControlAllowMethods: "POST", accessControlAllowHeaders: null },
  ]) {
    const result = evaluateChromeCorsPreflightProbe({ rendererOrigin: appUrl, ...input });
    assert.equal(result.ok, false);
  }
});

test("packaging binds the compositor-reported extension version to the manifest", () => {
  assert.deepEqual(validateChromePackageVersionBindings({
    manifestVersion: "0.8.0",
    compositorSource: 'const EXTENSION_VERSION = "0.8.0";',
  }), { ok: true, failures: [] });
  assert.match(validateChromePackageVersionBindings({
    manifestVersion: "0.8.0",
    compositorSource: 'const EXTENSION_VERSION = "0.7.9";',
  }).failures.join("\n"), /expected manifest version 0\.8\.0/);
  assert.match(validateChromePackageVersionBindings({
    manifestVersion: "0.8.0",
    compositorSource: '// const EXTENSION_VERSION = "0.8.0";',
  }).failures.join("\n"), /does not declare EXTENSION_VERSION/);
});

test("source extraction fails if the background app is not relay-allowlisted", () => {
  assert.throws(
    () => extractChromeExtensionDeploymentTargets({
      backgroundSource: [
        'const API_URL = "https://api.example";',
        'const APP_URL = "https://web.example";',
      ].join("\n"),
      engineRelaySource: 'const AIRBOARD_ORIGINS = new Set(["https://other.example"]);',
    }),
    /APP_URL does not match the primary production origin/,
  );
});

test("a secondary allowlisted renderer cannot replace the primary shipped destination", () => {
  assert.throws(
    () => extractChromeExtensionDeploymentTargets({
      backgroundSource: [
        'const API_URL = "https://api.example";',
        'const APP_URL = "https://secondary.example";',
      ].join("\n"),
      engineRelaySource: [
        "const AIRBOARD_ORIGINS = new Set([",
        '  "https://primary.example",',
        '  "https://secondary.example",',
        "]);",
      ].join("\n"),
    }),
    /APP_URL does not match the primary production origin/,
  );
});

test("manifest, API, web, and background share one release contract", async () => {
  const [manifestSource, backgroundSource, apiContract, webDistribution] = await Promise.all([
    readFile(new URL("../../extensions/chrome-meet-bridge/manifest.json", import.meta.url), "utf8"),
    readFile(new URL("../../extensions/chrome-meet-bridge/background.js", import.meta.url), "utf8"),
    import("../../apps/api/src/chromeExtensionCompatibility.ts"),
    import("../../apps/web/src/platform/distribution.ts"),
  ]);
  const manifest = JSON.parse(manifestSource);
  assert.equal(apiContract.CHROME_EXTENSION_VERSION, manifest.version);
  assert.equal(webDistribution.CHROME_EXTENSION_VERSION, manifest.version);
  assert.equal(apiContract.CHROME_BRIDGE_MARKER, compatible.bridge);
  assert.equal(apiContract.CHROME_BRIDGE_PROTOCOL_VERSION, compatible.protocolVersion);
  assert.match(backgroundSource, /"X-Airboard-Bridge": "airboard-media-bridge"/);
  assert.match(backgroundSource, /"X-Airboard-Bridge-Protocol-Version"/);
  assert.match(backgroundSource, /"X-Airboard-Extension-Version"/);
});

test("Cloud Build passes the production trust ID and overlap set into Next", async () => {
  const [dockerfile, cloudbuild] = await Promise.all([
    readFile(new URL("../../infra/cloud-run/web.Dockerfile", import.meta.url), "utf8"),
    readFile(new URL("../../infra/cloud-run/cloudbuild-web.yaml", import.meta.url), "utf8"),
  ]);
  for (const name of [
    "NEXT_PUBLIC_AIRBOARD_CHROME_EXTENSION_ID",
    "NEXT_PUBLIC_AIRBOARD_CHROME_EXTENSION_COMPATIBLE_VERSIONS",
  ]) {
    assert.match(dockerfile, new RegExp(`ARG ${name}\\b`));
    assert.match(dockerfile, new RegExp(`ENV ${name}=\\$${name}\\b`));
    assert.match(cloudbuild, new RegExp(`--build-arg=${name}=\\$\\{_[A-Z_]+\\}`));
  }
  const trustGuard = dockerfile.indexOf(
    "NEXT_PUBLIC_AIRBOARD_CHROME_EXTENSION_ID must be the reviewed 32-character Web Store ID",
  );
  const productionBuild = dockerfile.indexOf("RUN pnpm --filter @airboard/web build");
  assert.ok(trustGuard >= 0 && trustGuard < productionBuild);
  assert.match(cloudbuild, /_AIRBOARD_CHROME_EXTENSION_ID:\s*""/);
  assert.match(cloudbuild, /_CHROME_EXTENSION_COMPATIBLE_VERSIONS:\s*"0\.8\.0"/);
  assert.match(
    dockerfile,
    /NEXT_PUBLIC_CHROME_WEB_STORE_URL must be the detail page for NEXT_PUBLIC_AIRBOARD_CHROME_EXTENSION_ID/,
  );
});
