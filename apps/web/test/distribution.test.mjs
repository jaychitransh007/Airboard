import assert from "node:assert/strict";
import test from "node:test";

import { normalizeChromeWebStoreUrl } from "../src/platform/distribution.ts";

const extensionId = "abcdefghijklmnopabcdefghijklmnop";
const otherExtensionId = "ponmlkjihgfedcbaponmlkjihgfedcba";

test("accepts only the Chrome Web Store detail URL for the trusted package", () => {
  const listing = `https://chromewebstore.google.com/detail/airboard/${extensionId}`;
  assert.equal(
    normalizeChromeWebStoreUrl(listing, extensionId),
    listing,
  );
  assert.equal(
    normalizeChromeWebStoreUrl(
      `https://chromewebstore.google.com/detail/airboard/${otherExtensionId}`,
      extensionId,
    ),
    null,
  );
  assert.equal(normalizeChromeWebStoreUrl(listing, undefined), null);
  assert.equal(normalizeChromeWebStoreUrl("https://example.com/extension.zip", extensionId), null);
  assert.equal(
    normalizeChromeWebStoreUrl(
      "http://chromewebstore.google.com/detail/airboard/abcdefghijklmnop",
      extensionId,
    ),
    null,
  );
  assert.equal(
    normalizeChromeWebStoreUrl(
      `https://chromewebstore.google.com/detail/airboard/extra/${extensionId}`,
      extensionId,
    ),
    null,
  );
  assert.equal(normalizeChromeWebStoreUrl(undefined, extensionId), null);
});
