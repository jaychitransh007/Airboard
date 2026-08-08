import assert from "node:assert/strict";
import test from "node:test";

import {
  chromeExtensionOrigin,
  extensionRelayNonceFromHash,
  isTrustedExtensionRelayMessage,
  normalizeChromeExtensionId,
} from "../src/features/meet/extensionRelayTrust.ts";

const PRODUCTION_ID = "abcdefghijklmnopabcdefghijklmnop";
const OTHER_ID = "ponmlkjihgfedcbaponmlkjihgfedcba";
const NONCE = "ab".repeat(32);

test("normalizes only real Chrome extension IDs", () => {
  assert.equal(normalizeChromeExtensionId(PRODUCTION_ID), PRODUCTION_ID);
  assert.equal(chromeExtensionOrigin(PRODUCTION_ID), `chrome-extension://${PRODUCTION_ID}`);
  assert.equal(normalizeChromeExtensionId("airboard-extension-id"), null);
  assert.equal(normalizeChromeExtensionId("A".repeat(32)), null);
});

test("reads only a 256-bit relay nonce from the renderer fragment", () => {
  assert.equal(extensionRelayNonceFromHash(`#airboardRelayNonce=${NONCE}`), NONCE);
  assert.equal(extensionRelayNonceFromHash("#airboardRelayNonce=short"), null);
  assert.equal(extensionRelayNonceFromHash(`#other=${NONCE}`), null);
});

test("production relay trust is bound to the exact configured extension origin", () => {
  const configuredOrigin = `chrome-extension://${PRODUCTION_ID}`;
  assert.equal(
    isTrustedExtensionRelayMessage(
      { origin: configuredOrigin, data: { type: "ready" } },
      { configuredOrigin, relayNonce: null },
    ),
    true,
    "an exact configured origin can complete a rolling legacy handshake",
  );
  assert.equal(
    isTrustedExtensionRelayMessage(
      { origin: `chrome-extension://${OTHER_ID}`, data: { relayNonce: NONCE } },
      { configuredOrigin, relayNonce: NONCE },
    ),
    false,
    "a nonce never overrides the published extension identity",
  );
});

test("unpacked relay trust requires the exact frame nonce", () => {
  const origin = `chrome-extension://${OTHER_ID}`;
  assert.equal(
    isTrustedExtensionRelayMessage(
      { origin, data: { relayNonce: NONCE } },
      { configuredOrigin: null, relayNonce: NONCE, allowNonceBoundUnpacked: true },
    ),
    true,
  );
  assert.equal(
    isTrustedExtensionRelayMessage(
      { origin, data: { relayNonce: "cd".repeat(32) } },
      { configuredOrigin: null, relayNonce: NONCE, allowNonceBoundUnpacked: true },
    ),
    false,
  );
  assert.equal(
    isTrustedExtensionRelayMessage(
      { origin, data: {} },
      { configuredOrigin: null, relayNonce: null, allowNonceBoundUnpacked: true },
    ),
    false,
    "there is no wildcard chrome-extension origin fallback",
  );
});

test("production cannot authorize an arbitrary extension with only a nonce", () => {
  assert.equal(
    isTrustedExtensionRelayMessage(
      {
        origin: `chrome-extension://${OTHER_ID}`,
        data: { relayNonce: NONCE },
      },
      {
        configuredOrigin: null,
        relayNonce: NONCE,
        allowNonceBoundUnpacked: false,
      },
    ),
    false,
  );
});
