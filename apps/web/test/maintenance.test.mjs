import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { registerHooks } from "node:module";
import test from "node:test";
import { fileURLToPath } from "node:url";

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith(".") && context.parentURL && !specifier.endsWith(".ts")) {
      const candidate = new URL(`${specifier}.ts`, context.parentURL);
      if (existsSync(fileURLToPath(candidate))) return nextResolve(candidate.href, context);
    }
    return nextResolve(specifier, context);
  },
});

const { MAINTENANCE_EVENT } = await import("../src/platform/maintenance.ts");
const { AirboardApiError, airboardApi } = await import("../src/platform/api.ts");

function respondWith(t, status, body) {
  const original = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
  t.after(() => { globalThis.fetch = original; });
}

function listenForMaintenance(t) {
  const hadWindow = "window" in globalThis;
  const original = globalThis.window;
  const target = new EventTarget();
  globalThis.window = target;
  t.after(() => {
    if (hadWindow) globalThis.window = original;
    else delete globalThis.window;
  });
  let announced = 0;
  target.addEventListener(MAINTENANCE_EVENT, () => { announced += 1; });
  return () => announced;
}

test("a refused change during an upgrade is announced so the banner can show", async (t) => {
  respondWith(t, 503, { error: "MAINTENANCE" });
  const announced = listenForMaintenance(t);
  await assert.rejects(
    airboardApi("/boards/1", { method: "PATCH", body: "{}" }),
    (error) => error instanceof AirboardApiError && error.code === "MAINTENANCE" && error.status === 503,
  );
  assert.equal(announced(), 1);
});

test("other failures are not announced as maintenance", async (t) => {
  respondWith(t, 503, { error: "SERVICE_UNAVAILABLE" });
  const announced = listenForMaintenance(t);
  await assert.rejects(airboardApi("/boards/1", { method: "PATCH", body: "{}" }));
  assert.equal(announced(), 0);
});
