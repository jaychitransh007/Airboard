import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const sourceDir = path.join(root, "extensions/chrome-meet-bridge");
const manifest = JSON.parse(await readFile(path.join(sourceDir, "manifest.json"), "utf8"));
const outputRoot = path.join(root, "dist/chrome-extension");
const packageDir = path.join(outputRoot, `airboard-for-google-meet-${manifest.version}`);
const archive = path.join(outputRoot, `airboard-for-google-meet-${manifest.version}.zip`);
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

// Chrome Web Store requires manifest.json at the archive root.
execFileSync("/usr/bin/zip", ["-qr", archive, "."], { cwd: packageDir });
const checksum = createHash("sha256").update(await readFile(archive)).digest("hex");
await writeFile(`${archive}.sha256`, `${checksum}  ${path.basename(archive)}\n`);

console.log(JSON.stringify({ ok: true, version: manifest.version, archive, sha256: checksum }, null, 2));
