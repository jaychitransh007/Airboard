import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import test from "node:test";

import { movedAdminSection, SETTINGS_SECTIONS, settingsSectionTitle, WORKSPACE_ADMIN_SECTIONS, WORKSPACE_SECTIONS } from "../src/features/product/pageTitles.ts";

const webRoot = resolve(import.meta.dirname, "..");
const css = readFileSync(join(webRoot, "app/globals.css"), "utf8");

/** Every top-level and nested rule as [selector, body]; good enough for this stylesheet. */
function rules(source) {
  const found = [];
  const pattern = /([^{}]+)\{([^{}]*)\}/g;
  for (const match of source.replace(/\/\*[\s\S]*?\*\//g, "").matchAll(pattern)) {
    found.push([match[1].trim(), match[2]]);
  }
  return found;
}

test("keyboard focus rings are opaque, so they keep 3:1 against the surface", () => {
  const translucent = rules(css)
    .filter(([selector]) => selector.includes(":focus"))
    .flatMap(([selector, body]) =>
      [...body.matchAll(/outline(?:-color)?\s*:\s*([^;]+)/g)]
        .map((match) => match[1])
        .filter((value) => /rgba\(|hsla\(|transparent/.test(value))
        .map((value) => `${selector} → ${value}`),
    );
  assert.deepEqual(translucent, []);
});

test("reduced motion applies to every element, not only the product shells", () => {
  const block = css.match(/@media \(prefers-reduced-motion: reduce\) \{\s*([^{]+)\{([^}]*)\}/);
  assert.ok(block, "a prefers-reduced-motion: reduce block exists");
  assert.match(block[1], /^\*, \*::before, \*::after\s*$/);
  assert.match(block[2], /animation-duration: 0\.01ms !important/);
  assert.match(block[2], /transition-duration: 0\.01ms !important/);
});

function pageFiles(directory) {
  return readdirSync(directory).flatMap((name) => {
    const path = join(directory, name);
    if (statSync(path).isDirectory()) return pageFiles(path);
    return name === "page.tsx" || name === "not-found.tsx" ? [path] : [];
  });
}

test("every page names itself in the browser title", () => {
  // The landing page keeps the site title; Meet's add-on frames are never a
  // browser tab; onboarding and the pages folded into the home page or
  // Settings only redirect.
  const exempt = new Set([
    "app/page.tsx",
    "app/onboarding/page.tsx",
    "app/app/boards/page.tsx",
    "app/app/[section]/page.tsx",
    "app/app/integrations/page.tsx",
    "app/app/admin/[section]/page.tsx",
  ]);
  const missing = pageFiles(join(webRoot, "app"))
    .map((path) => relative(webRoot, path))
    .filter((path) => !exempt.has(path) && !path.startsWith("app/meet/"))
    .filter((path) => !/export (const metadata|(async )?function generateMetadata)/.test(readFileSync(join(webRoot, path), "utf8")));
  assert.deepEqual(missing, []);
});

test("section pages have distinct titles, so route changes are announced", () => {
  const titles = [...SETTINGS_SECTIONS, ...WORKSPACE_SECTIONS, ...WORKSPACE_ADMIN_SECTIONS]
    .map(([id]) => settingsSectionTitle(id));
  assert.equal(new Set(titles).size, titles.length);
  assert.equal(settingsSectionTitle("privacy-data"), "Privacy & data · Settings");
  assert.equal(settingsSectionTitle("members"), "Members · Settings");
  assert.equal(settingsSectionTitle("nothing-here"), "Settings");
});

test("old Administration links land on the same page in Settings", () => {
  assert.equal(movedAdminSection("members"), "members");
  assert.equal(movedAdminSection("audit-logs"), "audit-logs");
  assert.equal(movedAdminSection("overview"), "workspace");
  assert.equal(movedAdminSection("installations"), "workspace");
  assert.equal(movedAdminSection("anything-else"), "workspace");
});
