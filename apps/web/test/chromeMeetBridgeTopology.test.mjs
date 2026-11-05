import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const MEET_ORIGIN = "https://meet.google.com";
const WEB_ORIGIN = "https://airboard-pilot-web-634900453473.asia-south1.run.app";
const EXTENSION_ID = "abcdefghijklmnopabcdefghijklmnop";
const EXTENSION_ORIGIN = `chrome-extension://${EXTENSION_ID}`;
const RELAY_NONCE = "ab".repeat(32);

test("the real renderer -> extension relay -> Meet topology completes both bridge handshakes", async () => {
  const [relaySource, contentSource, compositorSource] = await Promise.all([
    readFile(new URL("../../../extensions/chrome-meet-bridge/engine-relay.js", import.meta.url), "utf8"),
    readFile(new URL("../../../extensions/chrome-meet-bridge/content.js", import.meta.url), "utf8"),
    readFile(new URL("../../../extensions/chrome-meet-bridge/compositor.js", import.meta.url), "utf8"),
  ]);

  const meetHandlers = [];
  const relayHandlers = [];
  const rendererMessages = [];
  const runtimeMessages = [];
  const elements = new Map();

  const rendererWindow = {
    postMessage(message, origin) {
      assert.equal(origin, WEB_ORIGIN);
      rendererMessages.push(message);
    },
  };

  const meetWindow = {
    location: { pathname: "/abc-defg-hij" },
    localStorage: {
      getItem: () => null,
      setItem() {},
    },
    addEventListener(type, handler) {
      if (type === "message") meetHandlers.push(handler);
    },
    postMessage(message, origin) {
      assert.equal(origin, MEET_ORIGIN);
      for (const handler of [...meetHandlers]) {
        handler({ data: message, origin: EXTENSION_ORIGIN, source: relayWindow });
      }
    },
  };

  const relayWindow = {
    parent: meetWindow,
    location: { hash: `#airboardRelayNonce=${RELAY_NONCE}` },
    addEventListener(type, handler) {
      if (type === "message") relayHandlers.push(handler);
    },
    postMessage(message, origin) {
      assert.equal(origin, EXTENSION_ORIGIN);
      for (const handler of [...relayHandlers]) {
        handler({ data: message, origin: MEET_ORIGIN, source: meetWindow });
      }
    },
  };

  const meetDocument = {
    documentElement: {
      appendChild(element) {
        elements.set(element.id, element);
      },
    },
    getElementById(id) {
      return elements.get(id) ?? null;
    },
    querySelectorAll() {
      return [];
    },
    createElement(tag) {
      if (tag === "iframe") {
        return {
          id: "",
          src: "",
          style: {},
          contentWindow: relayWindow,
          setAttribute() {},
          remove() {
            elements.delete(this.id);
          },
        };
      }
      throw new Error(`Unexpected element creation: ${tag}`);
    },
  };

  vm.runInContext(
    compositorSource,
    vm.createContext({
      window: meetWindow,
      document: meetDocument,
      navigator: { mediaDevices: {} },
      setInterval: () => 1,
      clearInterval() {},
      Date,
      Promise,
      Number,
      Map,
      Set,
      Object,
      ImageBitmap: class {},
      URL,
      URLSearchParams,
      console,
    }),
  );

  const extensionState = {
    linked: true,
    consented: true,
    entitled: true,
    settings: { overlayEnabled: true, videoEnabled: true, audioEnabled: true },
  };
  vm.runInContext(
    contentSource,
    vm.createContext({
      window: meetWindow,
      document: meetDocument,
      navigator: { mediaDevices: {} },
      chrome: {
        runtime: {
          getURL: (path) => `${EXTENSION_ORIGIN}/${path}`,
          sendMessage(message, callback) {
            if (typeof callback === "function") callback(extensionState);
            return Promise.resolve(message);
          },
          onMessage: { addListener() {} },
        },
      },
      setInterval: () => 1,
      createImageBitmap() {},
      crypto: {
        randomUUID: () => "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        getRandomValues(array) {
          array.fill(0xab);
          return array;
        },
      },
      URL,
      URLSearchParams,
      Uint8Array,
      Array,
      Date,
      Promise,
      JSON,
      Math,
      Object,
      Set,
      Number,
      Float32Array,
      console,
    }),
  );

  const engineListeners = new Map();
  const relayDocument = {
    getElementById(id) {
      assert.equal(id, "airboard-engine-frame");
      return {
        src: "",
        dataset: { engineSrc: `${WEB_ORIGIN}/meet/overlay-engine` },
        getAttribute(name) {
          return name === "data-engine-src" ? this.dataset.engineSrc : null;
        },
        contentWindow: rendererWindow,
        addEventListener(type, listener) {
          engineListeners.set(type, listener);
        },
      };
    },
  };
  vm.runInContext(
    relaySource,
    vm.createContext({
      window: relayWindow,
      document: relayDocument,
      chrome: {
        runtime: {
          sendMessage(message) {
            runtimeMessages.push(message);
            return Promise.resolve();
          },
        },
        storage: {
          local: { async get() { return { airboardState: {} }; } },
          onChanged: { addListener() {} },
        },
      },
      URL,
      URLSearchParams,
      ArrayBuffer,
      ImageBitmap: class {},
      Error,
      Set,
    }),
  );

  const sendFromRenderer = (type) => {
    for (const handler of [...relayHandlers]) {
      handler({
        data: {
          bridge: "airboard-media-bridge",
          v: 1,
          type,
          relayNonce: RELAY_NONCE,
        },
        origin: WEB_ORIGIN,
        source: rendererWindow,
      });
    }
  };

  sendFromRenderer("hello");
  assert.ok(rendererMessages.some((message) => message.type === "ready"));

  sendFromRenderer("overlay-hello");
  assert.ok(rendererMessages.some((message) => message.type === "overlay-state"));
  assert.ok(runtimeMessages.some((message) => message.type === "AIRBOARD_COMPOSITOR_STATE"));

  const replyCount = rendererMessages.length;
  const imposterWindow = { postMessage() { throw new Error("imposter received a reply"); } };
  for (const handler of [...meetHandlers]) {
    handler({
      data: {
        bridge: "airboard-media-bridge",
        v: 1,
        type: "overlay-hello",
        relayNonce: RELAY_NONCE,
      },
      origin: EXTENSION_ORIGIN,
      source: imposterWindow,
    });
  }
  assert.equal(rendererMessages.length, replyCount, "same-origin sibling frames are not trusted");
  assert.equal(engineListeners.has("load"), true);
});
