import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { validateChromePackageVersionBindings } from "./lib/chrome-deployment-compatibility.mjs";

const root = process.cwd();
const sourceDir = path.join(root, "extensions/chrome-meet-bridge");
const [manifestSource, compositorSource] = await Promise.all([
  readFile(path.join(sourceDir, "manifest.json"), "utf8"),
  readFile(path.join(sourceDir, "compositor.js"), "utf8"),
]);
const manifest = JSON.parse(manifestSource);
const outputRoot = path.join(root, "dist/chrome-extension");
const packageDir = path.join(outputRoot, `airboard-for-google-meet-${manifest.version}`);
const archive = path.join(outputRoot, `airboard-for-google-meet-${manifest.version}.zip`);
const permissionReview = path.join(outputRoot, `airboard-for-google-meet-${manifest.version}.permission-review.json`);
const sourceFiles = [
  "background.js",
  "compositor.js",
  "content.js",
  "engine-relay.js",
  "engine.html",
  "popup.css",
  "popup.html",
  "popup.js",
];

const versionBinding = validateChromePackageVersionBindings({
  manifestVersion: manifest.version,
  compositorSource,
});
if (!versionBinding.ok) {
  throw new Error(versionBinding.failures.join("\n"));
}

await rm(outputRoot, { recursive: true, force: true });
await mkdir(packageDir, { recursive: true });

manifest.host_permissions = manifest.host_permissions.filter((origin) => origin.startsWith("https://"));
manifest.externally_connectable.matches = manifest.externally_connectable.matches.filter((origin) => origin.startsWith("https://"));
manifest.content_security_policy.extension_pages = manifest.content_security_policy.extension_pages
  .replace(/\s+http:\/\/localhost:\d+/g, "")
  .replace(/\s+http:\/\/127\.0\.0\.1:\d+/g, "");
const productionManifest = `${JSON.stringify(manifest, null, 2)}\n`;
await writeFile(path.join(packageDir, "manifest.json"), productionManifest);

for (const file of sourceFiles) {
  let source = await readFile(path.join(sourceDir, file), "utf8");
  source = source
    .replace(/^\s*"http:\/\/localhost:\d+",?\n/gm, "")
    .replace(/^\s*"http:\/\/127\.0\.0\.1:\d+",?\n/gm, "");
  await writeFile(path.join(packageDir, file), source);
}
await cp(path.join(sourceDir, "icons"), path.join(packageDir, "icons"), { recursive: true });

const packagedFiles = [productionManifest, ...await Promise.all(sourceFiles.map((file) => readFile(path.join(packageDir, file), "utf8")))];
if (packagedFiles.some((source) => /localhost|127\.0\.0\.1/.test(source))) {
  throw new Error("Production extension still contains a development origin.");
}
if (!manifest.icons?.["128"] || !manifest.action?.default_icon) {
  throw new Error("Chrome Web Store package is missing required product icons.");
}
if (typeof manifest.description !== "string" || manifest.description.length > 132) {
  throw new Error("Chrome Web Store description is missing or exceeds 132 characters.");
}
if (JSON.stringify(manifest.permissions) !== JSON.stringify(["storage", "alarms"])) {
  throw new Error("Chrome extension permissions changed without updating the reviewed minimum set.");
}
if (JSON.stringify(manifest.host_permissions) !== JSON.stringify([
  "https://airboard-pilot-api-634900453473.asia-south1.run.app/*",
])) {
  throw new Error("Chrome host permissions changed without review.");
}
if (
  !Array.isArray(manifest.content_scripts) ||
  manifest.content_scripts.length !== 2 ||
  manifest.content_scripts.some((entry) =>
    JSON.stringify(entry.matches) !== JSON.stringify(["https://meet.google.com/*"]))
) {
  throw new Error("Chrome content scripts must remain scoped to Google Meet.");
}
if (
  !Array.isArray(manifest.web_accessible_resources) ||
  manifest.web_accessible_resources.length !== 1 ||
  manifest.web_accessible_resources.some((entry) =>
    JSON.stringify(entry.matches) !== JSON.stringify(["https://meet.google.com/*"]))
) {
  throw new Error("Extension relay resources must remain scoped to Google Meet.");
}
if (JSON.stringify(manifest.externally_connectable?.matches) !== JSON.stringify([
  "https://airboard-pilot-web-634900453473.asia-south1.run.app/*",
  "https://airboard-pilot-web-efs77okmmq-el.a.run.app/*",
])) {
  throw new Error("Externally connectable web origins changed without review.");
}

await writeFile(permissionReview, `${JSON.stringify({
  version: manifest.version,
  description: manifest.description,
  permissions: manifest.permissions,
  hostPermissions: manifest.host_permissions,
  contentScripts: manifest.content_scripts,
  externallyConnectable: manifest.externally_connectable,
  webAccessibleResources: manifest.web_accessible_resources,
  reviewedAtBuildTime: new Date().toISOString(),
}, null, 2)}\n`);

// Chrome Web Store requires manifest.json at the archive root.
execFileSync("/usr/bin/zip", ["-qr", archive, "."], { cwd: packageDir });
const checksum = createHash("sha256").update(await readFile(archive)).digest("hex");
await writeFile(`${archive}.sha256`, `${checksum}  ${path.basename(archive)}\n`);

console.log(JSON.stringify({ ok: true, version: manifest.version, archive, sha256: checksum, permissionReview }, null, 2));
