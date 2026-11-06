import { readFile } from "node:fs/promises";
import path from "node:path";

/**
 * Where a packaged extension points. `extensions/chrome-meet-bridge/targets.json`
 * names each release target's Airboard API and the web origins allowed to host
 * the overlay renderer; the first web origin is the app itself, the rest are
 * aliases of the same deployment. The unpacked source keeps the pilot
 * target's addresses, plus local development origins, so it loads as is; the
 * packager stamps the chosen target into the package.
 */
export const DEFAULT_EXTENSION_TARGET = "pilot";

const TARGET_NAME = /^[a-z][a-z0-9-]{0,31}$/;

export async function loadExtensionTargets(sourceDir) {
  return JSON.parse(await readFile(path.join(sourceDir, "targets.json"), "utf8"));
}

/**
 * The target named by AIRBOARD_EXTENSION_TARGET (default "pilot"), or, for a
 * domain not yet in targets.json, AIRBOARD_EXTENSION_API_URL with
 * AIRBOARD_EXTENSION_APP_ORIGINS (comma-separated, app first).
 */
export function resolveExtensionTarget({ targets, env }) {
  const apiOverride = env.AIRBOARD_EXTENSION_API_URL?.trim();
  const appOverride = env.AIRBOARD_EXTENSION_APP_ORIGINS?.trim();
  const named = env.AIRBOARD_EXTENSION_TARGET?.trim();
  if (apiOverride || appOverride) {
    if (!apiOverride || !appOverride) {
      throw new Error("AIRBOARD_EXTENSION_API_URL and AIRBOARD_EXTENSION_APP_ORIGINS must be set together.");
    }
    const name = named || "custom";
    if (Object.hasOwn(targets, name)) {
      throw new Error(`Target "${name}" is defined in targets.json; give the override its own name.`);
    }
    return validateExtensionTarget(name, { apiUrl: apiOverride, appOrigins: appOverride.split(",") });
  }
  const name = named || DEFAULT_EXTENSION_TARGET;
  if (!Object.hasOwn(targets, name)) {
    throw new Error(`Unknown extension target "${name}". Known targets: ${Object.keys(targets).join(", ")}.`);
  }
  return validateExtensionTarget(name, targets[name]);
}

export function validateExtensionTarget(name, raw) {
  if (!TARGET_NAME.test(name)) {
    throw new Error(`Extension target name "${name}" must be lowercase letters, digits and dashes.`);
  }
  const apiUrl = httpsOrigin(raw?.apiUrl, `${name} apiUrl`);
  if (!Array.isArray(raw?.appOrigins) || raw.appOrigins.length === 0) {
    throw new Error(`${name} needs at least one web origin.`);
  }
  const appOrigins = raw.appOrigins.map((value) => httpsOrigin(value, `${name} web origin`));
  if (new Set(appOrigins).size !== appOrigins.length) {
    throw new Error(`${name} lists a web origin twice.`);
  }
  return Object.freeze({ name, apiUrl, appUrl: appOrigins[0], appOrigins: Object.freeze(appOrigins) });
}

function httpsOrigin(value, label) {
  const text = typeof value === "string" ? value.trim() : "";
  let url;
  try {
    url = new URL(text);
  } catch {
    throw new Error(`${label} is not a valid URL: ${JSON.stringify(value)}.`);
  }
  if (url.protocol !== "https:") {
    throw new Error(`${label} must use HTTPS: ${text}.`);
  }
  if (url.username || url.password || url.pathname !== "/" || url.search || url.hash) {
    throw new Error(`${label} must be an origin with no path, query, fragment or credentials: ${text}.`);
  }
  return url.origin;
}

/**
 * Writes the target's addresses into the manifest and the scripts that carry
 * them. Local development origins in the source are dropped along the way.
 * `sources` maps file names to their text; files without addresses pass
 * through unchanged.
 */
export function stampExtensionPackage({ manifest, sources, target }) {
  const stampedManifest = structuredClone(manifest);
  stampedManifest.host_permissions = [`${target.apiUrl}/*`];
  stampedManifest.externally_connectable = {
    ...stampedManifest.externally_connectable,
    matches: target.appOrigins.map((origin) => `${origin}/*`),
  };
  const csp = stampedManifest.content_security_policy?.extension_pages ?? "";
  stampedManifest.content_security_policy.extension_pages = replaceOnce(
    csp,
    /frame-src[^;]*/,
    `frame-src ${target.appOrigins.join(" ")}`,
    "the manifest's frame-src",
  );

  const stamped = { ...sources };
  const edit = (file, change) => {
    if (typeof stamped[file] !== "string") throw new Error(`Missing extension source ${file}.`);
    stamped[file] = change(stamped[file]);
  };
  edit("background.js", (source) =>
    stringConstant(stringConstant(source, "API_URL", target.apiUrl), "APP_URL", target.appUrl));
  edit("popup.js", (source) => stringConstant(source, "APP_URL", target.appUrl));
  edit("engine-relay.js", (source) => replaceOnce(
    source,
    /(const AIRBOARD_ORIGINS = new Set\(\[\n)[\s\S]*?(\]\);)/,
    (_, open, close) => `${open}${target.appOrigins.map((origin) => `  ${JSON.stringify(origin)},\n`).join("")}${close}`,
    "AIRBOARD_ORIGINS in engine-relay.js",
  ));
  edit("engine.html", (source) => replaceOnce(
    source,
    /data-engine-src="[^"]*"/,
    `data-engine-src="${target.appUrl}/meet/overlay-engine"`,
    "data-engine-src in engine.html",
  ));
  return { manifest: stampedManifest, sources: stamped };
}

function stringConstant(source, name, value) {
  return replaceOnce(
    source,
    new RegExp(`^([ \\t]*const\\s+${name}\\s*=\\s*)"(?:[^"\\\\]|\\\\.)*"(\\s*;)`, "m"),
    (_, open, close) => `${open}${JSON.stringify(value)}${close}`,
    `const ${name}`,
  );
}

function replaceOnce(source, pattern, replacement, label) {
  const global = new RegExp(pattern.source, pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`);
  const count = [...source.matchAll(global)].length;
  if (count !== 1) throw new Error(`Expected exactly one ${label}; found ${count}.`);
  // A function keeps "$" in a replacement literal.
  return source.replace(pattern, typeof replacement === "function" ? replacement : () => replacement);
}
