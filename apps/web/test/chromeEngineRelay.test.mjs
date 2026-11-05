import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

test("extension engine relay preserves the three-frame bridge and reports compositor state", async () => {
  const relayNonce = "ab".repeat(32);
  const source = await readFile(
    new URL("../../../extensions/chrome-meet-bridge/engine-relay.js", import.meta.url),
    "utf8",
  );
  const childMessages = [];
  const parentMessages = [];
  const runtimeMessages = [];
  const childWindow = {
    postMessage(message, origin) {
      childMessages.push({ message, origin });
    },
  };
  const parentWindow = {
    postMessage(message, origin, transfer) {
      parentMessages.push({ message, origin, transfer });
    },
  };
  const engineListeners = new Map();
  const windowListeners = new Map();
  const storageListeners = [];
  const engine = {
    src: "",
    dataset: {
      engineSrc: "https://airboard-pilot-web-634900453473.asia-south1.run.app/meet/overlay-engine",
    },
    getAttribute(name) {
      return name === "data-engine-src" ? this.dataset.engineSrc : null;
    },
    contentWindow: childWindow,
    addEventListener(type, listener) {
      engineListeners.set(type, listener);
    },
  };
  const chrome = {
    runtime: {
      sendMessage(message) {
        runtimeMessages.push(message);
        return Promise.resolve();
      },
    },
    storage: {
      local: {
        async get() {
          return { airboardState: { installationToken: "installation-token-1" } };
        },
      },
      onChanged: {
        addListener(listener) {
          storageListeners.push(listener);
        },
      },
    },
  };
  const window = {
    parent: parentWindow,
    location: { hash: `#airboardRelayNonce=${relayNonce}` },
    addEventListener(type, listener) {
      windowListeners.set(type, listener);
    },
  };
  const document = { getElementById: () => engine };
  class FakeImageBitmap {}

  vm.runInContext(
    source,
    vm.createContext({
      chrome,
      document,
      window,
      URL,
      URLSearchParams,
      ArrayBuffer,
      ImageBitmap: FakeImageBitmap,
      Error,
      Set,
    }),
  );

  engineListeners.get("load")();
  await Promise.resolve();
  assert.equal(childMessages[0].message.bridge, "airboard-extension-auth");
  assert.equal(childMessages[0].message.v, 1);
  assert.equal(childMessages[0].message.type, "installation-token");
  assert.equal(childMessages[0].message.relayNonce, relayNonce);
  assert.equal(childMessages[0].message.token, "installation-token-1");
  assert.equal(
    childMessages[0].origin,
    "https://airboard-pilot-web-634900453473.asia-south1.run.app",
  );

  const onMessage = windowListeners.get("message");
  onMessage({
    data: {
      bridge: "airboard-extension-auth",
      v: 1,
      type: "installation-token-request",
      relayNonce,
    },
    origin: "https://airboard-pilot-web-634900453473.asia-south1.run.app",
    source: childWindow,
  });
  await Promise.resolve();
  assert.equal(childMessages.at(-1).message.token, "installation-token-1");

  onMessage({
    data: {
      bridge: "airboard-media-bridge",
      v: 1,
      type: "overlay-hello",
      relayNonce,
    },
    origin: "https://airboard-pilot-web-634900453473.asia-south1.run.app",
    source: childWindow,
  });
  assert.equal(parentMessages.length, 1);
  assert.equal(parentMessages[0].origin, "https://meet.google.com");

  onMessage({
    data: {
      bridge: "airboard-media-bridge",
      v: 1,
      type: "overlay-hello",
      relayNonce: "cd".repeat(32),
    },
    origin: "https://airboard-pilot-web-634900453473.asia-south1.run.app",
    source: childWindow,
  });
  assert.equal(parentMessages.length, 1, "a wrong frame nonce is not relayed to Meet");

  const state = {
    bridge: "airboard-media-bridge",
    v: 1,
    type: "overlay-state",
    relayNonce,
    armed: true,
    engaged: true,
  };
  onMessage({ data: state, origin: "https://meet.google.com", source: parentWindow });
  assert.equal(runtimeMessages.length, 1);
  assert.equal(runtimeMessages[0].type, "AIRBOARD_COMPOSITOR_STATE");
  assert.equal(runtimeMessages[0].state.type, "overlay-state");
  assert.equal(childMessages.at(-1).message.type, "overlay-state");
  assert.equal(
    childMessages.at(-1).origin,
    "https://airboard-pilot-web-634900453473.asia-south1.run.app",
  );

  storageListeners[0](
    { airboardState: { newValue: { installationToken: "installation-token-2" } } },
    "local",
  );
  assert.equal(childMessages.at(-1).message.token, "installation-token-2");
});
