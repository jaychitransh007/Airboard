import assert from "node:assert/strict";
import test from "node:test";

import { normalizeChromeWebStoreUrl } from "../src/platform/distribution.ts";

test("accepts only a real Chrome Web Store detail URL", () => {
  assert.equal(
    normalizeChromeWebStoreUrl("https://chromewebstore.google.com/detail/airboard/abcdefghijklmnop"),
    "https://chromewebstore.google.com/detail/airboard/abcdefghijklmnop",
  );
  assert.equal(normalizeChromeWebStoreUrl("https://example.com/extension.zip"), null);
  assert.equal(normalizeChromeWebStoreUrl("http://chromewebstore.google.com/detail/airboard/id"), null);
  assert.equal(normalizeChromeWebStoreUrl(undefined), null);
});
