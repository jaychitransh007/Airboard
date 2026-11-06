import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { extractChromeExtensionDeploymentTargets } from "../lib/chrome-deployment-compatibility.mjs";
import {
  loadExtensionTargets,
  resolveExtensionTarget,
  stampExtensionPackage,
} from "../lib/chrome-extension-targets.mjs";

const SOURCE_DIR = fileURLToPath(new URL("../../extensions/chrome-meet-bridge/", import.meta.url));
const STAMPED_FILES = ["background.js", "popup.js", "engine-relay.js", "engine.html", "content.js"];
const PILOT_API = "https://airboard-pilot-api-634900453473.asia-south1.run.app";
const PILOT_APP = "https://airboard-pilot-web-634900453473.asia-south1.run.app";
const PILOT_ALIAS = "https://airboard-pilot-web-efs77okmmq-el.a.run.app";
const DEV_ORIGIN = /localhost|127\.0\.0\.1/;

async function extensionSource() {
  const manifest = JSON.parse(await readFile(`${SOURCE_DIR}manifest.json`, "utf8"));
  const sources = Object.fromEntries(await Promise.all(STAMPED_FILES.map(async (file) =>
    [file, await readFile(`${SOURCE_DIR}${file}`, "utf8")])));
  return { manifest, sources };
}

const targets = await loadExtensionTargets(SOURCE_DIR);
const custom = {
  AIRBOARD_EXTENSION_TARGET: "production",
  AIRBOARD_EXTENSION_API_URL: "https://api.airboard.example",
  AIRBOARD_EXTENSION_APP_ORIGINS: "https://app.airboard.example, https://www.airboard.example",
};

test("the pilot target is the default, and a named target is chosen by AIRBOARD_EXTENSION_TARGET", () => {
  const pilot = resolveExtensionTarget({ targets, env: {} });
  assert.deepEqual({ ...pilot, appOrigins: [...pilot.appOrigins] }, {
    name: "pilot",
    apiUrl: PILOT_API,
    appUrl: PILOT_APP,
    appOrigins: [PILOT_APP, PILOT_ALIAS],
  });
  const staging = { apiUrl: "https://staging-api.example", appOrigins: ["https://staging.example"] };
  const chosen = resolveExtensionTarget({ targets: { ...targets, staging }, env: { AIRBOARD_EXTENSION_TARGET: "staging" } });
  assert.equal(chosen.name, "staging");
  assert.equal(chosen.appUrl, "https://staging.example");
  assert.throws(() => resolveExtensionTarget({ targets, env: { AIRBOARD_EXTENSION_TARGET: "nowhere" } }), /Unknown extension target "nowhere"/);
});

test("a new domain can be packaged from the environment without editing targets.json", () => {
  const target = resolveExtensionTarget({ targets, env: custom });
  assert.equal(target.name, "production");
  assert.equal(target.apiUrl, "https://api.airboard.example");
  assert.deepEqual([...target.appOrigins], ["https://app.airboard.example", "https://www.airboard.example"]);
  assert.equal(resolveExtensionTarget({ targets, env: { ...custom, AIRBOARD_EXTENSION_TARGET: "" } }).name, "custom");
  assert.throws(
    () => resolveExtensionTarget({ targets, env: { AIRBOARD_EXTENSION_API_URL: "https://api.airboard.example" } }),
    /must be set together/,
  );
  assert.throws(
    () => resolveExtensionTarget({ targets, env: { ...custom, AIRBOARD_EXTENSION_TARGET: "pilot" } }),
    /defined in targets\.json/,
    "an override can't masquerade as the pilot",
  );
});

test("every packaged address must be a plain HTTPS origin", () => {
  const resolveWith = (overrides) => () => resolveExtensionTarget({ targets, env: { ...custom, ...overrides } });
  assert.throws(resolveWith({ AIRBOARD_EXTENSION_API_URL: "http://api.airboard.example" }), /must use HTTPS/);
  assert.throws(resolveWith({ AIRBOARD_EXTENSION_APP_ORIGINS: "https://app.airboard.example,http://localhost:3000" }), /must use HTTPS/);
  assert.throws(resolveWith({ AIRBOARD_EXTENSION_API_URL: "https://api.airboard.example/v1" }), /no path/);
  assert.throws(resolveWith({ AIRBOARD_EXTENSION_APP_ORIGINS: "https://user:secret@app.airboard.example" }), /credentials/);
  assert.throws(resolveWith({ AIRBOARD_EXTENSION_APP_ORIGINS: "https://app.airboard.example?x=1" }), /no path, query/);
  assert.throws(resolveWith({ AIRBOARD_EXTENSION_APP_ORIGINS: "https://app.airboard.example,https://app.airboard.example" }), /twice/);
  assert.throws(resolveWith({ AIRBOARD_EXTENSION_APP_ORIGINS: "not a url" }), /not a valid URL/);
  assert.throws(resolveWith({ AIRBOARD_EXTENSION_TARGET: "Prod Domain" }), /lowercase/);
  for (const [name, target] of Object.entries(targets)) {
    assert.doesNotThrow(() => resolveExtensionTarget({ targets, env: { AIRBOARD_EXTENSION_TARGET: name } }), `${name} in targets.json`);
    assert.ok(target.appOrigins.length > 0);
  }
});

test("the package for a new domain carries only that domain's addresses", async () => {
  const source = await extensionSource();
  const target = resolveExtensionTarget({ targets, env: custom });
  const { manifest, sources } = stampExtensionPackage({ ...source, target });

  assert.deepEqual(manifest.host_permissions, ["https://api.airboard.example/*"]);
  assert.deepEqual(manifest.externally_connectable.matches, ["https://app.airboard.example/*", "https://www.airboard.example/*"]);
  assert.equal(
    manifest.content_security_policy.extension_pages,
    "script-src 'self'; object-src 'self'; frame-src https://app.airboard.example https://www.airboard.example",
  );
  const unchanged = (value) => {
    const copy = structuredClone(value);
    delete copy.host_permissions;
    delete copy.externally_connectable;
    delete copy.content_security_policy;
    return copy;
  };
  assert.deepEqual(unchanged(manifest), unchanged(source.manifest), "nothing else in the manifest moves");

  assert.deepEqual(
    extractChromeExtensionDeploymentTargets({ backgroundSource: sources["background.js"], engineRelaySource: sources["engine-relay.js"] }),
    { appUrl: "https://app.airboard.example", apiUrl: "https://api.airboard.example" },
  );
  assert.match(sources["popup.js"], /^const APP_URL = "https:\/\/app\.airboard\.example";$/m);
  assert.match(sources["engine-relay.js"], /new Set\(\[\n {2}"https:\/\/app\.airboard\.example",\n {2}"https:\/\/www\.airboard\.example",\n\]\);/);
  assert.match(sources["engine.html"], /data-engine-src="https:\/\/app\.airboard\.example\/meet\/overlay-engine"/);
  assert.equal(sources["content.js"], source.sources["content.js"], "files without addresses pass through");

  const packaged = [JSON.stringify(manifest), ...Object.values(sources)].join("\n");
  assert.doesNotMatch(packaged, /airboard-pilot/, "no pilot address is left behind");
  assert.doesNotMatch(packaged, DEV_ORIGIN, "no development origin is left behind");
});

test("the unpacked source carries the pilot target, so pilot packages match it minus local origins", async () => {
  const source = await extensionSource();
  const { manifest, sources } = stampExtensionPackage({ ...source, target: resolveExtensionTarget({ targets, env: {} }) });

  // What the packager did before targets existed: drop the development entries.
  const withoutDev = structuredClone(source.manifest);
  withoutDev.host_permissions = withoutDev.host_permissions.filter((origin) => !DEV_ORIGIN.test(origin));
  withoutDev.externally_connectable.matches = withoutDev.externally_connectable.matches.filter((origin) => !DEV_ORIGIN.test(origin));
  withoutDev.content_security_policy.extension_pages = withoutDev.content_security_policy.extension_pages
    .replace(/\s+http:\/\/(localhost|127\.0\.0\.1):\d+/g, "");
  assert.deepEqual(manifest, withoutDev, "manifest.json and targets.json disagree about the pilot");
  for (const file of STAMPED_FILES) {
    assert.equal(sources[file], source.sources[file].replace(/^\s*"http:\/\/(localhost|127\.0\.0\.1):\d+",?\n/gm, ""), `${file} and targets.json disagree about the pilot`);
  }
});

test("stamping fails loudly when a source no longer declares an address where expected", async () => {
  const source = await extensionSource();
  const target = resolveExtensionTarget({ targets, env: {} });
  assert.throws(
    () => stampExtensionPackage({ ...source, target, sources: { ...source.sources, "background.js": "const APP_URL = \"https://x.example\";\n" } }),
    /exactly one const API_URL; found 0/,
  );
  assert.throws(
    () => stampExtensionPackage({ ...source, target, sources: { ...source.sources, "engine.html": "<iframe></iframe>" } }),
    /data-engine-src/,
  );
  const { ["popup.js"]: _omitted, ...withoutPopup } = source.sources;
  assert.throws(() => stampExtensionPackage({ ...source, target, sources: withoutPopup }), /Missing extension source popup\.js/);
});
