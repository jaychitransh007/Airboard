import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

test("Meet meeting routes mount one hidden Airboard engine and remove it on exit", async () => {
  const source = await readFile(
    new URL("../../../extensions/chrome-meet-bridge/content.js", import.meta.url),
    "utf8",
  );
  const intervals = [];
  const elements = new Map();
  const documentElement = {
    appendChild(element) {
      elements.set(element.id, element);
    },
  };
  const document = {
    documentElement,
    getElementById: (id) => elements.get(id) ?? null,
    createElement(tag) {
      assert.equal(tag, "iframe");
      return {
        id: "",
        style: {},
        setAttribute() {},
        remove() {
          elements.delete(this.id);
        },
      };
    },
  };
  const window = {
    location: { pathname: "/abc-defg-hij" },
    addEventListener() {},
  };
  const runtimeListeners = [];
  vm.runInContext(
    source,
    vm.createContext({
      window,
      document,
      chrome: { runtime: {
        getURL: (path) => `chrome-extension://airboard/${path}`,
        sendMessage: (message, callback) => {
          if (typeof callback === "function") callback({
            linked: true,
            consented: true,
            entitled: true,
            settings: { overlayEnabled: true, videoEnabled: true, audioEnabled: true },
          });
          return Promise.resolve(message?.type === "AIRBOARD_MEET_CONTEXT" ? { ok: true } : undefined);
        },
        onMessage: { addListener: (listener) => runtimeListeners.push(listener) },
      } },
      setInterval: (callback) => {
        intervals.push(callback);
        return intervals.length;
      },
      createImageBitmap() {},
      navigator: { mediaDevices: {} },
      console,
      Object,
      Set,
      Math,
      Number,
      Promise,
      Float32Array,
    }),
  );

  const engine = elements.get("airboard-overlay-engine-host");
  assert.ok(engine);
  assert.equal(engine.src, "chrome-extension://airboard/engine.html");
  assert.equal(engine.style.width, "1280px");
  assert.equal(engine.style.opacity, "0");

  intervals[0]();
  assert.equal(elements.size, 1, "route polling never duplicates the engine");
  window.location.pathname = "/";
  intervals[0]();
  assert.equal(elements.size, 0);
});
