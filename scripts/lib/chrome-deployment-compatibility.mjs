const CHROME_EXTENSION_ID = /^[a-p]{32}$/;
const CHROME_EXTENSION_VERSION = /^\d+\.\d+\.\d+$/;
const MAX_COMPATIBLE_EXTENSION_VERSIONS = 8;
const CHROME_WEB_STORE_ORIGIN = "https://chromewebstore.google.com";

export const CHROME_ORIGIN_GATED_API_SURFACES = Object.freeze([
  { id: "semantic-intent", method: "POST", path: "/intent/resolve" },
  { id: "voice-trace-write", method: "POST", path: "/voice/trace" },
  { id: "voice-metrics", method: "GET", path: "/voice/metrics" },
  {
    id: "voice-trace-read",
    method: "GET",
    path: "/voice/trace/00000000-0000-4000-8000-000000000000",
  },
  { id: "transcription-websocket", method: "WEBSOCKET", path: "/transcription/ws" },
]);

export function extractJavaScriptStringConstant(source, name) {
  const match = source.match(
    new RegExp(`^[ \\t]*const\\s+${name}\\s*=\\s*("(?:[^"\\\\]|\\\\.)*")\\s*;`, "m"),
  );
  if (!match) {
    throw new Error(`The extension source does not declare ${name} as a string constant.`);
  }
  return JSON.parse(match[1]);
}

export function normalizeChromeWebStoreUrlForExtension(value, extensionId) {
  const candidate = typeof value === "string" ? value.trim() : "";
  const expectedId = typeof extensionId === "string" ? extensionId.trim() : "";
  if (!candidate || !CHROME_EXTENSION_ID.test(expectedId)) return null;
  try {
    const url = new URL(candidate);
    const pathSegments = url.pathname.split("/").filter(Boolean);
    const listedExtensionId = pathSegments.at(-1) ?? "";
    if (
      url.origin !== CHROME_WEB_STORE_ORIGIN ||
      url.username ||
      url.password ||
      pathSegments[0] !== "detail" ||
      (pathSegments.length !== 2 && pathSegments.length !== 3) ||
      !CHROME_EXTENSION_ID.test(listedExtensionId) ||
      listedExtensionId !== expectedId
    ) {
      return null;
    }
    return url.toString();
  } catch {
    return null;
  }
}

function normalizedRootUrl(value, label) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${label} is not a valid URL.`);
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new Error(`${label} must not contain credentials, a query, or a fragment.`);
  }
  return url.toString().replace(/\/$/, "");
}

/** Reads the destinations compiled into the extension package sources. */
export function extractChromeExtensionDeploymentTargets(input) {
  const appUrl = normalizedRootUrl(
    extractJavaScriptStringConstant(input.backgroundSource, "APP_URL"),
    "The extension APP_URL",
  );
  const apiUrl = normalizedRootUrl(
    extractJavaScriptStringConstant(input.backgroundSource, "API_URL"),
    "The extension API_URL",
  );
  const relayOriginsBlock = input.engineRelaySource.match(
    /\bconst\s+AIRBOARD_ORIGINS\s*=\s*new Set\s*\(\s*\[([\s\S]*?)\]\s*\)\s*;/,
  )?.[1];
  if (!relayOriginsBlock) {
    throw new Error("The extension relay does not declare AIRBOARD_ORIGINS.");
  }
  const relayOrigins = [...relayOriginsBlock.matchAll(/"([^"\\]*(?:\\.[^"\\]*)*)"/g)]
    .map((match) => normalizedRootUrl(JSON.parse(`"${match[1]}"`), "An extension relay origin"));
  const relayAppUrl = relayOrigins.find((origin) => origin.startsWith("https://"));
  if (!relayAppUrl) {
    throw new Error("The extension relay does not declare a production HTTPS Airboard origin.");
  }
  if (relayAppUrl !== appUrl) {
    throw new Error(
      "The extension APP_URL does not match the primary production origin in engine-relay.js.",
    );
  }
  return { appUrl: relayAppUrl, apiUrl };
}

export function validateChromeDeploymentTargets(input) {
  const failures = [];
  if (input.configuredAppUrl !== input.extensionAppUrl) {
    failures.push(
      `AIRBOARD_APP_URL targets ${String(input.configuredAppUrl)}; the extension renderer targets ${String(input.extensionAppUrl)}.`,
    );
  }
  if (input.configuredApiUrl !== input.extensionApiUrl) {
    failures.push(
      `NEXT_PUBLIC_AIRBOARD_API_URL targets ${String(input.configuredApiUrl)}; the extension targets ${String(input.extensionApiUrl)}.`,
    );
  }
  const rendererOrigin = origin(input.configuredAppUrl);
  const allowedOrigins = Array.isArray(input.allowedOrigins)
    ? input.allowedOrigins.map(origin).filter(Boolean)
    : [];
  if (!rendererOrigin || !allowedOrigins.includes(rendererOrigin)) {
    failures.push(
      `AIRBOARD_ALLOWED_ORIGINS does not include the renderer origin ${String(rendererOrigin ?? input.configuredAppUrl)}.`,
    );
  }
  return { ok: failures.length === 0, failures };
}

export function validateChromeDeploymentCompatibility(input) {
  const expected = {
    bridge: "airboard-media-bridge",
    protocolVersion: 1,
  };
  const failures = [...validateChromeDeploymentTargets(input).failures];

  if (!CHROME_EXTENSION_ID.test(input.extensionId ?? "")) {
    failures.push("The configured Chrome Web Store extension ID is invalid.");
  }
  const configuredStoreUrl =
    typeof input.chromeWebStoreUrl === "string" && input.chromeWebStoreUrl.trim()
      ? input.chromeWebStoreUrl.trim()
      : null;
  const normalizedStoreUrl = configuredStoreUrl
    ? normalizeChromeWebStoreUrlForExtension(configuredStoreUrl, input.extensionId)
    : null;
  if (configuredStoreUrl && !normalizedStoreUrl) {
    failures.push(
      "NEXT_PUBLIC_CHROME_WEB_STORE_URL is not the detail page for the configured release extension ID.",
    );
  }
  for (const [service, response] of [["web", input.web], ["api", input.api]]) {
    if (!response || typeof response !== "object") {
      failures.push(`The deployed ${service} compatibility response is missing.`);
      continue;
    }
    for (const [key, value] of Object.entries(expected)) {
      if (response[key] !== value) {
        failures.push(
          `The deployed ${service} reports ${key}=${String(response[key])}; expected ${String(value)}.`,
        );
      }
    }
    const deployedVersion = response.extensionVersion;
    const compatibleVersions = response.compatibleExtensionVersions;
    if (!CHROME_EXTENSION_VERSION.test(deployedVersion ?? "")) {
      failures.push(`The deployed ${service} reports an invalid current extension version.`);
    }
    if (!validCompatibleVersionSet(compatibleVersions)) {
      failures.push(
        `The deployed ${service} does not report a valid finite compatibleExtensionVersions set.`,
      );
    } else {
      if (!compatibleVersions.includes(input.extensionVersion)) {
        failures.push(
          `The deployed ${service} does not declare extension ${String(input.extensionVersion)} capability-compatible.`,
        );
      }
      if (
        CHROME_EXTENSION_VERSION.test(deployedVersion ?? "") &&
        !compatibleVersions.includes(deployedVersion)
      ) {
        failures.push(
          `The deployed ${service} current version is outside its compatibility set.`,
        );
      }
    }
  }
  if (
    validCompatibleVersionSet(input.web?.compatibleExtensionVersions) &&
    validCompatibleVersionSet(input.api?.compatibleExtensionVersions) &&
    !sameVersionSet(
      input.web.compatibleExtensionVersions,
      input.api.compatibleExtensionVersions,
    )
  ) {
    failures.push(
      "The deployed web and API compatibleExtensionVersions sets do not match.",
    );
  }
  if (input.web?.trustedExtensionId !== input.extensionId) {
    failures.push("The deployed renderer does not trust the release extension ID.");
  }
  const webContract = input.web && typeof input.web === "object" ? input.web : null;
  if (!webContract || !Object.hasOwn(webContract, "chromeWebStoreUrl")) {
    failures.push("The deployed renderer does not report its Chrome Web Store listing binding.");
  } else if (webContract.chromeWebStoreUrl !== normalizedStoreUrl) {
    failures.push(
      "The deployed renderer Chrome Web Store listing does not match NEXT_PUBLIC_CHROME_WEB_STORE_URL.",
    );
  }
  if (input.api?.extensionId !== input.extensionId) {
    failures.push("The deployed API does not restrict credentials to the release extension ID.");
  }
  if (input.api?.enabled !== true) {
    failures.push("The deployed API Chrome extension switch is not enabled.");
  }
  const originProbeResults = new Map(
    Array.isArray(input.originProbeResults)
      ? input.originProbeResults.map((result) => [result?.id, result])
      : [],
  );
  for (const surface of CHROME_ORIGIN_GATED_API_SURFACES) {
    const probe = originProbeResults.get(surface.id);
    if (probe?.ok !== true) {
      failures.push(
        `The deployed API did not accept the renderer Origin on ${surface.path}${probe?.detail ? ` (${probe.detail})` : ""}.`,
      );
    }
  }

  return { ok: failures.length === 0, failures };
}

export function validateChromePackageVersionBindings(input) {
  const failures = [];
  if (!CHROME_EXTENSION_VERSION.test(input.manifestVersion ?? "")) {
    failures.push("The manifest extension version is invalid.");
  }
  let compositorVersion = null;
  try {
    compositorVersion = extractJavaScriptStringConstant(
      input.compositorSource,
      "EXTENSION_VERSION",
    );
  } catch (error) {
    failures.push(error instanceof Error ? error.message : String(error));
  }
  if (compositorVersion !== null && compositorVersion !== input.manifestVersion) {
    failures.push(
      `The compositor reports extension version ${String(compositorVersion)}; expected manifest version ${String(input.manifestVersion)}.`,
    );
  }
  return { ok: failures.length === 0, failures };
}

export function evaluateChromeHttpOriginProbe(input) {
  const corsMatches = input.accessControlAllowOrigin === input.rendererOrigin;
  const authenticationReached = input.status === 401 && input.error === "AUTH_REQUIRED";
  return {
    ok: corsMatches && authenticationReached,
    detail: !corsMatches
      ? `Access-Control-Allow-Origin=${String(input.accessControlAllowOrigin ?? "missing")}; expected ${String(input.rendererOrigin)}`
      : authenticationReached
        ? "allowed origin reached authentication"
        : `HTTP ${String(input.status)}: ${String(input.error ?? "unexpected response")}`,
  };
}

export function evaluateChromeCorsPreflightProbe(input) {
  const allowedMethods = commaSeparatedTokens(input.accessControlAllowMethods);
  const allowedHeaders = commaSeparatedTokens(input.accessControlAllowHeaders);
  const failures = [];
  if (input.status !== 204) {
    failures.push(`HTTP ${String(input.status)}; expected 204`);
  }
  if (input.accessControlAllowOrigin !== input.rendererOrigin) {
    failures.push(
      `Access-Control-Allow-Origin=${String(input.accessControlAllowOrigin ?? "missing")}; expected ${String(input.rendererOrigin)}`,
    );
  }
  if (!allowedMethods.includes("post")) {
    failures.push("Access-Control-Allow-Methods does not include POST");
  }
  if (!allowedHeaders.includes("content-type")) {
    failures.push("Access-Control-Allow-Headers does not include content-type");
  }
  return {
    ok: failures.length === 0,
    detail: failures.length === 0 ? "CORS preflight accepted" : failures.join("; "),
  };
}

function validCompatibleVersionSet(value) {
  return Array.isArray(value) &&
    value.length > 0 &&
    value.length <= MAX_COMPATIBLE_EXTENSION_VERSIONS &&
    new Set(value).size === value.length &&
    value.every((version) => typeof version === "string" && CHROME_EXTENSION_VERSION.test(version));
}

function sameVersionSet(left, right) {
  return left.length === right.length && left.every((version) => right.includes(version));
}

function commaSeparatedTokens(value) {
  return typeof value === "string"
    ? value.split(",").map((token) => token.trim().toLowerCase()).filter(Boolean)
    : [];
}

function origin(value) {
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}
